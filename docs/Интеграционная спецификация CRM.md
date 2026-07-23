---
tags: [integration, spec, crm]
updated: 2026-07-23
status: v0.1 — на согласование с командой CRM
---

# Интеграционная спецификация: сайт ↔ CRM

Документ — требования сайта к API CRM. CRM — внешний готовый продукт (Python FastAPI + gRPC внутри, фронтенды React/Vite). Сайт (Next.js) потребляет **только REST JSON поверх HTTPS**; gRPC остаётся внутренним делом CRM. Все идентификаторы — английские.

## 1. Принципы

1. **Anti-corruption layer**: сайт зависит только от собственного контракта (Zod-схемы в `packages/api-client`). Маппинг «реальные маршруты CRM → контракт» живёт в адаптере на стороне сайта (`apps/web/app/api/cms/*`). Если существующие ручки CRM отличаются — меняется адаптер, не сайт. Для старта нужен дамп OpenAPI текущего CRM (FastAPI генерирует его автоматически: `/openapi.json`).
2. **Server-to-server only**: браузер клиента никогда не обращается к CRM. Все вызовы — из Next.js-сервера (ISR-пересборки) и BFF (формы).
3. **Сайт переживает падение CRM**: stale-контент + фолбэки. Требование к CRM — не «100% аптайм», а корректные коды ошибок и вебхуки с ретраями.
4. Контент — только данные (Markdown/структуры), никакого исполняемого HTML/JS.

## 2. Транспорт, аутентификация, производительность

| Параметр | Требование |
| --- | --- |
| Протокол | HTTPS, REST, JSON (UTF-8), gzip |
| Аутентификация | заголовок `X-API-Key` (отдельные ключи per environment: staging/prod), ротация без даунтайма (2 активных ключа) |
| Сетевой доступ | allowlist IP сайта (опционально), CRM недоступна с публичного интернета для этих ручек — только для серверов сайта |
| Таймаут на стороне сайта | 3 s (потом фолбэк) → целевое p95 CRM **< 300 ms** |
| Нагрузка от сайта | низкая: только ISR-пересборки и вебхуки; НЕ per-user. Оценка: единицы RPS в пике |
| Correlation | сайт шлёт `X-Request-Id`; CRM возвращает его в ответе и пишет в логи/GlitchTip |
| Версионирование | префикс `/v1/`; изменения только аддитивные; breaking → `/v2` с периодом сосуществования |

## 3. Локализация

- Каждый content-эндпоинт принимает `?locale=ru|en`; `ru` — default и fallback (нет перевода → вернуть `ru`-версию с полем `"locale": "ru"` в ответе).
- Слаги едины между локалями (один `slug` — две языковые версии).

## 4. Content-эндпоинты (GET, читает только сервер сайта)

Полные схемы ответов — артефакт `packages/api-client` (Zod → JSON Schema / OpenAPI, передаётся команде CRM). Здесь — состав и назначение.

| Endpoint | Параметры | Ответ (суть) | Cache tag | Частота изменений |
| --- | --- | --- | --- | --- |
| `GET /v1/cms/brand` | `locale` | name, logo (media), favicon (media), primaryColor (hex), socials[] | `cms:brand` | редко |
| `GET /v1/cms/navigation` | `locale` | header[]: {label, href}; footer[]: columns{title, links[]} | `cms:navigation` | редко |
| `GET /v1/cms/instruments` | `locale` | allow-list: [{symbol, name, category, digits, leverage, spreadFrom, swapFree, icon?}] — живые цены НЕ здесь (WebSocket Market Data) | `cms:instruments` | редко |
| `GET /v1/cms/accounts` | `locale` | планы: [{id, name, description, minDeposit, featured, features[], pricing{spreadPips, commissionPerLotRT}}] | `cms:accounts` | редко |
| `GET /v1/cms/faq` | `locale` | sections[]: {title, items[]{question, answer}} | `cms:faq` | средне |
| `GET /v1/cms/promotions` | `locale` | [{id, badge, title, description, terms, ctaLabel, ctaHref, featured, activeFrom, activeTo}] | `cms:promotions` | часто |
| `GET /v1/cms/partners` | `locale` | models[], tiers[], steps[] | `cms:partners` | редко |
| `GET /v1/cms/academy` | `locale` | articles[] (обучающие) + webinars[]{title, speaker, speakerRole, startsAt, durationMinutes, level, description} | `cms:academy` | средне |
| `GET /v1/cms/streams` | `status=live\|upcoming\|past`, `locale` | [{provider: youtube\|vimeo, videoId, title, poster(media), startsAt}] | `cms:streams` | часто |
| `GET /v1/cms/articles` | `category?, page?, pageSize?, locale` | items[]{slug, title, excerpt, category, publishedAt, readingMinutes, bodyMarkdown}, total | `cms:articles` | часто |
| `GET /v1/cms/articles/{slug}` | `locale` | одна статья; 404 если нет | `cms:articles` | — |
| `GET /v1/cms/contacts` | `locale` | channels[], offices[] | `cms:contacts` | редко |
| `GET /v1/cms/careers` | `locale` | benefits[], vacancies[]{title, department, location, type, applyEmail} | `cms:careers` | средне |
| `GET /v1/cms/legal` | `type?, locale` | документы: {slug, title, updatedAt, intro, sections[]{heading, paragraphsMarkdown[]}} | `cms:legal` | редко |
| `GET /v1/cms/system-status` | — | services[]{id, name, description, status, uptime90d}, incidents[] | `cms:system-status` | часто |
| `GET /v1/cms/pages` | `slug, locale` | ⏸ конструктор — зарезервировано в контракте, реализация отложена ([[Технический долг#TD-001]]) | `cms:page:{slug}` | — |

**Коды ответов**: 200; 404 — сущность не существует (сайт отдаст 404-страницу); 4xx/5xx — сайт остаётся на last-good и шлёт алерт. Частичный/невалидный JSON недопустим — ответ либо целиком валиден по схеме, либо ошибка.

## 5. Приём лидов (POST из BFF сайта)

| Endpoint | Тело (уже провалидировано Zod на сайте) | Ответ |
| --- | --- | --- |
| `POST /v1/leads/account-opening` | firstName, lastName, email, phone, country, accountType, locale, source (utm/promo) | `201 {leadId}` · `409 {fieldErrors:{email:"emailExists"}}` · `422 {fieldErrors}` |
| `POST /v1/leads/contact` | name, email, topic, message, locale | `201 {ticketId}` · `422 {fieldErrors}` |

`fieldErrors` — **ключи** (языконезависимые, из согласованного словаря: `emailExists`, `invalidEmail`, …); перевод делает сайт. Rate-limit и honeypot — на стороне сайта (уже реализованы), CRM может иметь свой поверх.

## 6. Вебхуки инвалидации контента (CRM → сайт)

- URL: `POST https://<site>/api/revalidate`
- Тело: `{ "event_id": "uuid", "occurred_at": "ISO8601", "tags": ["cms:promotions", "cms:articles"] }`
- Подпись: заголовок `X-Signature: sha256=<HMAC-SHA256(body, shared_secret)>`; секрет per environment, ротация как у API-ключей.
- Требования: **ретраи** (минимум 3, экспоненциальный backoff, таймаут 5 s), идемпотентность по `event_id` (сайт дедуплицирует), событие на каждую публикацию/распубликацию с корректным набором тегов.
- Сайт отвечает `202` мгновенно, инвалидация асинхронно с дебаунсом (шторм событий → одна пересборка).
- Маппинг «сущность CRM → tags» — приложение А (заполняется после получения OpenAPI CRM).

## 7. Медиа

- CRM отдаёт медиа-объекты: `{ "url", "width", "height", "alt", "mimeType" }` — **width/height/alt обязательны** (защита от CLS, a11y).
- Файлы — в S3-совместимом хранилище с отдачей через CDN-домен (`media.<domain>`); домен сообщить сайту для `next/image remotePatterns`.
- Лимиты при загрузке (размер, формат) — на стороне CRM.

## 8. Контент-правила (валидация при вводе в CRM)

1. Текстовые тела — **Markdown (CommonMark) без raw HTML** (сайт рендерит с санитизацией; HTML будет вырезан).
2. Зарезервированные слаги (нельзя использовать в контенте): `instruments, accounts, analytics, education, partners, promotions, blog, company, legal, register, login, status, offline, api, en, ru`.
3. Цвет бренда: hex `#rrggbb` + проверка контрастности к фонам тем.
4. Стримы: только `youtube | vimeo`; при публикации — oEmbed-проверка доступности видео.
5. Идеал: CRM валидирует ввод теми же JSON Schema, что мы передаём (артефакт этапа 0) — тогда невалидный контент не сохранится вовсе.

## 9. Контрактные тесты

- Сайт передаёт: JSON Schema всех ответов + набор эталонных фикстур.
- CI CRM: ответы ручек валидируются схемами (или diff их `/openapi.json` против нашего контракта).
- CI сайта: фикстуры mock-CRM валидируются теми же схемами (уже в плане этапа 0).

## 10. Наблюдаемость (общая с CRM)

Общий GlitchTip (см. [[Решения (ADR)#ADR-014]]): проекты `site-web`, `site-bff`, `crm-backend`, `crm-frontend`. Сквозной `X-Request-Id`. Алерты сайта: каждый фолбэк `cmsFetch`, ошибки подписи вебхука, возраст контента > порога.

## 11. Чек-лист готовности CRM к интеграции

- [ ] Передан актуальный `/openapi.json` CRM → сайт составляет маппинг (приложение А)
- [ ] REST-ручки `/v1/cms/*`, `/v1/leads/*` соответствуют схемам (напрямую или через тонкий gateway на стороне CRM)
- [ ] `X-API-Key` + выдача ключей staging/prod
- [ ] Вебхуки: HMAC, ретраи, события на публикацию с тегами
- [ ] Медиа: хранилище + CDN-домен + обязательные width/height/alt
- [ ] Markdown-редактор без raw HTML; запрет зарезервированных слагов
- [ ] Версионирование контента и откат публикации
- [ ] p95 < 300 ms на content-ручках
- [ ] Подключение к общему GlitchTip со скраббингом (до первого события)

## Приложение А — аудит Mica API Gateway v2.0.0 и маппинг (заполнено 2026-07-23)

Проанализирован переданный `mica-gateway-openapi.json`: 142 пути, 69 схем, 25 доменов, единая точка входа `/api/v1/*` (подтверждено), наружу дополнительно только `/health`, `/health/ready`, `/internal/telegram/health`.

**Ключевой вывод: контентного домена в CRM НЕТ.** Все 25 доменов — внутренняя операционка (clients/продажи и retention, admin, adspower, employees, team, messaging, auth, tasks, telegram, support, files, …). Поиск по `cms|content|article|news|page|faq|promo|legal|instrument|banner|seo` — 0 совпадений. Значит `/v1/cms/*` — **новый greenfield-модуль**, а не маппинг существующих ручек.

| Наш контракт | Реализация в CRM | Статус |
| --- | --- | --- |
| `GET /v1/cms/*` (все content-ручки) | **новый cms-сервис** за тем же гейтвеем; рекомендация — отдельный сервис со своей БД ([[Решения (ADR)#ADR-016]]) | 🆕 строить |
| `POST /v1/leads/account-opening` | `POST /api/v1/clients` (CreateClientBody) — подходит, НО: **нет поля `email`** (для брокера критично — добавить колонку, не прятать в notes), нет `locale`; `source_url` есть (UTM ок); required только `name` | 🔧 доработка |
| `POST /v1/leads/contact` | `POST /api/v1/support/tickets` (CreateTicketBody) — семантика внутренняя (`persona_latin`, `force`, нет email/имени отправителя): нужен публичный вариант или маппинг с системной персоной + контакт-поля | 🔧 доработка / решение CRM |
| Вебхук `content-published → site` | исходящих вебхуков в CRM нет — строить; рекомендация: **outbox-паттерн** + воркер с ретраями ([[Решения (ADR)#ADR-016]]) | 🆕 строить |
| Медиа-контракт | домен `files` (4 маршрута) существует — надстроить обязательные `width/height/alt` и CDN-домен | 🔧 доработка |
| Аутентификация s2s (`X-API-Key`) | `components.securitySchemes` в спеке пусты (auth — пользовательский, через `/api/v1/auth`); нужны **сервисные ключи** для сайта | 🆕 строить |

Примечание: `/openapi.json` в проде закрыт (осознанно) — спека передаётся вручную; контрактные тесты (§9) от этого только важнее: авто-сверки с продом не будет.

## Открытые вопросы к команде CRM
1. Подтвердить объём доработок из Приложения А: новый cms-сервис, email/locale в CreateClientBody, публичный вариант тикетов, outbox-вебхуки, сервисные API-ключи, width/height/alt в files.
2. Модель локализации контента в новом cms-модуле (предложение: per-locale поля с фолбэком на `ru`).
3. CDN-домен для медиа (files) — существует или заводим.
4. Оценка сроков по новому cms-модулю (после неё — общий план интеграции).

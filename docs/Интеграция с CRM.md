---
tags: [architecture, cms, current-phase]
updated: 2026-07-23
status: этап 0 — в работе
---

# Интеграция с CRM (headless-контент)

## ⚡ Ответ платформы на готовность шины (2026-07-25)

Команда CRM собрала шину (vhost `platform`, exchange `platform.events` topic durable, DLX, TTL 7 дн, least-privilege учётки, контракт-репо platform-contracts). Наши ответы на их четыре пункта:

1. **`platform.events` — подтверждаем** (наш релей так и ставит по умолчанию: `BUS_EXCHANGE` дефолт). **Конверт-стандарт подтверждаем**: наш формат + опциональные `subject`/`correlation_id` — уже внесено в Zod (`packages/api-client/src/schemas/events.ts`, пометка draft снята) и перегенерировано в JSON Schema-артефакты.
2. **Сверка lead.submitted.v1**: наш канон — `packages/api-client/artifacts/json-schema/events.lead.submitted.v1.schema.json` (репо публичное) — диффайте против своей транскрипции; поля/энумы: account-opening {kind, leadId uuid, firstName, lastName, email, phone, country, accountType∈standard|pro|ecn, locale∈ru|en, source{url?,promo?,utm?}?}, contact {kind, leadId, name, email, topic∈general|account|payments|partnership, message, locale}.
3. **Очереди `site-web.*` — принято**: релей только публикует (очередей не декларирует); наши будущие консюмеры (уведомления кабинета — события терминала) будут декларировать строго `site-web.*`.
4. **scrubbing-policy.v1.json** — лежит в публичном репо: `packages/api-client/scrubbing-policy.v1.json` (+ 3 unit-теста политики) — сводите с вашим черновиком.

**Прогон против реальной шины выполнен на нашей стороне** (2026-07-25): локальный RabbitMQ с их топологией (vhost `platform`, exchange, очередь `site-web.smoke`) — форма сайта → outbox → релей (AmqpPublisher, впервые живьём) → сообщение в очереди: routing key `lead.submitted`, `message_id = event_id`, persistent, конверт валиден. Подключение к их проду = env `BUS_URL` (+`BUS_EXCHANGE` можно не задавать).

**Открытое к ним/владельцу**: (а) хостинг прод-шины — предлагаем решить вместе с нашим VPS-этапом (кандидаты: VPS CRM рядом с GlitchTip или наш VPS; TLS amqps обязателен для внешних подключений); (б) дом контракт-репо — подтверждаем предложение: отдельный GitHub-репозиторий `platform-contracts`, доступ обеим командам (создаёт владелец), мы сразу заливаем Zod-артефакты (22 JSON Schema + фикстуры) и scrubbing-policy; (в) новые продюсеры на подходе: терминал (события `terminal.*`, Т3) — учесть учётку.


Цель: весь контент сайта управляется из CRM без деплоя. Деплой нужен только для новой логики/типов секций. Задание получено и согласовано 2026-07-23 (с поправками — см. [[Решения (ADR)#ADR-009]]).

## Классы данных по скорости обновления

| Класс | Примеры | Механика | Запросы с клиента |
| --- | --- | --- | --- |
| Медленные | brand, navigation, legal, FAQ, contacts | ISR + `revalidateTag` по вебхуку, страховочный `revalidate: 3600` | 0 |
| Условно-динамические | articles, promotions, page sections | ISR + вебхук, страховочный `revalidate: 60` | 0 |
| Реально-динамические | котировки | WebSocket (Market Data Service); CRM отдаёт только allow-list инструментов | WS |
| Формы | заявки | `POST` через BFF в CRM по факту отправки | по действию |

## Слои защиты (сверху вниз)

```
Клиент ← CDN/статика (всегда готовый HTML, скелетонов нет)
  ← Next.js ISR: stale-while-revalidate — пользователь НИКОГДА не ждёт CRM
    ← cmsFetch(): timeout 3s, retry, Zod-валидация ответа, при мусоре — last-good
      ← фикстуры (бывшие data-файлы) — последний фолбэк; билд НЕ падает без CRM
        ← CRM API
```

## Контракт (все идентификаторы — английский)

Эндпоинты: `GET /api/cms/{brand | navigation | pages?slug= | instruments | accounts | faq | promotions | partners | academy | streams?status=live | contacts | careers | legal?type= | system-status | articles?category=&page=}`. Каждый принимает `locale` (`ru` default, фолбэк контента на `ru`). Слаги едины между локалями.

Вебхук: `POST /api/revalidate`, тело `{ "tags": ["cms:brand", "cms:page:home"] }`, заголовок `X-Signature` = HMAC-SHA256 от тела с общим секретом. Требования к CRM: ретраи вебхуков, версионирование контента с откатом публикации, зарезервированные слаги (`instruments`, `accounts`, `register`, …) запрещены в конструкторе.

Теги кеша: `cms:brand`, `cms:navigation`, `cms:page:{slug}`, `cms:articles`, `cms:instruments`, `cms:faq`, `cms:promotions`, `cms:legal`, `cms:streams`, …

## Принятые решения по открытым вопросам

### Формат статей — Markdown (CommonMark), raw HTML запрещён
Почему не HTML: прямой XSS-риск + нельзя гарантировать вёрстку. Почему не структурные блоки: требуют написать блочный редактор в CRM — дорого сейчас (блоки останутся опцией для конструктора страниц позже). Markdown — золотая середина: в CRM ставится готовый WYSIWYG-редактор (Toast UI / Milkdown), фронт рендерит сервером через remark + rehype-sanitize (allow-list тегов). Изображения в тексте — только через media-контракт (см. ниже).

### Медиа — S3-совместимое хранилище + отдача через CDN-домен
CRM грузит файлы в MinIO (self-hosted, Docker на VPS — в духе остальной инфраструктуры) или Cloudflare R2 (если ок внешний сервис — дешевле по трафику, egress $0). Отдача с отдельного домена `media.<domain>` за Cloudflare-кешем. Контракт медиа-объекта: `{ url, width, height, alt, mimeType }` — width/height **обязательны** (Zod), иначе CLS. Рендер только через `next/image` (`remotePatterns: media.<domain>`). Лимит размера файла — на стороне CRM при загрузке.

### Error tracking — GlitchTip (self-hosted)
Sentry-совместимый (те же SDK `@sentry/nextjs`), лёгкий (Docker-compose, ~1 ГБ RAM против ~16 у self-hosted Sentry), данные остаются на нашем VPS — важно для финтеха. Если позже захотим SaaS — SDK менять не придётся, только DSN. Обязательные алерты: каждый срабатывающий фолбэк `cmsFetch`, ошибки вебхука, возраст контента > N часов.

### Стримы (YouTube/Vimeo)
CRM отдаёт `{ provider, videoId, title, poster }`. Рендер через фасад: постер + кнопка, iframe загружается по клику (сторонний JS не грузится на каждую страницу). CSP/`frame-src`: только `youtube-nocookie.com`, `player.vimeo.com`. При публикации CRM проверяет доступность через oEmbed.

## Слой API в коде

```
packages/api-client/
  src/schemas/     Zod-схемы контракта (единственный источник типов) + OpenAPI-генерация
  src/server.ts    cmsFetch<T>(path, { locale, tags, revalidate, schema })
  src/client.ts    axios для клиентских хуков (через BFF)
  src/hooks/       React Query — ТОЛЬКО клиентский интерактив (пагинация, live-статусы)
apps/web/app/api/cms/[...]  mock-CRM (этап 0) поверх текущих data-файлов
apps/web/app/api/revalidate вебхук-приёмник (HMAC + rate-limit + дебаунс)
```

React Query для наполнения страниц **не используется** — контент рендерится сервером (см. [[Решения (ADR)#ADR-009]]).

## Этапы миграции (без даунтайма)

- [x] **Этап 0** — Zod-контракт + JSON Schema в `packages/api-client`; mock-CRM `/api/cms/*` поверх текущих данных; scrubbing-policy.v1.json; 34 контрактных теста. Выполнен 2026-07-23
- [x] **Этап 1** — `/api/revalidate` (HMAC, дедуп, cooldown) + brand / navigation / legal / faq / contacts через тегированный CMS-слой (`getCms`); бренд-цвет и название из CMS. Выполнен 2026-07-24
- [x] **Этап 2** — ВСЕ данные сайта через CMS-слой: instruments (allow-list для WS), accounts, promotions, articles, academy, streams (фасад iframe), careers, system-status. Выполнен 2026-07-24
- [x] **Этап 3** — preview (draftMode: /api/preview + баннер + noindex + draft=true к CMS), синтетический монитор `scripts/synthetic-monitor.mjs` (полный цикл «вебхук → пересборка» = 3.2 c вживую), метка `rendered-at`, перф-бюджет бандла в CI. Выполнен 2026-07-24. Осталось из этапа: установка реального `CMS_API_URL` — по готовности CMS
- [x] **Этап 4** — data-файлы уже используются только как фикстуры mock-CMS и источник слагов (достигнуто этапом 2)
- ⏸ **Конструктор страниц** — отложен, см. [[Технический долг#TD-001]]

## Каталог потенциальных прод-багов и меры

См. [[Журнал багов#Потенциальные прод-риски CRM-интеграции]] — обязателен к перечитыванию перед каждым этапом.

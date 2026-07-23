---
tags: [architecture, cms, current-phase]
updated: 2026-07-23
status: этап 0 — в работе
---

# Интеграция с CRM (headless-контент)

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

- [ ] **Этап 0** — Zod-контракт + OpenAPI в `packages/api-client`; mock-CRM `/api/cms/*` поверх текущих данных. Ничего не ломается. ⬅ текущий
- [ ] **Этап 1** — `/api/revalidate` (HMAC, дебаунс); перевод brand / navigation / legal / faq / contacts на `cmsFetch` с тегами
- [ ] **Этап 2** — типизированные эндпоинты: instruments (allow-list для WS), accounts, promotions, articles, academy/streams, careers, system-status; постранично, e2e после каждой
- [ ] **Этап 3** — preview (draftMode + noindex), синтетический мониторинг «правка в CRM → сайт < 2 мин», подключение реального CRM URL
- [ ] **Этап 4** — data-файлы остаются только фикстурами mock-CRM
- ⏸ **Конструктор страниц** — отложен, см. [[Технический долг#TD-001]]

## Каталог потенциальных прод-багов и меры

См. [[Журнал багов#Потенциальные прод-риски CRM-интеграции]] — обязателен к перечитыванию перед каждым этапом.

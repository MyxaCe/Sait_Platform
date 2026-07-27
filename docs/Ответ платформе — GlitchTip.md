---
tags: [glitchtip, integration, platform]
updated: 2026-07-27
---

# Ответ платформенной команде — GlitchTip (error tracking)

По онбордингу `platform-onboarding` / раздел GlitchTip. Что сделано с нашей
стороны и одна находка по совместимости.

## Подключено (сайт site-web)

- **@sentry/nextjs** в `apps/web`: клиентский конфиг → проект **site-web (DSN /1)**,
  серверный/edge → **site-bff (DSN /2)**. Только ошибки (`tracesSampleRate: 0`),
  `sendDefaultPii: false`.
- **PII-скраббинг ДО отправки** (наш ADR-014) — `beforeSend` применяет нейтральную
  политику `packages/api-client/scrubbing-policy.v1.json` через тонкий адаптер
  `packages/api-client/src/scrubbing.ts`: вырезаются заголовки
  (Authorization/Cookie/X-API-Key), тела критичных путей (`/api/leads`, `/api/v1/auth`…)
  не прикладываются, прочие тела — allowlist-полей, user-контекст сведён к `idHash`,
  значения (email/телефон/PAN/IBAN) вычищаются regex-ами. Адаптер покрыт юнит-тестами.
- Проверено на тестовом VPS: событие доезжает (ingest `200 {id}`), «Invalid Dsn» нет.

## ⚠️ Находка: DSN с дефисами отвергается @sentry-JS

GlitchTip выдал публичный ключ в виде **UUID с дефисами**
(`d17a3294-816a-491d-a9ee-e5f9f3266eae`), а regex парсера DSN в `@sentry/core` v8
(`(\w+)` для ключа) **дефисы не допускает** → `Invalid Sentry Dsn`, события не уходят.

**Обход (применили):** убрать дефисы из ключа — GlitchTip принимает и такой
(проверено: ingest-эндпоинт с де-дефисным ключом отвечает `200 {id}`,
с дефисами — `422`). То есть в DSN для JS-SDK используем
`http://d17a3294816a491da9eee5f9f3266eae@…:8000/2`.

Это касается всех, кто подключает GlitchTip через Sentry-JS. Питоновский sentry-sdk
(CRM) может парсить иначе — стоит проверить у себя. Если удобно — выдавайте DSN сразу
без дефисов.

## Артефакт для сведения политики

`scrubbing-policy.v1.json` (версия 1) — в `packages/api-client/scrubbing-policy.v1.json`.
Формат нейтральный (по договорённости 2026-07-23), одна версия на обе стороны;
у вас — тонкий адаптер на sentry-sdk python (`before_send`). Готовы положить в общий
`platform-contracts`, когда заведёте git-репо.

## Осталось у нас

- Кабинет (`apps/cabinet`) — подключить теми же DSN-проектами или отдельным (по вашему
  усмотрению): сейчас GlitchTip только в сайте.
- Прод: DSN через vault, `environment=production`, TLS.

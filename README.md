# Broker Platform

Монорепозиторий экосистемы международного брокера: маркетинговый сайт, а в будущем — личный кабинет, CRM и веб-трейдинг.

## Структура

```
apps/
  web/          — маркетинговый сайт (Next.js 14, App Router)
packages/
  ui/           — дизайн-система (atoms → organisms), токены тем
  utils/        — форматтеры валют, чисел, дат
  config/       — общие tsconfig и tailwind-preset
```

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск всех приложений в dev-режиме
pnpm build          # production-сборка
pnpm typecheck      # проверка типов во всех пакетах
pnpm lint           # линтинг
pnpm test           # unit-тесты (vitest) во всех пакетах
pnpm --filter @broker/web test:e2e   # e2e (Playwright, desktop + mobile)
```

Сайт: http://localhost:3000

## Принципы

- **Mobile-first**: вёрстка проектируется от 320px, touch-targets ≥ 44px.
- **Токены**: все цвета — только через CSS-переменные из `@broker/ui/tokens.css`; тёмная тема по умолчанию, переключение через атрибут `data-theme`.
- **Композиция**: страницы в `apps/web` собираются из organisms/layout дизайн-системы; atoms напрямую в страницах не используются.
- **TypeScript strict** во всех пакетах.

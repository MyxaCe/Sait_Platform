# Консюмер событий терминала (шина platform.events → проекция кабинета).
# Сборка из корня монорепо: docker build -f docker/consumer.Dockerfile .
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/relay/package.json apps/relay/
COPY apps/consumer/package.json apps/consumer/
COPY apps/cabinet/package.json apps/cabinet/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
# `@broker/tenant` — объявленная зависимость консюмера: `index.ts` первым
# делом зовёт оттуда гейт личности. Пакет завели 06.10, а этот файл за
# ним не пошёл, и образ падал в бесконечный перезапуск с «Cannot find
# module» (B-OPS-029). Копируется и манифест, и исходники: без манифеста
# `pnpm install` не поставит зависимость, без исходников нечего
# импортировать.
COPY packages/tenant/package.json packages/tenant/
# `@broker/db` — гейт схемы на старте (WEB-31). Вместе с манифестом
# едут и миграции: образ, умеющий проверить схему, умеет и применить
# её отдельным шагом выкатки.
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @broker/consumer...

COPY packages/api-client packages/api-client
COPY packages/config packages/config
COPY packages/utils packages/utils
COPY packages/db packages/db
COPY packages/tenant packages/tenant
COPY apps/consumer apps/consumer

USER node
CMD ["pnpm", "--filter", "@broker/consumer", "start"]

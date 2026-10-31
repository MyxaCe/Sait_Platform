# Production-образ центра управления (Next.js standalone, ADM-01).
# Сборка из корня монорепо: docker build -f docker/admin.Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
# Только манифесты рабочих пакетов, которые нужны сборке админки: сам app и
# его граф (@broker/ui, @broker/utils, @broker/config — см. apps/admin/package.json).
# Остальные importers монорепо (web/cabinet/relay/consumer) админке не нужны;
# frozen-lockfile это терпит — собираем только присутствующие пакеты.
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV BUILD_STANDALONE=1
# Публичных адресов у админки НЕТ: это операторский периметр (Р-395), а не
# витрина. NEXT_PUBLIC_* в бандл не впекаются, build-args сборке не нужны —
# образ окружение-агностичен (как relay/consumer). Единственный секрет
# (ADMIN_SESSION_SECRET) приходит ОКРУЖЕНИЕМ при запуске, не на сборке.
RUN pnpm --filter @broker/admin build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3005 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/admin/.next/static ./apps/admin/.next/static
# Тот же entrypoint, что у витрины и кабинета (WEB-22). У админки плейсхолдеров
# адресов в сборке нет, поэтому runtime-config ничего не подставляет и просто
# передаёт управление серверу — но структура запуска единая на все Next-апи.
COPY --chown=app:app docker/runtime-config.sh /usr/local/bin/runtime-config
RUN chmod +x /usr/local/bin/runtime-config
USER app
EXPOSE 3005
ENTRYPOINT ["/usr/local/bin/runtime-config"]
CMD ["node", "apps/admin/server.js"]

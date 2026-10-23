# Production-образ кабинета (Next.js standalone).
# Сборка из корня монорепо: docker build -f docker/cabinet.Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/relay/package.json apps/relay/
COPY apps/cabinet/package.json apps/cabinet/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV BUILD_STANDALONE=1
# Публичные адреса в сборку НЕ попадают (WEB-22, Р-220): образ не знает
# домена, адреса подставляет `docker/runtime-config.sh` при запуске.
# Обязательные без значения не дают стартовать; `WS_URL` необязателен —
# пустой означает «живого фида нет, работает мок».
ENV NEXT_PUBLIC_SITE_URL=https://runtime-site-url.invalid
ENV NEXT_PUBLIC_TERMINAL_URL=https://runtime-terminal-url.invalid
ENV NEXT_PUBLIC_WS_URL=https://runtime-ws-url.invalid
# GlitchTip клиентский DSN (site-web /1) — вшивается в браузерный бандл
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN pnpm --filter @broker/cabinet build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/cabinet/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/cabinet/.next/static ./apps/cabinet/.next/static
RUN mkdir -p /app/uploads && chown app:app /app/uploads
# Подстановка адресов из окружения — до старта сервера (WEB-22).
COPY --chown=app:app docker/runtime-config.sh /usr/local/bin/runtime-config
RUN chmod +x /usr/local/bin/runtime-config
USER app
EXPOSE 3002
ENTRYPOINT ["/usr/local/bin/runtime-config"]
CMD ["node", "apps/cabinet/server.js"]

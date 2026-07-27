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
# Адрес MDS для браузера (живые котировки модуля «Рынки»); пусто — мок
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
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
USER app
EXPOSE 3002
CMD ["node", "apps/cabinet/server.js"]

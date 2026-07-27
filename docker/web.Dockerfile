# Production-образ сайта (Next.js standalone).
# Сборка из корня монорепо: docker build -f docker/web.Dockerfile .
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
# Кто может встраивать сайт в iframe (Preview-вкладка админки CMS);
# headers() Next фиксируются на сборке — на VPS передать реальный origin CMS
ARG FRAME_ANCESTORS="'self' http://localhost:3001"
ENV FRAME_ANCESTORS=$FRAME_ANCESTORS
# Адрес кабинета вшивается в клиентский бандл (кнопки Войти/Открыть счёт)
ARG NEXT_PUBLIC_CABINET_URL="http://localhost:3002"
ENV NEXT_PUBLIC_CABINET_URL=$NEXT_PUBLIC_CABINET_URL
# Адрес MDS для браузера: задан → живые котировки (socket.io), пусто → мок
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
# GlitchTip клиентский DSN (site-web, проект /1) — вшивается в браузерный бандл
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN pnpm --filter @broker/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

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
COPY packages/money/package.json packages/money/
COPY packages/promo/package.json packages/promo/
COPY packages/support/package.json packages/support/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV BUILD_STANDALONE=1
ENV FRAME_ANCESTORS=https://runtime-frame-ancestors.invalid
ENV NEXT_PUBLIC_SITE_URL=https://runtime-site-url.invalid
ENV NEXT_PUBLIC_CABINET_URL=https://runtime-cabinet-url.invalid
ENV NEXT_PUBLIC_WS_URL=https://runtime-ws-url.invalid
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
COPY --chown=app:app apps/web/server-entry.cjs ./apps/web/server-entry.cjs
COPY --chown=app:app apps/web/scripts/revalidate-all.mjs ./apps/web/scripts/revalidate-all.mjs
RUN mkdir -p /app/apps/web/.next/cache && chown -R app:app /app/apps/web/.next
COPY --chown=app:app docker/runtime-config.sh /usr/local/bin/runtime-config
RUN chmod +x /usr/local/bin/runtime-config
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/runtime-config"]
CMD ["node", "apps/web/server-entry.cjs", "apps/web/server.js"]

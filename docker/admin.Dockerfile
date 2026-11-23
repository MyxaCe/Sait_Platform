FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
COPY packages/storage/package.json packages/storage/
COPY packages/money/package.json packages/money/
COPY packages/promo/package.json packages/promo/
COPY packages/support/package.json packages/support/
COPY packages/transfer/package.json packages/transfer/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV BUILD_STANDALONE=1
RUN pnpm --filter @broker/admin build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3005 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --chown=app:app apps/admin/scripts/encrypt-operator-totp.mjs ./apps/admin/scripts/encrypt-operator-totp.mjs
COPY --chown=app:app docker/runtime-config.sh /usr/local/bin/runtime-config
RUN chmod +x /usr/local/bin/runtime-config
USER app
EXPOSE 3005
ENTRYPOINT ["/usr/local/bin/runtime-config"]
CMD ["node", "apps/admin/server.js"]

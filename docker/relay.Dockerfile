# Релей outbox → шина платформы.
# Сборка из корня монорепо: docker build -f docker/relay.Dockerfile .
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/relay/package.json apps/relay/
COPY apps/cabinet/package.json apps/cabinet/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile --filter @broker/relay...

COPY packages/api-client packages/api-client
COPY packages/config packages/config
COPY apps/relay apps/relay

USER node
CMD ["pnpm", "--filter", "@broker/relay", "start"]

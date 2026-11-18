FROM node:22-alpine
ENV COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack
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
COPY packages/utils packages/utils
COPY apps/relay apps/relay

WORKDIR /repo/apps/relay
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

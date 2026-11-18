FROM node:22-alpine
ENV COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/chain-watcher/package.json apps/chain-watcher/
COPY packages/config/package.json packages/config/
COPY packages/utils/package.json packages/utils/
COPY packages/tenant/package.json packages/tenant/
COPY packages/db/package.json packages/db/
COPY packages/money/package.json packages/money/
RUN pnpm install --frozen-lockfile --filter @broker/chain-watcher...

COPY packages/config packages/config
COPY packages/utils packages/utils
COPY packages/tenant packages/tenant
COPY packages/db packages/db
COPY packages/money packages/money
COPY apps/chain-watcher apps/chain-watcher

WORKDIR /repo/apps/chain-watcher
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

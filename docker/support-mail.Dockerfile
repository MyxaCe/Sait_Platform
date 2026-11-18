FROM node:22-alpine
ENV COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/support-mail/package.json apps/support-mail/
COPY packages/config/package.json packages/config/
COPY packages/utils/package.json packages/utils/
COPY packages/tenant/package.json packages/tenant/
COPY packages/db/package.json packages/db/
COPY packages/money/package.json packages/money/
COPY packages/storage/package.json packages/storage/
COPY packages/support/package.json packages/support/
RUN pnpm install --frozen-lockfile --filter @broker/support-mail...

COPY packages/config packages/config
COPY packages/utils packages/utils
COPY packages/tenant packages/tenant
COPY packages/db packages/db
COPY packages/money packages/money
COPY packages/storage packages/storage
COPY packages/support packages/support
COPY apps/support-mail apps/support-mail

WORKDIR /repo/apps/support-mail
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

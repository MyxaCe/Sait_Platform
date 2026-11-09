# Наблюдатель сети TRON (USDT TRC20): сверяет заявленные хэши депозитов и
# выплат, ведёт «неопознанные». Ключей нет — кошелёк только наблюдается.
# Сборка из корня монорепо: docker build -f docker/chain-watcher.Dockerfile .
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/chain-watcher/package.json apps/chain-watcher/
COPY packages/config/package.json packages/config/
COPY packages/utils/package.json packages/utils/
COPY packages/tenant/package.json packages/tenant/
# `@broker/db` — гейт схемы на старте (WEB-31), как у консюмера.
COPY packages/db/package.json packages/db/
COPY packages/money/package.json packages/money/
RUN pnpm install --frozen-lockfile --filter @broker/chain-watcher...

COPY packages/config packages/config
COPY packages/utils packages/utils
COPY packages/tenant packages/tenant
COPY packages/db packages/db
COPY packages/money packages/money
COPY apps/chain-watcher apps/chain-watcher

USER node
CMD ["pnpm", "--filter", "@broker/chain-watcher", "start"]

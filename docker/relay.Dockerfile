# Релей outbox → шина платформы.
# Сборка из корня монорепо: docker build -f docker/relay.Dockerfile .
FROM node:22-alpine
# pnpm готовится НА СБОРКЕ и кладётся туда, где его видит USER node.
# Раньше `corepack prepare` клал его в кеш root (/root/.cache), рантайм
# шёл от node, кеша не находил и на КАЖДОМ старте качал pnpm с
# registry.npmjs.org («Corepack is about to download pnpm-9.15.0.tgz»):
# без доступа к npm сервис не стартовал. Теперь кеш общий, а сеть
# corepack'у в рантайме запрещена — пропавший pnpm падает громко, а не
# тихо уходит в интернет.
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

# Старт без pnpm: node + загрузчик tsx (зависимость приложения), один
# процесс — SIGTERM приходит прямо в приложение, а не в обёртку.
# Рабочая папка — папка приложения, как было при `pnpm --filter … start`
# (dotenv и относительные пути смотрят туда же). pnpm в образе остаётся
# для разовых команд, например миграций.
WORKDIR /repo/apps/relay
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

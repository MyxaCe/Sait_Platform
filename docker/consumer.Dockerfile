# Консюмер событий терминала (шина platform.events → проекция кабинета).
# Сборка из корня монорепо: docker build -f docker/consumer.Dockerfile .
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
COPY apps/consumer/package.json apps/consumer/
COPY apps/cabinet/package.json apps/cabinet/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/
# `@broker/tenant` — объявленная зависимость консюмера: `index.ts` первым
# делом зовёт оттуда гейт личности. Пакет завели 06.10, а этот файл за
# ним не пошёл, и образ падал в бесконечный перезапуск с «Cannot find
# module» (B-OPS-029). Копируется и манифест, и исходники: без манифеста
# `pnpm install` не поставит зависимость, без исходников нечего
# импортировать.
COPY packages/tenant/package.json packages/tenant/
# `@broker/db` — гейт схемы на старте (WEB-31). Вместе с манифестом
# едут и миграции: образ, умеющий проверить схему, умеет и применить
# её отдельным шагом выкатки.
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @broker/consumer...

COPY packages/api-client packages/api-client
COPY packages/config packages/config
COPY packages/utils packages/utils
COPY packages/db packages/db
COPY packages/tenant packages/tenant
COPY apps/consumer apps/consumer

# Старт без pnpm: node + загрузчик tsx (зависимость приложения), один
# процесс — SIGTERM приходит прямо в приложение, а не в обёртку.
# Рабочая папка — папка приложения, как было при `pnpm --filter … start`
# (dotenv и относительные пути смотрят туда же). pnpm в образе остаётся
# для разовых команд, например миграций.
WORKDIR /repo/apps/consumer
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

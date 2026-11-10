# Почтовый воркер поддержки (support-mail): SMTP-отправка очереди писем,
# приём ящика по IMAP (IDLE), восстановление обращений, автозакрытие.
# Секреты ящика — только окружением при запуске; без них почта выключена.
# Сборка из корня монорепо: docker build -f docker/support-mail.Dockerfile .
FROM node:22-alpine
# pnpm готовится НА СБОРКЕ и кладётся туда, где его видит USER node — как у
# chain-watcher: в рантайме corepack'у сеть запрещена, старт не качает pnpm.
ENV COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/support-mail/package.json apps/support-mail/
COPY packages/config/package.json packages/config/
COPY packages/utils/package.json packages/utils/
COPY packages/tenant/package.json packages/tenant/
# `@broker/db` — гейт схемы на старте (WEB-31), как у консюмера.
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

# Старт без pnpm: node + загрузчик tsx (зависимость приложения), один процесс —
# SIGTERM приходит прямо в приложение. Разовое восстановление обращений:
#   docker run … node --import tsx src/recover-leads.ts
WORKDIR /repo/apps/support-mail
USER node
ENV COREPACK_ENABLE_NETWORK=0
CMD ["node", "--import", "tsx", "src/index.ts"]

# Runbook: объектное хранилище KYC (MinIO) на стенде — ADM-12 / Р-454 II-1

> **СТАТУС: ПРИМЕНЕНО НА СТЕНДЕ** (`199.195.197.126`, `/srv/broker/site`).
> Этот документ описывает, как хранилище поднято живым, чтобы ожил уже
> выкаченный код `@broker/storage` (экшены просмотра/загрузки KYC). Секретных
> значений здесь НЕТ — только имена и шаги. Реальные ключи — только в
> `/srv/broker/site/.env` (chmod 600, не в git).

## 0. Контракт кода (имена env — из кода, не из головы)

Источник: `packages/storage/src/config.ts` (`loadStorageConfig`) и
`packages/utils/src/env.ts` (`readEnv`). `readEnv` трактует пустую строку как
«не задано» → `S3_BUCKET=` НЕ проходит за заданный бакет (fail-closed).

| Переменная | Обяз. | Смысл |
| --- | --- | --- |
| `S3_BUCKET` | да | Имя бакета. |
| `S3_ACCESS_KEY_ID` | да | Access key приложения. |
| `S3_SECRET_ACCESS_KEY` | да | Secret приложения. |
| `S3_ENDPOINT` | нет | Пусто → AWS S3 по региону; задан → S3-совместимый сервер (MinIO). |
| `S3_REGION` | нет | Умолчание `us-east-1` (SigV4 требует значение; MinIO его игнорирует). |
| `S3_FORCE_PATH_STYLE` | нет | Незадан → `true`, если задан `S3_ENDPOINT`; иначе строка `'true'`/`'false'`. |

Отсутствие любого из трёх обязательных → `StorageNotConfiguredError`
(перечисляет ВСЁ недостающее сразу). Локальной заглушки в проде нет — это
отказ, а не умолчание.

Схема ключа объекта (`packages/storage/src/keys.ts`, `buildKycObjectKey`):

```
kyc/{tenant}/{client}/{doc_kind}/{uuid}
```

- `tenant` — слаг тенанта; в кабинете берётся из `SITE_SLUG` процесса (`apex-ru`).
- `client` — `users.id` клиента из сессии кабинета (не из формы).
- `doc_kind` — закрытый перечень: `identity | selfie_liveness | address_proof | source_of_funds`.
- `uuid` — случайный (неугадываемость).

Каждый сегмент валидируется (пусто/`/`/`\`/`.`/`..` → отказ). View-URL:
`issueViewUrl` подписывает GET через `@aws-sdk/s3-request-presigner`, TTL жёстко
зажат в окно 5–15 мин (`storage.ts`).

## 1. Как поднят MinIO на стенде

- **Образ:** `bitnamilegacy/minio@sha256:451fe68…` — РЕАЛЬНЫЙ MinIO
  (`DEVELOPMENT.2025-05-24T17-08-30Z`, сборка Bitnami). Официальные образы и
  бинарники MinIO с лета-2025 закрыты за аутентификацией/лицензией
  (`docker.io/minio/minio`, `quay.io/minio/minio` → 401/denied; `dl.min.io` →
  410 Gone). `bitnami/minio` переехал в `bitnamilegacy/*` (заморожен). Пин по
  **дайджесту**, не `:latest` (урок прод-CRM).
- **Сервис `minio`** добавлен в `/srv/broker/site/compose.yml` в сеть `inside`
  (та же, по которой admin/cabinet ходят между собой). Определение —
  `storage-minio.service.yml`.
- **Бакет** `broker-kyc` создаётся автоматически (`MINIO_DEFAULT_BUCKETS`) на
  пустом томе при первом старте (владелец — root MinIO).
- **Ключи стенда сгенерированы заново** (`openssl rand`), лежат только в
  `/srv/broker/site/.env`:
  - root MinIO (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) — только для `mc`.
  - **выделенный least-privilege ключ приложения** (`S3_ACCESS_KEY_ID` /
    `S3_SECRET_ACCESS_KEY`): пользователь MinIO `kyc-app-rw` с политикой,
    ограниченной бакетом (`s3:PutObject`/`s3:GetObject` на `broker-kyc/*`,
    `s3:ListBucket`/`s3:GetBucketLocation` на `broker-kyc`).
- **Наружу ничего не проброшено:** S3-порт 9000 — только в сети `inside`;
  консоль 9001 не публикуется. Если понадобится — только `127.0.0.1:9001:9001`.

Провижининг least-privilege пользователя (root-креды из .env, mc в образе):

```bash
docker exec broker-minio mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
# политика kyc-app-rw (scope: broker-kyc), затем:
docker exec broker-minio mc admin user add    local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
docker exec broker-minio mc admin policy attach local kyc-app-rw --user "$S3_ACCESS_KEY_ID"
```

## 2. Storage-env для admin и cabinet

В `environment:` сервисов `cabinet` И `admin` в `/srv/broker/site/compose.yml`
добавлен блок (имена — из §0):

```yaml
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_BUCKET: ${S3_BUCKET}
      S3_FORCE_PATH_STYLE: "true"
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

`${…}` подставляются из `/srv/broker/site/.env` обёрткой `./compose.sh`.
**Образ не менялся** (env — рантайм; гейт OPS-36 не трогаем).

## 3. Применение (ровно это выполнено)

```bash
cd /srv/broker/site
# .env дополнен S3/MinIO-переменными (chmod 600)
./compose.sh up -d minio            # поднять MinIO (создаёт бакет)
# провижининг least-privilege пользователя (см. §1)
./compose.sh up -d admin cabinet    # ТОЛЬКО эти два пересозданы, образ тот же
```

Другие сервисы (`db`, `web`, `relay`, `consumer`, CRM) НЕ тронуты.

## 4. Проверка (наблюдением)

- Бакет: `docker exec broker-minio mc ls local` → `broker-kyc/`.
- View-URL round-trip (креды приложения, сеть `inside`, path-style): `put-object`
  по ключу `kyc/apex-ru/.../identity/<uuid>` → presigned SigV4 GET → **HTTP 200**,
  тело совпадает; тот же объект без подписи → **HTTP 403**. Это ровно механизм
  `issueViewUrl` (presign GetObject) и `putObject`.
- Живые контейнеры admin и cabinet видят endpoint: health MinIO из процесса →
  **HTTP 200**; `S3_*` присутствуют в обоих.

## 5. Остаточные долги и риски

- **View-URL с внутренним endpoint неоткрываем из браузера оператора.** Код
  подписывает URL с хостом `minio:9000` (внутреннее имя), который браузер не
  резолвит. Чтобы операторский просмотр заработал из браузера, MinIO нужен
  браузеро-доступный endpoint (vhost Caddy, напр. `storage.{DOMAIN}` →
  `broker-minio:9000`) и `S3_ENDPOINT` на него (или раздельная схема
  «подпись внутренним / хост публичным»). Гейт guardrail «S3 только внутри сети»
  это сознательно откладывает.
- **Vault.** Ключи в env — ЯВНО временный вариант стенда; целевой дом —
  Vault (`StorageEnvSource` абстрагирует источник: переезд = смена поставщика,
  не правка кода).
- **Шифрование at-rest.** SSE (bucket encryption / KMS) не включено на стенде —
  не сделано.
- **Retention 5 лет.** Lifecycle/object-lock на `kyc/` не настроены — не сделано.
- **Образ Bitnami заморожен** (`bitnamilegacy`): security-патчей не будет;
  для долгого срока — план миграции (Garage/иной S3 или лицензия MinIO).
- **Том без бэкапа:** `broker-site_minio-data` не попадает под фильтр бэкапа
  `postgres|-db-` — для прод-хранения нужен отдельный бэкап/репликация.

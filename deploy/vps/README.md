# Деплой страновой группы на VPS (тестовый контур)

Единый `docker-compose.yml` поднимает нашу «страновую группу»: сайт + кабинет
+ релей + консюмер + MDS + CMS + две свои Postgres. Шина событий и GlitchTip —
чужая общая инфра платформы, к группе НЕ относятся.

## Раскладка на VPS

```
/opt/site-web/
  Sait_Platform/   # исходники (монорепо: web, cabinet, relay, consumer)
  Broker_CMS/      # исходники CMS
  Broker_MDS/      # исходники MDS
  deploy/
    docker-compose.yml   # этот файл
    .env                 # секреты (chmod 600, из .env.example) — НЕ в git
```

Контексты сборки в compose ссылаются на `../Sait_Platform`, `../Broker_CMS`,
`../Broker_MDS` — поэтому три репозитория лежат рядом с `deploy/`.

## Порты (тестовый VPS)

| Сервис | Порт | Наружу |
| --- | --- | --- |
| web (сайт) | 3000 | да |
| cms | 3001 | да (админка + публичный brand) |
| cabinet | 3002 | да |
| mds | 3003 | да (браузер: котировки + иконки) |
| Postgres ×2 | 5432 | нет (только внутри сети compose) |

Заняты платформой (не использовать): 5672/15672 (шина), 8000 (GlitchTip).

## Запуск

```bash
cd /opt/site-web/deploy
cp .env.example .env && nano .env        # заполнить секреты
docker compose up -d --build             # сборка + подъём
docker compose ps                        # статусы
```

`cms-migrate` — одноразовый: applies миграции Payload и сидит apex-ru
(идемпотентно; seed best-effort). `cms` стартует после успешного migrate.

## Шина и обратный контур

- **relay** публикует `lead.submitted` в `platform.events` (кредл `site-web`,
  publish-only — этого достаточно продюсеру).
- **consumer** деплоится БЕЗ `BUS_URL` → простаивает (NullSubscriber): кредл
  `site-web` не может объявить очередь консюмера (403). Нужен отдельный
  бус-пользователь `cabinet` (configure/write/read на `cabinet.terminal-projection`,
  read на exchange) — тогда в env консюмера добавляется `BUS_URL`.

## Смоук после подъёма

```bash
curl -s http://$VPS_HOST:3003/health            # MDS: providers, instruments
curl -s http://$VPS_HOST:3001/v1/health         # CMS: db ok
curl -s http://$VPS_HOST:3000/ | head -c 200    # сайт отвечает
curl -s http://$VPS_HOST:3002/api/health        # кабинет
```

## Прод (позже)

TLS (reverse-proxy Caddy/nginx + Let's Encrypt на домены), фаервол (Postgres и
внутренние порты не наружу), amqps для шины, секреты из vault. Этот compose —
основа будущего «установщика страны» (карточка сайта в CMS → сид → эта группа).

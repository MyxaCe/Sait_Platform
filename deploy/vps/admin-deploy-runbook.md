# Runbook: выкат центра управления `broker-admin` (ADM-01) на прод-витрину

> **СТАТУС: ШАГИ К ПРИМЕНЕНИЮ ВЛАДЕЛЬЦЕМ. НИЧЕГО ИЗ НИЖЕ НЕ ПРИМЕНЕНО.**
> Этот документ описывает серверную часть выката. Агент работал только в
> репозитории: не пушил, не деплоил, не ходил по SSH, стенд не трогал.
> Все команды ниже выполняет владелец вручную на боевом хосте.

Контекст: образ `ghcr.io/myxace/broker-admin` собирает CI (`.github/workflows/publish-images.yml`,
гейт OPS-36 — образ появляется только на зелёном коммите; тег = полный хеш
коммита, `latest` запрещён). Сервер образ только скачивает. Поверхность
`apps/admin` слушает порт **3005**, закрыта по умолчанию (fail-closed, Р-394):
без `ADMIN_SESSION_SECRET` ни один токен не валиден и войти нельзя — это
безопасный дефолт, а не поломка.

Предполагаемая раскладка прод-витрины (по аналогии с cabinet):
- прод-compose витрины: `/srv/broker/site/compose.yml`
- env_file сайта: рядом с compose (например `/srv/broker/site/.env`, `chmod 600`, не в git)
- обратный прокси: `/srv/broker/proxy/Caddyfile`
- ревизия к выкату: переменная `SITE_REVISION` (полный хеш коммита) в env прод-compose

---

## 0. Предусловия

- [ ] Коммит с `apps/admin` + `docker/admin.Dockerfile` смержен и зелёный в CI;
      образ `ghcr.io/myxace/broker-admin:<SHA>` опубликован (проверить в итоге
      прогона workflow «Образы»: печатается digest).
- [ ] `SITE_REVISION` в прод-env указывает на этот `<SHA>` (тот же тег, что у
      остальных сервисов витрины данной ревизии).
- [ ] Если пакет `broker-admin` в ghcr приватный — на хосте есть `docker login
      ghcr.io` токеном на чтение пакетов (как для прочих broker-*).

## 1. Секрет операторской сессии `ADMIN_SESSION_SECRET`

Длинная случайная строка, HS256-подпись операторской сессии. Отдельный от
клиентских секретов кабинета (Р-395). Без него гейт закрыт — войти нельзя.

Сгенерировать (на хосте, node есть в любом из контейнеров; либо openssl):

```bash
# вариант node
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# или openssl
openssl rand -base64 32
```

Положить значение в **env_file сайта** (не в git, не в compose, не в образ):

```bash
# /srv/broker/site/.env  (chmod 600)
ADMIN_SESSION_SECRET=<сгенерированная_строка>
```

> Секрет приходит ОКРУЖЕНИЕМ при запуске. В образ он не вшивается, в репозиторий
> не попадает (репозиторий публичный, пуш = публикация, Р-012).

## 2. Сервис `broker-admin` в прод-compose `/srv/broker/site/compose.yml`

Добавить сервис по образцу `broker-cabinet` этой витрины (те же сети, тот же
`env_file`, образ по `${SITE_REVISION}`, без проброса порта наружу — наружу
ходит только Caddy):

```yaml
  broker-admin:
    image: ghcr.io/myxace/broker-admin:${SITE_REVISION}
    container_name: broker-admin
    env_file:
      - .env            # тот же env_file витрины; отсюда берётся ADMIN_SESSION_SECRET
    environment:
      # ОБЯЗАТЕЛЬНО. Без него поверхность fail-closed (Р-394): контейнер
      # поднимется и ответит на /api/health, но вход закрыт — войти нельзя.
      ADMIN_SESSION_SECRET: ${ADMIN_SESSION_SECRET}
    networks:
      - <та_же_сеть_что_у_broker-cabinet>   # напр. site-net / proxy-net, как у cabinet
    expose:
      - '3005'          # только внутри сети compose; порт наружу НЕ пробрасываем
    restart: unless-stopped
```

> Сверить по живому `compose.yml`: имя сети и состав `networks` взять ровно те,
> что стоят у `broker-cabinet` (у admin должна быть как минимум общая сеть с
> Caddy, чтобы `reverse_proxy broker-admin:3005` разрешался по имени контейнера).
> Публичных адресов (`NEXT_PUBLIC_*`) у admin нет — окружения, как у cabinet, не
> требуется, кроме `ADMIN_SESSION_SECRET`.

## 3. Маршрут Caddy `/srv/broker/proxy/Caddyfile`

Добавить блок по образцу `cabinet.{$DOMAIN}` (TLS Caddy выпускает сам):

```caddyfile
admin.{$DOMAIN} {
    reverse_proxy broker-admin:3005
}
```

При `DOMAIN=wholesalefy.com` это `admin.wholesalefy.com`.

### 3a. Защита в глубину (РЕКОМЕНДАЦИЯ, опция)

Admin — операторский периметр. Поверх сессионного гейта приложения стоит
дополнительно закрыть маршрут IP-фильтром на уровне Caddy, как это сделано для
cms-админки (`ADMIN_IP`). Это defence-in-depth: гейт приложения остаётся
авторитетом, а Caddy отсекает чужие адреса ещё до него.

```caddyfile
admin.{$DOMAIN} {
    @allowed remote_ip {$ADMIN_IP}
    handle @allowed {
        reverse_proxy broker-admin:3005
    }
    respond 403
}
```

> `ADMIN_IP` — тот же механизм и та же переменная, что фильтрует cms-админку.
> Ловушки из карты хоста: это должен быть РЕАЛЬНЫЙ адрес оператора, не `.179`
> и не `.4` (известные ложные адреса). Опция: если включаете — сверьте
> `ADMIN_IP` в env прокси.

## 4. DNS

Завести A-запись поддомена на боевой хост:

```
admin.wholesalefy.com.  A  199.195.197.126
```

(Тот же хост, что у остальной витрины. Caddy выпустит сертификат на поддомен
автоматически после того, как DNS разрешается и маршрут поднят.)

## 5. Применение и смоук

```bash
cd /srv/broker/site
docker compose pull broker-admin          # скачать образ ревизии SITE_REVISION
docker compose up -d broker-admin         # поднять сервис
docker compose ps broker-admin            # статус

# перечитать конфиг прокси (способ — как принято на хосте для Caddy)
cd /srv/broker/proxy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile

# смоук: health публичен (гейт его не трогает), показывает готовность секрета
curl -s https://admin.wholesalefy.com/api/health
#  ожидаем: {"status":"ok","service":"admin","sessionSecret":"set",...}
#  если "sessionSecret":"unset" — ADMIN_SESSION_SECRET не долетел, вход закрыт

# гейт закрыт: без сессии любая внутренняя страница редиректит на /login
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://admin.wholesalefy.com/
#  ожидаем редирект на /login (fail-closed)
```

## 6. Откат

```bash
cd /srv/broker/site
# вернуть SITE_REVISION на прошлый хеш коммита (тег неизменяем, образ тот же),
# либо остановить сервис, если выкат отменяется:
docker compose stop broker-admin
# при необходимости убрать блок admin.{$DOMAIN} из Caddyfile и reload.
```

---

### Чек-лист применения (всё — руками владельца)
- [ ] `ADMIN_SESSION_SECRET` сгенерирован и записан в env_file сайта (chmod 600)
- [ ] сервис `broker-admin` добавлен в `/srv/broker/site/compose.yml` (сети как у cabinet)
- [ ] блок `admin.{$DOMAIN}` добавлен в `/srv/broker/proxy/Caddyfile`
- [ ] (опция) IP-гейт `ADMIN_IP` на маршруте admin в Caddy
- [ ] A-запись `admin.wholesalefy.com` → `199.195.197.126`
- [ ] `docker compose up -d broker-admin` + reload Caddy
- [ ] смоук: `/api/health` → `sessionSecret:"set"`; `/` → редирект на `/login`

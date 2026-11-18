#!/bin/sh
set -eu

ROOT="${RUNTIME_CONFIG_ROOT:-/app/apps}"

CANDIDATES="$(find "$ROOT" -type d \( -name node_modules -o -path '*/.next/cache' \) -prune -o -type f   \( -name '*.js' -o -name '*.html' -o -name '*.json' -o -name '*.css' -o -name '*.txt' \)   -print 2>/dev/null)"

PAIRS="https://runtime-site-url.invalid|NEXT_PUBLIC_SITE_URL|required
https://runtime-cabinet-url.invalid|NEXT_PUBLIC_CABINET_URL|required
https://runtime-terminal-url.invalid|NEXT_PUBLIC_TERMINAL_URL|required
https://runtime-ws-url.invalid|NEXT_PUBLIC_WS_URL|optional
https://runtime-frame-ancestors.invalid|FRAME_ANCESTORS|fallback:'none'"

printf '%s\n' "$PAIRS" | while IFS='|' read -r placeholder var need; do
  [ -z "$placeholder" ] && continue

  files="$(printf '%s
' "$CANDIDATES" | xargs -r grep -l "$placeholder" 2>/dev/null || true)"
  [ -z "$files" ] && continue

  raw="$(printenv "$var" 2>/dev/null || true)"
  value="$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  case "$need" in
    fallback:*)
      if [ -z "$value" ]; then
        value="${need#fallback:}"
        echo "[runtime-config] $var не задана — подставляем безопасное: $value"
      fi
      ;;
  esac

  if [ -z "$value" ] && [ "$need" = required ]; then
    echo "[runtime-config] $var не задана, а сборка её ждёт ($placeholder)." >&2
    echo "[runtime-config] Образ не знает домена сознательно (Р-220): адрес приходит" >&2
    echo "[runtime-config] окружением. Без него ссылки вели бы в никуда." >&2
    exit 1
  fi

  printf '%s\n' "$files" | while IFS= read -r file; do
    [ -n "$file" ] && sed -i "s|$placeholder|$value|g" "$file"
  done
  if [ -z "$value" ]; then
    echo "[runtime-config] $var пуста — подставляем пустое: режим без неё законен"
  else
    echo "[runtime-config] $var -> $value"
  fi
done

exec "$@"

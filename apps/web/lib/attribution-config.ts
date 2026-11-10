import { envOr } from '@broker/utils';

/**
 * Срок first-click атрибуции — ИЗ НАСТРОЕК ПЛАТФОРМЫ (админка,
 * `platform_promo_settings.attribution_window_days`). У витрины нет базы,
 * поэтому срок читается с сервера сайта: публичная ручка кабинета
 * `/api/public/platform-terms`. Адрес — `CABINET_INTERNAL_URL` (внутренняя
 * сеть), иначе публичный адрес кабинета.
 *
 * Кеш в памяти процесса (минута) — middleware не ходит в кабинет на каждый
 * клик. Кабинет недоступен — `null`: cookie ставится сессионной, а срок всё
 * равно проверит регистрация по метке времени в значении (свой failure domain:
 * витрина не ждёт кабинет больше короткого таймаута).
 */
const TTL_MS = 60_000;
const TIMEOUT_MS = 800;

let cache: { at: number; days: number | null } | null = null;

export async function attributionWindowDays(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<number | null> {
  if (cache && now - cache.at < TTL_MS) return cache.days;
  const base = envOr(process.env.CABINET_INTERNAL_URL, envOr(process.env.NEXT_PUBLIC_CABINET_URL, '')).replace(/\/$/, '');
  let days: number | null = null;
  if (base) {
    try {
      const res = await fetchImpl(`${base}/api/public/platform-terms`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const v = Number(((await res.json()) as { attributionWindowDays?: unknown }).attributionWindowDays);
        days = Number.isInteger(v) && v >= 1 && v <= 365 ? v : null;
      }
    } catch {
      days = null;
    }
  }
  cache = { at: now, days };
  return days;
}

/** Для тестов. */
export function resetAttributionConfigCache(): void {
  cache = null;
}

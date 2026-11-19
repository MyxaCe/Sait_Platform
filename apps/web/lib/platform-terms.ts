import { parseLiveSnapshot, type LiveSnapshot } from '@broker/live-params';
import { envOr } from '@broker/utils';

/**
 * Настройки платформы для витрины — ТОЛЬКО из админки (решение владельца
 * №9): публичная ручка кабинета `GET /api/public/platform-terms`, поле
 * `live` (у витрины нет базы). Адрес — `CABINET_INTERNAL_URL`, иначе
 * публичный адрес кабинета. Кеш данных Next — 60 с.
 *
 * Кабинет недоступен или ответ не разобран — `null`: страницы честно
 * говорят «временно недоступно», а параметры в текстах становятся «—».
 */

const TIMEOUT_MS = 1_500;

export function platformTermsUrl(): string | null {
  const base = envOr(process.env.CABINET_INTERNAL_URL, envOr(process.env.NEXT_PUBLIC_CABINET_URL, '')).replace(/\/$/, '');
  return base ? `${base}/api/public/platform-terms` : null;
}

export function parsePlatformTerms(body: unknown): LiveSnapshot | null {
  const live = (body as { live?: unknown } | null)?.live;
  if (!live || typeof live !== 'object') return null;
  return parseLiveSnapshot(live);
}

export async function fetchLiveSnapshot(fetchImpl: typeof fetch = fetch): Promise<LiveSnapshot | null> {
  const url = platformTermsUrl();
  if (!url) return null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 60 },
    } as RequestInit);
    if (!res.ok) return null;
    return parsePlatformTerms(await res.json());
  } catch {
    return null;
  }
}

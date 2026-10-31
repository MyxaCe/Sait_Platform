/**
 * Скользящее окно в памяти процесса — та же копия, что в кабинете и на сайте
 * (унификация в packages/utils — тех. долг TD-011). Для центра управления
 * этого достаточно: вход — редкое событие, брутфорс по логину тормозится
 * одним экземпляром; жёсткая гарантия у стоимости argon2id-хеша.
 */
const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, limit = 5, windowMs = 60_000, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

export function __resetRateLimit() {
  buckets.clear();
}

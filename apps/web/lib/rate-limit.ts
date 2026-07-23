/**
 * Простой in-memory rate-limit для BFF-роутов.
 * Достаточен для одного инстанса; при горизонтальном масштабировании
 * заменяется на Redis (@upstash/ratelimit) без изменения вызовов.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export function isRateLimited(
  key: string,
  { windowMs = 60_000, max = 5 }: RateLimitOptions = {},
): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);

  // Периодическая уборка, чтобы Map не рос бесконечно
  if (buckets.size > 10_000) {
    for (const [k, times] of buckets) {
      if (times.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return recent.length > max;
}

export function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
}

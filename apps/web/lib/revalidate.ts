import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Логика вебхука инвалидации контента (спецификация §6):
 * HMAC-подпись, дедупликация по event_id, cooldown против шторма
 * инвалидаций (риск R-10). Чистые функции — покрыты unit-тестами.
 */

export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Разрешены только контентные теги — вебхук не может инвалидировать произвольный кеш */
export const ALLOWED_TAG_PATTERN = /^cms:[a-z0-9-]+(:[a-z0-9-]+)?$/;

const DEFAULT_COOLDOWN_MS = 2_000;
const lastInvalidatedAt = new Map<string, number>();

/** Анти-шторм: тот же тег не инвалидируется чаще, чем раз в cooldown. */
export function shouldInvalidate(
  tag: string,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
): boolean {
  const last = lastInvalidatedAt.get(tag);
  if (last !== undefined && now - last < cooldownMs) return false;
  lastInvalidatedAt.set(tag, now);
  return true;
}

const pendingTags = new Set<string>();

/**
 * Тег попал в cooldown: не терять инвалидацию (B-011), а отложить одну
 * до истечения cooldown. Первый «опоздавший» запрос забирает право на
 * отложенную инвалидацию (возвращается задержка в мс) и обязан выполнить её
 * САМ, дождавшись `delay` внутри своего обработчика: revalidateTag() работает
 * только в контексте запроса — setTimeout после ответа был бы тихим no-op.
 * Остальные события на тот же тег коалесцируются (null) — шторм невозможен.
 */
export function claimDeferredInvalidate(
  tag: string,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
): number | null {
  if (pendingTags.has(tag)) return null;
  pendingTags.add(tag);
  const last = lastInvalidatedAt.get(tag) ?? now;
  return Math.max(0, last + cooldownMs - now) + 50;
}

/** Вызывается сразу после выполненной отложенной инвалидации. */
export function completeDeferredInvalidate(tag: string, now = Date.now()): void {
  pendingTags.delete(tag);
  lastInvalidatedAt.set(tag, now);
}

const SEEN_LIMIT = 1_000;
const seenOrder: string[] = [];
const seenSet = new Set<string>();

/** Идемпотентность: повторная доставка того же event_id не инвалидирует повторно. */
export function isDuplicateEvent(eventId: string): boolean {
  if (seenSet.has(eventId)) return true;
  seenSet.add(eventId);
  seenOrder.push(eventId);
  if (seenOrder.length > SEEN_LIMIT) {
    const oldest = seenOrder.shift();
    if (oldest) seenSet.delete(oldest);
  }
  return false;
}

/** Только для unit-тестов */
export function __resetRevalidateState() {
  lastInvalidatedAt.clear();
  seenOrder.length = 0;
  seenSet.clear();
  pendingTags.clear();
}

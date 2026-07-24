/** Экспоненциальный backoff с потолком: 5s, 25s, 125s, ... максимум 1 час. */
export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 3_600_000;

export function nextDelayMs(attempts: number): number {
  const delay = BASE_DELAY_MS * Math.pow(5, Math.max(0, attempts - 1));
  return Math.min(delay, MAX_DELAY_MS);
}

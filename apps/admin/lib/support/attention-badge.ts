export const ATTENTION_POLL_SECONDS = 30;

export function attentionBadgeText(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.trunc(count));
}

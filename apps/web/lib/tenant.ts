/**
 * Доступ сайта к инструментам — allow-list с карточки сайта в CMS
 * (конфиг тенанта /v1/cms/sites/{slug}). Это ГРАНИЦА ДОСТУПА (ADR-028):
 * тикер, браузер инструментов и деталки показывают только пересечение
 * контента с этим списком. null — CMS недоступна или список не настроен:
 * деградируем «открыто» (прежнее поведение), сайт живёт без соседей.
 * Инвалидация — вебхук карточки сайта (тег cms:brand[:slug]).
 */
export async function getTenantAllowList(): Promise<Set<string> | null> {
  const base = process.env.CMS_API_URL?.replace(/\/$/, '');
  if (!base) return null;
  const slug = process.env.SITE_SLUG ?? 'apex-ru';
  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
      next: { revalidate: 300, tags: ['cms:brand', `cms:brand:${slug}`] },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { instruments?: unknown };
    if (!Array.isArray(data.instruments) || data.instruments.length === 0) return null;
    return new Set(data.instruments.map(String));
  } catch {
    return null;
  }
}

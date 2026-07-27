/**
 * Конфиг тенанта из CMS (карточка сайта, /v1/cms/sites/{slug}, под ключом
 * server-side): стартовый демо-баланс и allow-list инструментов. Единый
 * источник для регистрации (стартовый баланс), модуля «Рынки» (allow-list)
 * и demo-reset. CMS недоступна → дефолты: кабинет живёт без соседей.
 */

const DEFAULT_START_BALANCE_CENTS = 1_000_000; // $10 000

export interface TenantConfig {
  demoStartBalanceCents: number;
  /** allow-list инструментов; null — CMS недоступна (деградация «открыто») */
  instruments: Set<string> | null;
}

export async function getTenantConfig(): Promise<TenantConfig> {
  const base = process.env.CMS_API_URL?.replace(/\/$/, '');
  const slug = process.env.SITE_SLUG ?? 'apex-ru';
  if (!base) return { demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS, instruments: null };
  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS, instruments: null };
    const data = (await res.json()) as { demoStartBalanceCents?: unknown; instruments?: unknown };
    const cents = Number(data.demoStartBalanceCents);
    return {
      demoStartBalanceCents: Number.isFinite(cents) && cents > 0 ? cents : DEFAULT_START_BALANCE_CENTS,
      instruments: Array.isArray(data.instruments) ? new Set(data.instruments.map(String)) : null,
    };
  } catch {
    return { demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS, instruments: null };
  }
}

/** Стартовый демо-баланс тенанта (центы); фолбэк — $10 000. */
export async function getTenantStartBalanceCents(): Promise<number> {
  return (await getTenantConfig()).demoStartBalanceCents;
}

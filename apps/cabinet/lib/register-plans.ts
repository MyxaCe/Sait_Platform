import { accountOffers, defaultPortfolio, portfolioLeverage, publicPortfolios, type CmsAccountPlanLike } from '@broker/live-params';
import { TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import type { RegisterPlan } from '@/features/auth/PlanPicker';
import { cmsGet } from './chrome';
import { getLiveSnapshot } from './live-params';

export function cmsAccountPlans(data: unknown): CmsAccountPlanLike[] | null {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((raw): CmsAccountPlanLike[] => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id.trim()) return [];
    const features = Array.isArray(r.features)
      ? r.features.flatMap((f) => {
          const x = f as { label?: unknown; value?: unknown } | null;
          return x && typeof x.label === 'string' && typeof x.value === 'string' ? [{ label: x.label, value: x.value }] : [];
        })
      : [];
    const portfolioKey = typeof r.portfolioKey === 'string' && r.portfolioKey.trim() ? r.portfolioKey.trim() : null;
    return [{ id: r.id, portfolioKey, description: typeof r.description === 'string' ? r.description : null, featured: r.featured === true, features }];
  });
}

export async function loadRegisterPlans(
  locale: string,
  requested?: string,
): Promise<{ plans: RegisterPlan[]; selected: string | null }> {
  const [live, cms] = await Promise.all([getLiveSnapshot(), cmsGet('accounts', locale)]);
  const portfolios = publicPortfolios(live) ?? [];
  const plans = accountOffers(portfolios, cmsAccountPlans(cms)).map(({ portfolio: p, description, features }) => ({
    key: p.key,
    title: p.title,
    leverage: portfolioLeverage(p, TERMINAL_INSTRUMENT_CLASS),
    baseLeverage: p.baseLeverage,
    classOverrides: p.classOverrides,
    markupBps: p.markupBps,
    commissionBps: p.commissionBps,
    description,
    features,
  }));
  const keys = new Set(plans.map((p) => p.key));
  const fallback = defaultPortfolio(live)?.key;
  const selected =
    requested && keys.has(requested) ? requested : fallback && keys.has(fallback) ? fallback : (plans[0]?.key ?? null);
  return { plans, selected };
}

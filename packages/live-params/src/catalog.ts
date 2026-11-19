import type { LivePortfolio, LivePromotion, LivePromotionText } from './snapshot';

export interface CmsAccountPlanLike {
  id: string;
  description?: string | null;
  featured?: boolean;
  features?: readonly { label: string; value: string }[];
}

export interface AccountOffer {
  portfolio: LivePortfolio;
  description: string | null;
  featured: boolean;
  features: { label: string; value: string }[];
}

export function accountOffers(portfolios: readonly LivePortfolio[], plans: readonly CmsAccountPlanLike[] | null): AccountOffer[] {
  const byId = new Map((plans ?? []).map((p) => [p.id.trim(), p]));
  return portfolios.map((portfolio) => {
    const plan = byId.get(portfolio.key);
    return {
      portfolio,
      description: plan?.description?.trim() || null,
      featured: plan?.featured === true,
      features: (plan?.features ?? []).filter((f) => f.label.trim() && f.value.trim()).map((f) => ({ label: f.label, value: f.value })),
    };
  });
}

export interface CmsPromotionLike<Image = unknown> {
  id: string;
  badge?: string | null;
  title?: string | null;
  description?: string | null;
  terms?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  featured?: boolean;
  image?: Image | null;
}

export interface PromotionOffer<Image = unknown> {
  id: string;
  slug: string;
  type: string;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  description: string;
  terms: string;
  badge: string | null;
  ctaLabel: string | null;
  ctaHref: string;
  featured: boolean;
  image: Image | null;
}

function engineText(promo: LivePromotion, locale: string): LivePromotionText | null {
  const order = locale === 'ru' || locale === 'en' ? [locale, locale === 'ru' ? 'en' : 'ru'] : [locale, 'en', 'ru'];
  for (const l of order) if (promo.texts[l]) return promo.texts[l]!;
  return Object.values(promo.texts)[0] ?? null;
}

const filled = (v: string | null | undefined): string | null => (v && v.trim() ? v : null);

export function promotionOffers<Image>(
  promotions: readonly LivePromotion[],
  cms: readonly CmsPromotionLike<Image>[] | null,
  locale: string,
): PromotionOffer<Image>[] {
  const byId = new Map((cms ?? []).map((c) => [c.id.trim(), c]));
  return promotions.map((promo) => {
    const item = [promo.cmsPromoId, promo.slug, promo.id].map((k) => (k ? byId.get(k) : undefined)).find(Boolean);
    const text = engineText(promo, locale);
    return {
      id: promo.id,
      slug: promo.slug,
      type: promo.type,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      title: filled(item?.title) ?? text?.title ?? promo.slug,
      description: filled(item?.description) ?? text?.summary ?? '',
      terms: filled(item?.terms) ?? text?.terms ?? '',
      badge: filled(item?.badge),
      ctaLabel: filled(item?.ctaLabel),
      ctaHref: filled(item?.ctaHref) ?? `/register?promo=${encodeURIComponent(promo.slug)}`,
      featured: item?.featured === true,
      image: item?.image ?? null,
    };
  });
}

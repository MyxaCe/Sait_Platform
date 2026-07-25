import { getTranslations } from 'next-intl/server';
import { cn } from '@broker/ui';
import { siteHref } from '@/lib/chrome';
import type { PromoItem } from '@/lib/home';

/** Модуль «Акции»: активные промо из CMS (ресурс promotions того же сайта). */
export async function PromotionsModule({
  items,
  locale,
}: {
  items: PromoItem[];
  locale: string;
}) {
  const t = await getTranslations('home');
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="font-semibold">{t('promoTitle')}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((promo) => (
          <div
            key={promo.id}
            className={cn(
              'flex flex-col rounded-2xl border p-4',
              promo.featured ? 'border-accent/40 bg-accent/5' : 'border-border bg-elevated',
            )}
          >
            <span className="self-start rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              {promo.badge}
            </span>
            <h3 className="mt-2 font-semibold">{promo.title}</h3>
            <p className="mt-1 flex-1 text-sm text-secondary">{promo.description}</p>
            <a
              href={siteHref(promo.ctaHref, locale)}
              className="mt-3 text-sm font-medium text-accent hover:underline"
            >
              {promo.ctaLabel} →
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

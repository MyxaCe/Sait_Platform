import { useTranslations } from 'next-intl';
import { cn, Money, ToneBadge } from '@broker/ui';
import type { ClientPromotionsView } from '@broker/promo';
import { Link } from '@/i18n/navigation';
import { ConditionList } from '@/features/promo/ConditionList';
import { participationBadge } from '@/features/promo/PromoCards';
import { RulesList, useRuleLines } from '@/features/promo/RulesSummary';
import { pickHomePromos, PROMO_CURRENCY, type HomePromo } from '@/features/promo/format';

/**
 * Модуль «Акции» на главной — РЕАЛЬНЫЕ данные `@broker/promo` (раньше —
 * витринные карточки CMS). 1–2 самые релевантные: мои участия с прогрессом,
 * иначе доступные к вступлению. Выключено / не загрузилось — короткое
 * честное сообщение со ссылкой на раздел (модуль не исчезает молча).
 */
export function PromotionsModule({ view, now }: { view: ClientPromotionsView | null; now?: Date }) {
  const t = useTranslations('promo');

  if (view === null) {
    return (
      <section aria-labelledby="home-promo">
        <Head />
        <p className="mt-3 rounded-2xl border border-border bg-elevated px-4 py-3 text-sm text-secondary">{t('home.unavailable')}</p>
      </section>
    );
  }

  const picks = pickHomePromos(view);
  if (!view.enabled && view.disabledReason && picks.every((p) => p.kind !== 'participation')) {
    return (
      <section aria-labelledby="home-promo">
        <Head />
        <div className="mt-3 rounded-2xl border border-border bg-elevated px-4 py-3">
          <p className="text-sm font-medium">{t(`disabled.${view.disabledReason}.title`)}</p>
        </div>
      </section>
    );
  }
  if (picks.length === 0) return null;

  return (
    <section aria-labelledby="home-promo">
      <Head />
      <div className={cn('mt-3 grid gap-3', picks.length > 1 && 'sm:grid-cols-2')}>
        {picks.map((p) => (
          <HomeCard key={p.kind === 'participation' ? p.item.promotionId : p.item.id} pick={p} now={now} />
        ))}
      </div>
    </section>
  );
}

function Head() {
  const t = useTranslations('promo');
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="home-promo" className="font-semibold">
        {t('home.title')}
      </h2>
      <Link href="/promotions" className="text-sm font-medium text-accent hover:underline">
        {t('home.all')} →
      </Link>
    </div>
  );
}

function HomeCard({ pick, now }: { pick: HomePromo; now?: Date }) {
  const t = useTranslations('promo');
  const lines = useRuleLines(pick.item.rules);
  if (pick.kind === 'available') {
    const a = pick.item;
    return (
      <Link
        href={a.type === 'contest' ? '/contest' : '/promotions'}
        className="flex flex-col gap-2 rounded-2xl border border-accent/30 bg-accent/[0.04] p-4 transition-colors hover:bg-accent/[0.08]"
        data-home-promo={a.slug}
      >
        <ToneBadge tone="info" plain className="self-start">
          {t(`type.${a.type}`)}
        </ToneBadge>
        <h3 className="font-semibold">{a.texts.title}</h3>
        {a.texts.summary ? <p className="text-sm text-secondary">{a.texts.summary}</p> : <RulesList lines={lines.slice(0, 2)} />}
        <span className="mt-auto pt-1 text-sm font-medium text-accent">{a.enrollable ? t('enroll') : t('toContest')} →</span>
      </Link>
    );
  }
  const p = pick.item;
  const badge = participationBadge(p);
  const conds = p.conditions.filter((c) => c.key !== 'window');
  const met = conds.filter((c) => c.met).length;
  return (
    <Link
      href="/promotions"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-elevated p-4 transition-colors hover:border-border-strong"
      data-home-promo={p.slug}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-semibold">{p.texts.title}</h3>
        <ToneBadge tone={badge.tone} className="shrink-0">
          {t(badge.key)}
        </ToneBadge>
      </div>
      {p.cashback ? (
        <p className="flex items-baseline justify-between text-sm">
          <span className="text-secondary">{t('cashback.accrued')}</span>
          <Money minor={p.cashback.cashbackMinor} currency={PROMO_CURRENCY} className="font-semibold" />
        </p>
      ) : (
        <>
          <ConditionList conditions={conds.filter((c) => c.key === 'turnover')} deadline={p.deadline} now={now} compact />
          {conds.length > 0 ? <p className="text-xs text-muted">{t('home.conditionsMet', { met, total: conds.length })}</p> : null}
          {p.expectedRewardMinor !== null ? (
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-secondary">{t('expectedReward')}</span>
              <Money minor={p.expectedRewardMinor} currency={PROMO_CURRENCY} className="font-semibold" />
            </p>
          ) : null}
        </>
      )}
    </Link>
  );
}

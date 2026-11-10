import { useTranslations } from 'next-intl';
import { Callout, EmptyState } from '@broker/ui';
import type { ClientPromotionsView } from '@broker/promo';
import { AvailablePromoCard, CARD, ParticipationCard } from './PromoCards';
import { RewardList } from './RewardList';

/**
 * Экран «Акции» (синхронный — рисуется и в тесте с пустыми/частичными данными).
 * Порядок по важности для клиента: мои участия → доступные → начисления.
 * Выключено (`enabled=false`) — честная причина; раздел не исчезает, деньги
 * клиента (начисления) и его участия видны всегда.
 */
export function PromotionsScreen({ view, now }: { view: ClientPromotionsView | null; now?: Date }) {
  const t = useTranslations('promo');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('lead')}</p>
      </header>

      {view === null ? (
        <Callout tone="warning" title={t('unavailableTitle')}>
          {t('unavailable')}
        </Callout>
      ) : (
        <>
          {!view.enabled && view.disabledReason ? (
            <Callout tone="info" title={t(`disabled.${view.disabledReason}.title`)}>
              {t(`disabled.${view.disabledReason}.body`)}
            </Callout>
          ) : null}

          {view.participating.length > 0 ? (
            <section aria-labelledby="promo-mine" className="space-y-3">
              <SectionTitle id="promo-mine" count={view.participating.length}>
                {t('participatingTitle')}
              </SectionTitle>
              <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
                {view.participating.map((p) => (
                  <ParticipationCard key={p.promotionId} p={p} now={now} />
                ))}
              </div>
            </section>
          ) : null}

          {view.enabled ? (
            <section aria-labelledby="promo-available" className="space-y-3">
              <SectionTitle id="promo-available" count={view.available.length}>
                {t('availableTitle')}
              </SectionTitle>
              {view.available.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
                  {[...view.available].sort((a, b) => Number(b.enrollable) - Number(a.enrollable)).map((p) => (
                    <AvailablePromoCard key={p.id} promo={p} />
                  ))}
                </div>
              ) : (
                <div className={CARD}>
                  <EmptyState size="compact" title={t('availableEmpty')} />
                </div>
              )}
            </section>
          ) : null}

          <section aria-labelledby="promo-rewards" className="space-y-3">
            <SectionTitle id="promo-rewards" count={view.rewards.length}>
              {t('rewardsTitle')}
            </SectionTitle>
            <div className={CARD}>
              <RewardList rewards={view.rewards} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function SectionTitle({ id, count, children }: { id: string; count?: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 font-semibold">
      {children}
      {count ? (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary/[0.08] px-1.5 text-[11px] font-semibold tabular-nums text-secondary">
          {count}
        </span>
      ) : null}
    </h2>
  );
}

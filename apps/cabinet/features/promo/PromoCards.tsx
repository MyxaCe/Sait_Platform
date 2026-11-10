import { useLocale, useTranslations } from 'next-intl';
import { cn, Money, ToneBadge, type StatusTone } from '@broker/ui';
import type { ParticipationView, PromoCardView } from '@broker/promo';
import { Link } from '@/i18n/navigation';
import { linkButton } from '@/features/ui/link-button';
import { ConditionList } from './ConditionList';
import { EnrollForm } from './EnrollForm';
import { FullTerms, RulesList, useRuleLines } from './RulesSummary';
import { formatDate, formatPeriod, PROMO_CURRENCY } from './format';

export const CARD = 'rounded-2xl border border-border bg-elevated p-4 sm:p-5';

/** Карточка доступной акции: заголовок, суть, ключевые условия, срок, «Участвовать». */
export function AvailablePromoCard({ promo }: { promo: PromoCardView }) {
  const t = useTranslations('promo');
  const locale = useLocale();
  const lines = useRuleLines(promo.rules);
  const until = formatDate(promo.endsAt, locale);
  const starts = promo.startsAt && Date.parse(promo.startsAt) > Date.now() ? formatDate(promo.startsAt, locale) : null;

  return (
    <article className={cn(CARD, 'flex flex-col gap-3')} data-promo={promo.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone="info" plain>
          {t(`type.${promo.type}`)}
        </ToneBadge>
        <span className="text-xs text-muted">
          {starts ? t('startsOn', { date: starts }) : until ? t('endsOn', { date: until }) : t('noEnd')}
        </span>
      </div>
      <div>
        <h3 className="text-[17px] font-semibold leading-6 tracking-tight">{promo.texts.title}</h3>
        {promo.texts.summary ? <p className="mt-1 text-sm text-secondary">{promo.texts.summary}</p> : null}
      </div>
      <RulesList lines={lines.slice(0, 3)} />
      <div className="mt-auto space-y-3 pt-1">
        <FullTerms lines={lines} terms={promo.texts.terms} label={t('fullTerms')} />
        {promo.enrollable ? (
          <EnrollForm promotionId={promo.id} />
        ) : promo.type === 'contest' ? (
          <Link href="/contest" className={linkButton('secondary', 'w-full sm:w-auto')}>
            {t('toContest')}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

const STATE_TONE: Record<string, StatusTone> = {
  in_progress: 'info',
  qualified: 'positive',
  expired: 'neutral',
  not_eligible: 'neutral',
  rewarded: 'positive',
  rejected: 'negative',
};

/** Метка статуса участия: закрытые — по статусу, открытые — по живой оценке. */
export function participationBadge(p: ParticipationView): { key: string; tone: StatusTone } {
  if (p.status === 'rewarded' || p.status === 'rejected' || p.status === 'expired' || p.status === 'not_eligible') {
    return { key: `status.${p.status}`, tone: STATE_TONE[p.status] ?? 'neutral' };
  }
  if (p.status === 'qualified') return { key: 'state.qualified', tone: 'positive' };
  const s = p.state ?? 'in_progress';
  return { key: `state.${s}`, tone: STATE_TONE[s] ?? 'info' };
}

/** «Участвую»: прогресс по каждому условию, срок, ожидаемая награда, полные условия. */
export function ParticipationCard({ p, now }: { p: ParticipationView; now?: Date }) {
  const t = useTranslations('promo');
  const lines = useRuleLines(p.rules);
  const badge = participationBadge(p);
  const open = p.status === 'enrolled' || p.status === 'qualified';

  return (
    <article
      className={cn(CARD, 'space-y-4 xl:grid xl:grid-cols-2 xl:gap-x-8 xl:gap-y-4 xl:space-y-0', open && 'border-accent/30')}
      data-participation={p.slug}
    >
      <div className="flex items-start justify-between gap-3 xl:col-span-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">{t(`type.${p.type}`)}</p>
          <h3 className="mt-0.5 text-[17px] font-semibold leading-6 tracking-tight">{p.texts.title}</h3>
        </div>
        <ToneBadge tone={badge.tone} className="shrink-0">
          {t(badge.key)}
        </ToneBadge>
      </div>

      <div className="space-y-4">
      {p.cashback ? (
        <CashbackProgress p={p} />
      ) : p.conditions.length > 0 ? (
        <ConditionList conditions={p.conditions} deadline={open ? p.deadline : null} now={now} />
      ) : (
        // Условий-снимка нет (кешбэк после выплаты, старое участие) — суть и главное из правил.
        <div className="space-y-2">
          {p.texts.summary ? <p className="text-sm text-secondary">{p.texts.summary}</p> : null}
          <RulesList lines={lines.slice(0, 3)} />
        </div>
      )}

      {p.reason && !open ? <p className="text-sm text-secondary">{t(`reason.${p.reason}`)}</p> : null}
      </div>

      <div className="space-y-4">

      {open && p.type !== 'cashback' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-sunken px-3.5 py-3">
          <span className="text-sm text-secondary">{t('expectedReward')}</span>
          {p.expectedRewardMinor !== null ? (
            <Money minor={p.expectedRewardMinor} currency={PROMO_CURRENCY} className="text-[17px] font-semibold" />
          ) : (
            <span className="text-sm text-muted">{t('expectedRewardPending')}</span>
          )}
        </div>
      ) : null}

      <FullTerms lines={lines} terms={p.texts.terms} label={t('fullTerms')} />
      </div>
    </article>
  );
}

function CashbackProgress({ p }: { p: ParticipationView }) {
  const t = useTranslations('promo');
  const locale = useLocale();
  const cb = p.cashback!;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{t('cashback.period', { period: formatPeriod(cb.period, locale) ?? cb.period })}</p>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-sunken px-3.5 py-3">
          <dt className="text-xs text-muted">{t('cashback.fees')}</dt>
          <dd className="mt-0.5 text-[15px] font-medium">
            <Money minor={cb.feesMinor} currency={PROMO_CURRENCY} />
          </dd>
        </div>
        <div className="rounded-xl bg-sunken px-3.5 py-3">
          <dt className="text-xs text-muted">{t('cashback.accrued')}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-positive">
            <Money minor={cb.cashbackMinor} currency={PROMO_CURRENCY} />
          </dd>
        </div>
      </dl>
      {cb.belowMinimum ? <p className="text-xs text-secondary">{t('cashback.belowMinimum')}</p> : null}
      {cb.tradesWithoutFees > 0 ? <p className="text-xs text-muted">{t('cashback.withoutFees', { n: cb.tradesWithoutFees })}</p> : null}
    </div>
  );
}


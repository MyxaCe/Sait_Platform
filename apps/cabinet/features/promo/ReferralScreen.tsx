import { useLocale, useTranslations } from 'next-intl';
import { Callout, cn, EmptyState, formatMoney, Money, ToneBadge, type StatusTone } from '@broker/ui';
import type { InviteeStage, InviteeView, MyPartnerView, MyReferralView } from '@broker/promo';
import { CARD } from './PromoCards';
import { SectionTitle } from './PromotionsScreen';
import { REWARD_TONE } from './RewardList';
import { FullTerms } from './RulesSummary';
import { CopyRow, ShareButton } from './ShareLink';
import { bpsPercent, formatDate, formatPeriod, holdParts, PROMO_CURRENCY } from './format';

/**
 * «Пригласи друга» (дизайн §4.1). Ссылка и код, «Поделиться» (Web Share на
 * телефоне), QR, условия программы — из данных, приглашённые с этапом и
 * наградой, итоги. IB-партнёр видит свой договор вместо обычной программы.
 */
export function ReferralScreen({
  data,
  qrSvg,
  brand,
}: {
  data: { referral: MyReferralView; partner: MyPartnerView | null } | null;
  qrSvg: string | null;
  brand: string;
}) {
  const t = useTranslations('referrals');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {data?.referral.isPartner ? t('partner.title') : t('title')}
        </h1>
        <p className="mt-1 text-sm text-secondary">{data?.referral.isPartner ? t('partner.pageLead') : t('lead')}</p>
      </header>

      {data === null ? (
        <Callout tone="warning" title={t('unavailableTitle')}>
          {t('unavailable')}
        </Callout>
      ) : (
        <Body data={data} qrSvg={qrSvg} brand={brand} />
      )}
    </div>
  );
}

function Body({
  data: { referral: r, partner },
  qrSvg,
  brand,
}: {
  data: { referral: MyReferralView; partner: MyPartnerView | null };
  qrSvg: string | null;
  brand: string;
}) {
  const t = useTranslations('referrals');
  return (
    <>
      {!r.enabled && r.disabledReason && !r.isPartner ? (
        <Callout tone="info">{t(`disabled.${r.disabledReason}`)}</Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-5">
        <InviteCard r={r} qrSvg={qrSvg} brand={brand} />
        {r.isPartner ? <PartnerTerms partner={partner} /> : <ProgramTerms r={r} />}
      </div>

      <Totals r={r} />

      {r.isPartner && partner ? <PartnerRewards partner={partner} /> : null}

      <section aria-labelledby="ref-invited" className="space-y-3">
        <SectionTitle id="ref-invited" count={r.invited.length}>
          {r.isPartner ? t('partner.clientsTitle') : t('invitedTitle')}
        </SectionTitle>
        <div className={CARD}>
          {r.invited.length === 0 ? (
            <EmptyState size="compact" title={t('invitedEmpty')} />
          ) : (
            <ul className="divide-y divide-border" data-testid="invitees">
              {r.invited.map((inv, i) => (
                <Invitee key={`${inv.displayName}-${inv.registeredAt}-${i}`} inv={inv} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function InviteCard({ r, qrSvg, brand }: { r: MyReferralView; qrSvg: string | null; brand: string }) {
  const t = useTranslations('referrals');
  return (
    <section className={cn(CARD, 'border-accent/40')} aria-label={t('linkLabel')}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-secondary">{t('linkLabel')}</p>
            {r.link ? (
              <>
                <p
                  className="select-all break-all rounded-xl border border-border-strong bg-sunken px-3 py-3 font-mono text-[13px] leading-relaxed"
                  data-testid="referral-link"
                >
                  {r.link}
                </p>
                <div className="flex flex-wrap gap-2">
                  <ShareButton link={r.link} title={brand} />
                  <CopyRow value={r.link} label={t('copyLink')} doneLabel={t('copied')} />
                </div>
              </>
            ) : (
              <p className="rounded-xl bg-sunken px-3 py-3 text-sm text-secondary">{t('linkMissing')}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-sunken px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-xs text-muted">{t('codeLabel')}</p>
              <p className="font-mono text-lg font-semibold tracking-[0.12em]" data-testid="referral-code">
                {r.code}
              </p>
            </div>
            <CopyRow value={r.code} label={t('copyCode')} doneLabel={t('copied')} />
          </div>
        </div>
        {qrSvg ? (
          <div className="flex shrink-0 flex-col items-center gap-2 sm:w-40">
            <div
              role="img"
              aria-label={t('qrLabel')}
              className="size-40 rounded-xl bg-white p-2"
              // SVG сгенерирован на сервере из ссылки клиента (код — [A-Z0-9]), ввода пользователя в нём нет.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="text-center text-xs text-muted">{t('qrHint')}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProgramTerms({ r }: { r: MyReferralView }) {
  const t = useTranslations('referrals');
  const tp = useTranslations('promo');
  const p = r.program;
  if (!p) {
    return (
      <section className={CARD} aria-labelledby="ref-terms">
        <h2 id="ref-terms" className="font-semibold">
          {t('programTitle')}
        </h2>
        <p className="mt-2 text-sm text-secondary">{t('noProgram')}</p>
      </section>
    );
  }
  const rules = p.rules;
  const usdt = (m: number) => formatMoney(m, PROMO_CURRENCY);
  const must: string[] = [];
  if (rules.kycRequired) must.push(t('cond.kyc'));
  if (rules.minDepositMinor > 0) must.push(t('cond.deposit', { amount: usdt(rules.minDepositMinor) }));
  if (rules.turnoverNotionalMinor > 0) {
    must.push(t('cond.turnover', { amount: usdt(rules.turnoverNotionalMinor), days: rules.windowDays }));
  }
  if (rules.minHoldSeconds > 0) must.push(t('cond.hold', holdParts(rules.minHoldSeconds)));

  return (
    <section className={cn(CARD, 'space-y-4')} aria-labelledby="ref-terms">
      <div>
        <h2 id="ref-terms" className="font-semibold">
          {p.texts.title || t('programTitle')}
        </h2>
        {p.texts.summary ? <p className="mt-1 text-sm text-secondary">{p.texts.summary}</p> : null}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-sunken px-3.5 py-3">
          <dt className="text-xs text-muted">{t('youGet')}</dt>
          <dd className="mt-0.5 text-lg font-semibold">
            <Money minor={rules.referrerRewardMinor} currency={PROMO_CURRENCY} />
          </dd>
        </div>
        <div className="rounded-xl bg-sunken px-3.5 py-3">
          <dt className="text-xs text-muted">{t('friendGets')}</dt>
          <dd className="mt-0.5 text-lg font-semibold">
            <Money minor={rules.refereeRewardMinor} currency={PROMO_CURRENCY} />
          </dd>
        </div>
      </dl>
      {must.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t('friendMust')}</p>
          <ul className="mt-1.5 space-y-1.5 text-sm text-secondary">
            {must.map((m) => (
              <li key={m} className="flex gap-2">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        {rules.maxPaidReferralsPerMonth > 0 ? `${t('cond.limit', { n: rules.maxPaidReferralsPerMonth })} · ` : ''}
        {t('cond.manual')}
      </p>
      <FullTerms lines={[]} terms={p.texts.terms} label={tp('fullTerms')} />
    </section>
  );
}

function PartnerTerms({ partner }: { partner: MyPartnerView | null }) {
  const t = useTranslations('referrals');
  const locale = useLocale();
  if (!partner) {
    return (
      <section className={CARD}>
        <h2 className="font-semibold">{t('partner.title')}</h2>
        <p className="mt-2 text-sm text-secondary">{t('partner.termsMissing')}</p>
      </section>
    );
  }
  const usdt = (m: number) => formatMoney(m, PROMO_CURRENCY);
  const q = partner.cpaRules;
  const must: string[] = [];
  if (q?.kycRequired) must.push(t('cond.kyc'));
  if (q && q.minDepositMinor > 0) must.push(t('cond.deposit', { amount: usdt(q.minDepositMinor) }));
  if (q && q.turnoverNotionalMinor > 0) must.push(t('cond.turnover', { amount: usdt(q.turnoverNotionalMinor), days: q.windowDays }));
  if (q && q.minHoldSeconds > 0) must.push(t('cond.hold', holdParts(q.minHoldSeconds)));

  return (
    <section className={cn(CARD, 'space-y-4')} aria-labelledby="ib-terms" data-testid="partner-block">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ib-terms" className="font-semibold">
            {t('partner.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary">{t('partner.lead', { name: partner.displayName })}</p>
        </div>
        <ToneBadge tone="info" className="shrink-0">
          {t('partner.badge')}
        </ToneBadge>
      </div>
      <div className="rounded-xl bg-sunken px-3.5 py-3">
        <p className="text-xs text-muted">{t('partner.modelLabel')}</p>
        <p className="mt-0.5 text-sm font-medium">{t(`partner.model.${partner.model}`)}</p>
        {partner.model === 'cpa' ? (
          <p className="mt-2 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-secondary">{t('partner.cpaAmount')}</span>
            <Money minor={partner.cpaAmountMinor} currency={PROMO_CURRENCY} className="text-lg font-semibold" />
          </p>
        ) : (
          <div className="mt-2">
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-secondary">{t('partner.revshare')}</span>
              <span className="text-lg font-semibold tabular-nums">
                {partner.revshareBps !== null ? bpsPercent(partner.revshareBps, locale) : '—'}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">{t('partner.revshareHint')}</p>
          </div>
        )}
      </div>
      {partner.model === 'cpa' ? (
        must.length > 0 ? (
          <div>
            <p className="text-sm font-medium">{t('partner.qualify')}</p>
            <ul className="mt-1.5 space-y-1.5 text-sm text-secondary">
              {must.map((m) => (
                <li key={m} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-secondary">{t('partner.termsMissing')}</p>
        )
      ) : null}
    </section>
  );
}

function PartnerRewards({ partner }: { partner: MyPartnerView }) {
  const t = useTranslations('referrals');
  const tp = useTranslations('promo');
  const locale = useLocale();
  return (
    <section aria-labelledby="ib-rewards" className="space-y-3">
      <SectionTitle id="ib-rewards" count={partner.rewards.length}>
        {t('partner.rewardsTitle')}
      </SectionTitle>
      <div className={CARD}>
        {partner.rewards.length === 0 ? (
          <EmptyState size="compact" title={t('partner.rewardsEmpty')} />
        ) : (
          <ul className="divide-y divide-border">
            {partner.rewards.map((x, i) => {
              const period = formatPeriod(x.period, locale);
              return (
                <li key={`${x.createdAt}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="text-sm text-secondary">
                    {period ? t('partner.period', { period }) : formatDate(x.createdAt, locale)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Money minor={x.amountMinor} currency={PROMO_CURRENCY} className="text-sm font-semibold" />
                    <ToneBadge tone={REWARD_TONE[x.status]}>{tp(`rewardStatus.${x.status}`)}</ToneBadge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Totals({ r }: { r: MyReferralView }) {
  const t = useTranslations('referrals');
  const tiles: { label: string; value: React.ReactNode }[] = [
    { label: t('totals.invited'), value: <span className="tabular-nums">{r.totals.invited}</span> },
    { label: t('totals.qualified'), value: <span className="tabular-nums">{r.totals.qualified}</span> },
    { label: t('totals.credited'), value: <Money minor={r.totals.creditedMinor} currency={PROMO_CURRENCY} /> },
    { label: t('totals.processing'), value: <Money minor={r.totals.processingMinor} currency={PROMO_CURRENCY} /> },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ref-totals">
      {tiles.map((x) => (
        <div key={x.label} className="rounded-2xl border border-border bg-elevated px-4 py-3">
          <dt className="text-xs text-muted">{x.label}</dt>
          <dd className="mt-1 text-lg font-semibold tracking-tight">{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STEPS = ['registered', 'kyc', 'deposit', 'turnover'] as const;

/** Сколько этапов пройдено: 1 — зарегистрирован … 4 — оборот выполнен. */
export function stepsDone(stage: InviteeStage): number {
  switch (stage) {
    case 'registered':
      return 1;
    case 'kyc':
      return 2;
    case 'deposit':
      return 3;
    case 'turnover':
    case 'qualified':
    case 'rewarded':
      return 4;
    default:
      return 0;
  }
}

const STAGE_TONE: Record<InviteeStage, StatusTone> = {
  registered: 'neutral',
  kyc: 'info',
  deposit: 'info',
  turnover: 'info',
  qualified: 'warning',
  rewarded: 'positive',
  expired: 'neutral',
  rejected: 'negative',
};

function Invitee({ inv }: { inv: InviteeView }) {
  const t = useTranslations('referrals');
  const tp = useTranslations('promo');
  const locale = useLocale();
  const done = stepsDone(inv.stage);
  const closed = inv.stage === 'expired' || inv.stage === 'rejected';
  const open = !closed && inv.stage !== 'rewarded' && inv.stage !== 'qualified';

  return (
    <li className="space-y-2.5 py-3.5 first:pt-0 last:pb-0" data-stage={inv.stage}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{inv.displayName || '—'}</p>
          <p className="text-xs text-muted">
            {t('registeredOn', { date: formatDate(inv.registeredAt, locale) ?? '—' })}
            {open && inv.deadline ? ` · ${t('deadline', { date: formatDate(inv.deadline, locale) ?? '—' })}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ToneBadge tone={STAGE_TONE[inv.stage]}>{t(`stage.${inv.stage}`)}</ToneBadge>
          {inv.myReward ? (
            <span className="flex items-center gap-1.5 text-xs text-secondary">
              <Money minor={inv.myReward.amountMinor} currency={PROMO_CURRENCY} className="font-medium text-primary" />
              <span>· {tp(`rewardStatus.${inv.myReward.status}`)}</span>
            </span>
          ) : null}
        </div>
      </div>
      {!closed ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={t(`stage.${inv.stage}`)}>
          {STEPS.map((s, i) => (
            <li key={s} className="min-w-0">
              <span
                aria-hidden
                className={cn('block h-1.5 rounded-full', i < done ? 'bg-positive' : 'bg-primary/[0.08]')}
              />
              <span className={cn('mt-1 block truncate text-[11px]', i < done ? 'text-secondary' : 'text-muted')}>
                {t(`steps.${s}`)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

import { useLocale, useTranslations } from 'next-intl';
import { Callout, cn, EmptyState, ToneBadge } from '@broker/ui';
import type { AccountTypeTerms } from '@broker/money';
import { CARD } from './PromoCards';
import { bpsPercent, feeShape } from './format';

/**
 * «Условия счетов» (решение владельца №9): ТОЛЬКО из админки (портфели —
 * плечо, классовые планки, наценка, комиссия, инструменты, описание). Нет
 * данных — честное «временно недоступны», ни одной выдуманной цифры.
 */
export function AccountsScreen({ data }: { data: { types: AccountTypeTerms[]; myKey: string | null } | null }) {
  const t = useTranslations('accounts');
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('lead')}</p>
      </header>
      {data === null ? (
        <Callout tone="warning" title={t('unavailableTitle')}>
          {t('unavailable')}
        </Callout>
      ) : data.types.length === 0 ? (
        <div className={CARD}>
          <EmptyState title={t('empty')} />
        </div>
      ) : (
        <>
          <div className={cn('grid gap-3 lg:gap-4', data.types.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
            {data.types.map((a) => (
              <AccountTypeCard key={a.key} a={a} mine={a.key === data.myKey} />
            ))}
          </div>
          <p className="text-xs text-muted">{t('changeHint')}</p>
        </>
      )}
    </div>
  );
}

export function AccountTypeCard({ a, mine }: { a: AccountTypeTerms; mine: boolean }) {
  const t = useTranslations('accounts');
  const fee = useFeeText(a.markupBps, a.commissionBps);
  // Подписи классов — из словаря; незнакомый класс показываем ключом (не прячем планку).
  const classNames = (t.raw('classes') ?? {}) as Record<string, string>;
  const classes = Object.entries(a.classOverrides).filter(([, n]) => Number.isFinite(n) && n > 0);

  return (
    <article
      className={cn(CARD, 'flex flex-col gap-4', mine && 'border-accent/50 ring-1 ring-inset ring-accent/30')}
      data-account-type={a.key}
      aria-current={mine ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{a.title}</h2>
        {mine ? (
          <ToneBadge tone="info" className="shrink-0">
            {t('yours')}
          </ToneBadge>
        ) : a.isDefault ? (
          <ToneBadge tone="neutral" plain className="shrink-0">
            {t('default')}
          </ToneBadge>
        ) : null}
      </div>
      {a.description ? <p className="-mt-2 text-sm text-secondary">{a.description}</p> : null}

      <dl className="divide-y divide-border rounded-xl bg-sunken">
        <Row label={t('leverage')}>
          <span className="text-[15px] font-semibold tabular-nums">{t('leverageValue', { n: a.leverage })}</span>
          {classes.length > 0 ? (
            <span className="block text-xs text-muted">
              {[
                t('leverageBase', { n: a.baseLeverage }),
                ...classes.map(([cls, n]) => t('classLeverage', { class: classNames[cls] ?? cls, n })),
              ].join(' · ')}
            </span>
          ) : null}
        </Row>
        <Row label={t('cost')}>
          <span className="text-sm font-medium">{fee}</span>
        </Row>
        <Row label={t('instruments')}>
          {a.instruments ? (
            <span className="text-sm">{a.instruments}</span>
          ) : (
            <span className="text-sm text-muted">{t('notSpecified')}</span>
          )}
        </Row>
      </dl>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** «Спред + 0,15 %» / «Комиссия 0,03 % от суммы сделки» — из б.п. портфеля. */
export function useFeeText(markupBps: number, commissionBps: number): string {
  const t = useTranslations('accounts');
  const locale = useLocale();
  const f = feeShape(markupBps, commissionBps);
  switch (f.kind) {
    case 'none':
      return t('fee.none');
    case 'markup':
      return t('fee.markup', { markup: bpsPercent(f.markupBps, locale) });
    case 'commission':
      return t('fee.commission', { commission: bpsPercent(f.commissionBps, locale) });
    case 'both':
      return t('fee.both', { markup: bpsPercent(f.markupBps, locale), commission: bpsPercent(f.commissionBps, locale) });
  }
}

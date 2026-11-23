import { useTranslations } from 'next-intl';
import { Callout, ToneBadge } from '@broker/ui';
import type { AccountTypeTerms } from '@broker/money';
import { AccountTypeCard, useFeeText } from '@/features/promo/AccountsScreen';
import { Card } from '@/features/ui/Card';

type Terms = { types: AccountTypeTerms[]; myKey: string | null } | null;

/** «Условия счетов» в Обзоре: свой тип счёта коротко + сравнение всех типов по раскрытию. */
export function AccountTermsModule({ data }: { data: Terms }) {
  const t = useTranslations('accounts');
  if (data === null) {
    return (
      <Card id="account-terms" title={t('title')} titleId="account-terms-title">
        <Callout tone="warning" title={t('unavailableTitle')}>
          {t('unavailable')}
        </Callout>
      </Card>
    );
  }
  if (data.types.length === 0) return null;
  const mine = data.types.find((a) => a.key === data.myKey) ?? data.types.find((a) => a.isDefault) ?? null;

  return (
    <Card id="account-terms" title={t('title')} titleId="account-terms-title" hint={t('lead')} className="scroll-mt-24">
      {mine ? <MineSummary a={mine} mine={mine.key === data.myKey} /> : null}
      {data.types.length > 1 || !mine ? (
        <details className="group mt-4" open={!mine}>
          <summary className="cursor-pointer list-none text-sm font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{t('compareOpen')}</span>
            <span className="hidden group-open:inline">{t('compareClose')}</span>
          </summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.types.map((a) => (
              <AccountTypeCard key={a.key} a={a} mine={a.key === data.myKey} />
            ))}
          </div>
        </details>
      ) : null}
      <p className="mt-4 text-xs text-muted">{t('changeHint')}</p>
    </Card>
  );
}

function MineSummary({ a, mine }: { a: AccountTypeTerms; mine: boolean }) {
  const t = useTranslations('accounts');
  const fee = useFeeText(a.markupBps, a.commissionBps);
  return (
    <div className="grid gap-3 rounded-xl bg-sunken p-4 sm:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))]" data-account-type={a.key}>
      <div className="min-w-0">
        <p className="text-xs text-muted">{t('yourType')}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-tight">
          {a.title}
          {mine ? <ToneBadge tone="info">{t('yours')}</ToneBadge> : null}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted">{t('leverage')}</p>
        <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{t('leverageValue', { n: a.leverage })}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted">{t('cost')}</p>
        <p className="mt-0.5 text-sm font-medium">{fee}</p>
      </div>
    </div>
  );
}

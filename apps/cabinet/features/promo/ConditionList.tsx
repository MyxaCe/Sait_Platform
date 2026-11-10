import { useLocale, useTranslations } from 'next-intl';
import { cn, formatMinor, formatMoney, Money } from '@broker/ui';
import type { ConditionView } from '@broker/promo';
import { daysLeft, formatDate, PROMO_CURRENCY, progressRatio } from './format';

/**
 * Прогресс по условиям участия: каждое условие — строка с отметкой; оборот —
 * прогресс-баром «3 400 из 9 000 USDT»; срок — «осталось N дней · до даты».
 * Ключи условий приходят из движка, числа — из правил акции и фактов клиента.
 */
export function ConditionList({
  conditions,
  deadline,
  now,
  compact = false,
}: {
  conditions: ConditionView[];
  deadline: string | null;
  now?: Date;
  compact?: boolean;
}) {
  const t = useTranslations('promo');
  const locale = useLocale();
  const rows = conditions.filter((c) => c.key !== 'window');
  if (rows.length === 0 && !deadline) return null;
  const left = daysLeft(deadline, now);

  return (
    <ul className={cn('space-y-2.5', compact && 'space-y-2')} data-testid="conditions">
      {rows.map((c) => (
        <li key={c.key} className="flex gap-3" data-condition={c.key} data-met={c.met ? 'yes' : 'no'}>
          <Mark met={c.met} label={c.met ? t('cond.met') : t('cond.notMet')} />
          <div className="min-w-0 flex-1">
            {c.key === 'turnover' ? (
              <Turnover c={c} compact={compact} />
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className={cn('text-sm', c.met ? 'text-primary' : 'text-secondary')}>
                  {c.key === 'deposit'
                    ? t('cond.deposit', {
                        target: typeof c.target === 'number' ? formatMoney(c.target, PROMO_CURRENCY) : '—',
                      })
                    : t(`cond.${c.key}`)}
                </span>
                {c.key === 'deposit' && c.met && typeof c.current === 'number' && c.current > 0 ? (
                  <Money minor={c.current} currency={PROMO_CURRENCY} className="text-sm text-secondary" />
                ) : null}
              </div>
            )}
          </div>
        </li>
      ))}
      {deadline ? (
        <li className="flex gap-3 border-t border-border pt-2.5" data-condition="window">
          <ClockMark />
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-primary">{left !== null ? t('daysLeft', { days: left }) : t('cond.window')}</span>
            <span className="text-secondary">{t('deadline', { date: formatDate(deadline, locale) ?? '—' })}</span>
          </div>
        </li>
      ) : null}
    </ul>
  );
}

function Turnover({ c, compact }: { c: ConditionView; compact: boolean }) {
  const t = useTranslations('promo');
  const ratio = progressRatio(c.current, c.target, c.met);
  const pct = Math.round(ratio * 100);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn('text-sm', c.met ? 'text-primary' : 'text-secondary')}>{t('cond.turnover')}</span>
        <span className="text-sm tabular-nums text-primary">
          {/* Нет числа от движка — «—», а не «0» (QA-05: охраняемая величина). */}
          {t('cond.turnoverValue', {
            current: typeof c.current === 'number' ? formatMinor(c.current) : '—',
            target: typeof c.target === 'number' ? formatMoney(c.target, PROMO_CURRENCY) : '—',
          })}
        </span>
      </div>
      <ProgressBar value={pct} label={t('cond.turnover')} className={compact ? 'mt-1.5' : 'mt-2'} met={c.met} />
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  met = false,
  className,
}: {
  value: number;
  label: string;
  met?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-border', className)}
    >
      <div className={cn('h-full rounded-full', met ? 'bg-positive' : 'bg-accent')} style={{ width: `${v}%` }} />
    </div>
  );
}

function Mark({ met, label }: { met: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
        met ? 'bg-positive/15 text-positive' : 'bg-primary/[0.06] text-muted ring-1 ring-inset ring-border-strong',
      )}
    >
      {met ? (
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
    </span>
  );
}

function ClockMark() {
  return (
    <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center text-secondary">
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="6.75" />
        <path d="M10 6.25V10l2.5 1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

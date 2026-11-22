import { cn } from '../../lib/cn';

export interface MoneyProps {
  minor: number | null;
  currency: string;
  signed?: boolean;
  tone?: 'auto' | 'none';
  hideCurrency?: boolean;
  intlLocale?: string;
  className?: string;
}

const NBSP_NARROW = ' ';

export function formatMinor(minor: number, intlLocale?: string): string {
  const { group, decimal } = separators(intlLocale);
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${grouped}${decimal}${cents.toString().padStart(2, '0')}`;
}

function separators(intlLocale: string | undefined): { group: string; decimal: string } {
  if (!intlLocale || intlLocale.startsWith('ru')) return { group: NBSP_NARROW, decimal: ',' };
  const parts = new Intl.NumberFormat(intlLocale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? NBSP_NARROW,
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? ',',
  };
}

export function formatMoney(minor: number, currency: string, signed = false, intlLocale?: string): string {
  const sign = minor < 0 ? '−' : signed && minor > 0 ? '+' : '';
  return `${sign}${formatMinor(minor, intlLocale)}${NBSP_NARROW}${currency}`;
}

export function Money({
  minor,
  currency,
  signed = false,
  tone = 'none',
  hideCurrency = false,
  intlLocale,
  className,
}: MoneyProps) {
  if (minor === null) {
    return <span className={cn('text-muted tabular-nums', className)}>—</span>;
  }
  const sign = minor < 0 ? '−' : signed && minor > 0 ? '+' : '';
  const color =
    tone === 'auto'
      ? minor > 0
        ? 'text-positive'
        : minor < 0
          ? 'text-negative'
          : 'text-secondary'
      : undefined;
  return (
    <span className={cn('whitespace-nowrap tabular-nums', color, className)}>
      {sign}
      {formatMinor(minor, intlLocale)}
      {hideCurrency ? null : (
        <span className="text-secondary ml-1 text-[0.85em] font-normal">{currency}</span>
      )}
    </span>
  );
}

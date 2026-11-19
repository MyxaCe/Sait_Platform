import { cn } from '../../lib/cn';

/**
 * Деньги на операторском периметре (концепция §4.1):
 *  - сумма ВСЕГДА в минорных единицах (центах) на входе — никакой float-арифметики;
 *  - табличные цифры (`tabular-nums`), разделитель тысяч — узкий неразрывный
 *    пробел (ru-RU), ровно 2 знака;
 *  - валюта ЯВНО и всегда (код после суммы, приглушённо) — «48 250,13 USDT»;
 *  - знак у P&L/дельт — по `signed`, цвет — по `tone="auto"` (плюс зелёный,
 *    минус красный, ноль нейтральный). Минус — типографский «−».
 *  - `null` → «—» (данных нет — не «0,00»).
 *
 * Выравнивание вправо — забота контейнера (колонка `numeric` в DataTable,
 * `text-right` в плитке); компонент inline.
 */
export interface MoneyProps {
  /** Сумма в минорных единицах (центы). `null` — нет данных. */
  minor: number | null;
  /** Код валюты: USDT, USD, EUR… Показывается всегда. */
  currency: string;
  /** Показывать «+» у положительных (P&L, дельты). */
  signed?: boolean;
  /** `auto` — окраска по знаку; `none` — без окраски (по умолчанию). */
  tone?: 'auto' | 'none';
  /** Скрыть код валюты (ТОЛЬКО когда валюта указана в заголовке колонки). */
  hideCurrency?: boolean;
  intlLocale?: string;
  className?: string;
}

const NBSP_NARROW = ' ';

/** Форматирует минорные единицы: 482501 → «4 825,01» (без валюты, без знака). */
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

/** Полная строка: «−1 200,00 USDT» / «+820,17 USDT». */
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

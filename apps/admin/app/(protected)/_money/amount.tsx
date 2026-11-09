import { formatUsdtRaw, usdtRawToCents } from '@broker/money';
import { Money, cn } from '@broker/ui';

/**
 * Сумма поступления из сети. В базе — точная сумма в сырых единицах USDT
 * (6 знаков) и зачисляемые центы. Показываем центы через `<Money>`; если
 * центов ещё нет (ждёт сети, неопознанное) — переводим сырые единицы в центы
 * для показа. Дробь меньше цента не зачисляется — её видно отдельно.
 */
export function chainCents(amountMinor: number | null, amountRaw: string | null): number | null {
  if (amountMinor !== null) return amountMinor;
  if (!amountRaw) return null;
  try {
    return Number(usdtRawToCents(amountRaw).cents);
  } catch {
    return null;
  }
}

export function ChainAmount({
  amountMinor,
  amountRaw,
  dustRaw,
  hideCurrency = false,
  struck = false,
  className,
}: {
  amountMinor: number | null;
  amountRaw: string | null;
  dustRaw?: string | null;
  hideCurrency?: boolean;
  /** Денег не было (отклонён) — зачёркнуто, приглушённо. */
  struck?: boolean;
  className?: string;
}) {
  const cents = chainCents(amountMinor, amountRaw);
  return (
    <span className="inline-flex flex-col items-end">
      <Money
        minor={cents}
        currency="USDT"
        hideCurrency={hideCurrency}
        className={cn(struck && 'text-muted line-through', className)}
      />
      {dustRaw && dustRaw !== '0' ? (
        <span className="text-muted text-xs font-normal" title="Дробь меньше цента на счёт не зачисляется">
          +{formatUsdtRaw(dustRaw).replace('.', ',')} не зачисл.
        </span>
      ) : null}
    </span>
  );
}

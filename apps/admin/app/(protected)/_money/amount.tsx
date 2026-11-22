import { formatUsdtRaw, usdtRawToCents } from '@broker/money';
import { Money, cn } from '@broker/ui';

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

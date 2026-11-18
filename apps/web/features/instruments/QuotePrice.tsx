import { displayPrice, type Quote } from '@broker/realtime';
import { cn } from '@broker/ui';
import { formatPrice } from '@broker/utils';

export function QuotePrice({
  quote,
  noDataLabel,
  className,
}: {
  quote: Pick<Quote, 'price' | 'digits' | 'ts'> | undefined;
  noDataLabel: string;
  className?: string;
}) {
  const price = quote ? displayPrice(quote, formatPrice) : null;

  if (price === null) {
    return (
      <span className={cn('text-secondary', className)} title={noDataLabel} aria-label={noDataLabel}>
        —
      </span>
    );
  }

  return <span className={className}>{price}</span>;
}

export function priceReading(
  quote: Pick<Quote, 'price' | 'digits' | 'ts'> | undefined,
): number | null {
  if (!quote) return null;
  return displayPrice(quote, formatPrice) === null ? null : quote.price;
}

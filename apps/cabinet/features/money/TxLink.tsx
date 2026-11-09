import { Mono } from '@broker/ui';
import { CopyIcon } from './CopyText';
import { tronscanTxUrl } from './tronscan';

/**
 * Машинная строка истории (хэш/адрес): моноширинно, укорочено посередине
 * (полное — в `title`), копирование и — для хэша — ссылка на Tronscan.
 */
export function MachineValue({
  value,
  label,
  copyLabel,
  copiedLabel,
  tronscanLabel,
  tx = false,
}: {
  value: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
  /** Подпись ссылки на Tronscan; задаётся только для хэша транзакции. */
  tronscanLabel?: string;
  tx?: boolean;
}) {
  const url = tx ? tronscanTxUrl(value) : null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <Mono value={value} middle={6} className="min-w-0 truncate text-secondary" />
      <CopyIcon value={value} label={copyLabel} doneLabel={copiedLabel} />
      {url && tronscanLabel ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={tronscanLabel}
          title={tronscanLabel}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-accent hover:bg-accent/10"
        >
          <span className="hidden sm:inline">Tronscan</span>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5 7.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ) : null}
    </span>
  );
}

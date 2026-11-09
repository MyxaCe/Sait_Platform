import { CopyButton, Mono, cn } from '@broker/ui';

/**
 * Ссылки на обозреватель сети TRON (решение владельца 09.11): у каждого хэша
 * транзакции и TRON-адреса — переход в Tronscan в новой вкладке + копирование
 * рядом. Внешний домен открывается с `noopener noreferrer` (вкладка Tronscan не
 * получает ни `window.opener`, ни реферер с адресом нашей админки).
 *
 * Server-safe (CopyButton — клиентский остров). Кандидаты в @broker/ui
 * (`ExternalLink`, `ExplorerRef`), пока живут здесь — пакет UI в фазе 2 не
 * трогаем.
 */

export type TronRefKind = 'tx' | 'address';

const TRONSCAN = 'https://tronscan.org/#';

export function tronscanUrl(kind: TronRefKind, value: string): string {
  return `${TRONSCAN}/${kind === 'tx' ? 'transaction' : 'address'}/${encodeURIComponent(value)}`;
}

/** Иконка «внешняя ссылка» (стрелка из квадрата) — 12 px, currentColor. */
export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-3 shrink-0', className)}
    >
      <path d="M7 1.5h3.5V5" />
      <path d="M10.5 1.5 5.5 6.5" />
      <path d="M9 7.5v2a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2" />
    </svg>
  );
}

const KIND_LABEL: Record<TronRefKind, { copy: string; open: string }> = {
  tx: { copy: 'хэш транзакции', open: 'Открыть транзакцию в Tronscan (новая вкладка)' },
  address: { copy: 'адрес', open: 'Открыть адрес в Tronscan (новая вкладка)' },
};

/**
 * Хэш/адрес как ссылка в Tronscan: моноширинный (укорочен посередине при
 * `middle`), иконка внешней ссылки, копирование рядом. `full` — без
 * сокращения, с переносом (панель решения, подтверждение).
 */
export function TronRef({
  kind,
  value,
  middle = 8,
  full = false,
  copy = true,
  className,
}: {
  kind: TronRefKind;
  value: string;
  middle?: number;
  full?: boolean;
  copy?: boolean;
  className?: string;
}) {
  const label = KIND_LABEL[kind];
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      <a
        href={tronscanUrl(kind, value)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${value}\n${label.open}`}
        aria-label={`${label.open}: ${value}`}
        className="text-primary hover:text-accent group inline-flex min-w-0 items-center gap-1 underline decoration-border-strong underline-offset-[3px] hover:decoration-accent"
      >
        {full ? (
          <span className="break-all font-mono text-[0.92em] tracking-tight">{value}</span>
        ) : (
          <Mono value={value} middle={middle} />
        )}
        <ExternalIcon className="text-muted group-hover:text-accent" />
      </a>
      {copy ? <CopyButton value={value} label={label.copy} /> : null}
    </span>
  );
}

/**
 * Адрес/хэш крупно для сверки «глазами» (подтверждение опасного действия):
 * группы по 4 символа с зазором. Зазор — отступом, а не пробелом, поэтому
 * выделение и копирование дают исходную строку без пробелов.
 */
export function GroupedMono({ value, className }: { value: string; className?: string }) {
  const groups = value.match(/.{1,4}/g) ?? [value];
  return (
    <span
      className={cn('inline-flex flex-wrap font-mono tracking-tight', className)}
      aria-label={value}
    >
      {groups.map((g, i) => (
        <span key={i} className="mr-[0.4em] last:mr-0">
          {g}
        </span>
      ))}
    </span>
  );
}

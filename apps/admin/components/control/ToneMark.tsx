import { cn, type StatusTone } from '@broker/ui';

/**
 * Маркер тона без подписи — та же форма, что у точки `ToneBadge` (● ◆ ■ ○),
 * чтобы тон различался и без цвета (концепция §5). Для плотных строк, где
 * бейдж на каждую запись — слишком шумно (лента журнала).
 * Кандидат в @broker/ui.
 */
const SHAPE: Record<StatusTone, string> = {
  neutral: 'rounded-full border border-current bg-transparent text-muted',
  info: 'rounded-full bg-current text-info',
  positive: 'rounded-full bg-current text-positive',
  warning: 'rotate-45 rounded-[1px] bg-current text-warning',
  negative: 'rounded-[1px] bg-current text-negative',
};

export function ToneMark({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0', SHAPE[tone], className)} />;
}

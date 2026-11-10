import Link from 'next/link';
import { Money, ToneBadge } from '@broker/ui';
import type { LinkSignal } from '@broker/promo';
import {
  CONDITION_LABELS,
  PARTICIPATION_STATUS,
  PROMO_STATUS,
  REWARD_STATUS,
  SIGNAL_LABELS,
  SIGNAL_SHORT,
  TYPE_LABELS,
} from '@/lib/promo/labels';

export function PromoStatusBadge({ status }: { status: string }) {
  const m = PROMO_STATUS[status];
  return <ToneBadge tone={m?.tone ?? 'neutral'}>{m?.label ?? status}</ToneBadge>;
}

export function RewardStatusBadge({ status }: { status: string }) {
  const m = REWARD_STATUS[status];
  return <ToneBadge tone={m?.tone ?? 'neutral'}>{m?.label ?? status}</ToneBadge>;
}

export function ParticipationBadge({ status }: { status: string }) {
  const m = PARTICIPATION_STATUS[status];
  return <ToneBadge tone={m?.tone ?? 'neutral'}>{m?.label ?? status}</ToneBadge>;
}

export function TypeLabel({ type }: { type: string }) {
  return <span className="text-secondary">{TYPE_LABELS[type] ?? type}</span>;
}

/** Сигналы связанности — короткие бейджи (для таблицы). */
export function SignalBadges({ signals }: { signals: LinkSignal[] }) {
  const kinds = [...new Set(signals.map((s) => s.kind))];
  if (kinds.length === 0) return <span className="text-muted text-xs">нет</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <ToneBadge key={k} tone={k === 'self_referral' ? 'negative' : 'warning'} plain>
          <span title={SIGNAL_LABELS[k] ?? k}>{SIGNAL_SHORT[k] ?? k}</span>
        </ToneBadge>
      ))}
    </span>
  );
}

/** Сигналы подробно: с кем связь и по какому значению (ссылки на клиентов). */
export function SignalDetails({
  signals,
  names,
}: {
  signals: LinkSignal[];
  names: Map<string, { name: string; email: string }>;
}) {
  if (signals.length === 0) {
    return <p className="text-positive text-[13px]">Связей с другими клиентами не найдено.</p>;
  }
  return (
    <ul className="space-y-2">
      {signals.map((s, i) => {
        const who = s.withUserId ? names.get(s.withUserId) : null;
        return (
          <li key={`${s.kind}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
            <ToneBadge tone={s.kind === 'self_referral' ? 'negative' : 'warning'}>{SIGNAL_LABELS[s.kind] ?? s.kind}</ToneBadge>
            {s.withUserId ? (
              <Link href={`/clients/${s.withUserId}`} className="text-accent hover:underline">
                {who?.name ?? s.withUserId}
              </Link>
            ) : null}
            {s.value && s.kind !== 'budget_insufficient' ? (
              <span className="text-muted font-mono text-xs" title={s.value}>
                {s.value.length > 24 ? `${s.value.slice(0, 10)}…${s.value.slice(-8)}` : s.value}
              </span>
            ) : null}
            {s.kind === 'budget_insufficient' && s.value ? (
              <span className="text-muted text-xs">
                остаток <Money minor={Number(s.value)} currency="USDT" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface Cond {
  key: string;
  met: boolean;
  current?: number;
  target?: number;
}

/** Условия участия: ✓/○ и «текущее из цели» для денег/оборота. */
export function ConditionList({ conditions, compact = false }: { conditions: Cond[]; compact?: boolean }) {
  const list = conditions.filter((c) => c.key !== 'window');
  if (list.length === 0) return <span className="text-muted text-xs">ещё не оценивалось</span>;
  return (
    <span className={compact ? 'flex flex-wrap gap-x-3 gap-y-1' : 'flex flex-col gap-1'}>
      {list.map((c) => (
        <span key={c.key} className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-xs">
          <span aria-hidden className={c.met ? 'text-positive' : 'text-muted'}>
            {c.met ? '✓' : '○'}
          </span>
          <span className={c.met ? 'text-primary' : 'text-secondary'}>{CONDITION_LABELS[c.key] ?? c.key}</span>
          {(c.key === 'turnover' || c.key === 'deposit') && typeof c.target === 'number' ? (
            <span className="text-muted tabular-nums">
              <Money minor={c.current ?? 0} currency="USDT" hideCurrency /> / <Money minor={c.target} currency="USDT" />
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Полоса бюджета: израсходовано (одобрено) из общего. */
export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="bg-primary/[0.07] h-1.5 overflow-hidden rounded-full" aria-hidden>
        <div className={pct >= 90 ? 'bg-warning h-full' : 'bg-accent h-full'} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-secondary whitespace-nowrap text-xs tabular-nums">
        <Money minor={spent} currency="USDT" hideCurrency /> / <Money minor={budget} currency="USDT" hideCurrency /> · {pct} %
      </p>
    </div>
  );
}

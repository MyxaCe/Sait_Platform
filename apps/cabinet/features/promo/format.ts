import type { ClientPromotionsView, ContestSummary, ParticipationView, PromoCardView } from '@broker/promo';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money/display-currency';
import { intlTag } from '@broker/utils/locales';

const DAY_MS = 86_400_000;

export const PROMO_CURRENCY = REAL_ACCOUNT_CURRENCY;

export function bpsPercent(bps: number, locale: string): string {
  const value = bps / 100;
  const n = new Intl.NumberFormat(intlTag(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return locale === 'en' ? `${n}%` : `${n} %`;
}

export function signedBpsPercent(bps: number, locale: string): string {
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  return `${sign}${bpsPercent(Math.abs(bps), locale)}`;
}

export function daysLeft(deadlineIso: string | null, now: Date = new Date()): number | null {
  if (!deadlineIso) return null;
  const t = Date.parse(deadlineIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

export function progressRatio(current: number | undefined, target: number | undefined, met: boolean): number {
  if (met) return 1;
  if (typeof current !== 'number' || typeof target !== 'number' || !(target > 0)) return 0;
  return Math.min(1, Math.max(0, current / target));
}

export function holdParts(seconds: number): { value: number; unit: 'sec' | 'min' } {
  return seconds >= 60 && seconds % 60 === 0 ? { value: seconds / 60, unit: 'min' } : { value: seconds, unit: 'sec' };
}

export function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function formatShortDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

export function formatPeriod(period: string | null, locale: string): string | null {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlTag(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export type HomePromo =
  | { kind: 'participation'; item: ParticipationView }
  | { kind: 'available'; item: PromoCardView };

export function pickHomePromos(view: Pick<ClientPromotionsView, 'participating' | 'available'>, limit = 2): HomePromo[] {
  const active = view.participating
    .filter((p) => p.status === 'enrolled' || p.status === 'qualified')
    .sort((a, b) => rankParticipation(a) - rankParticipation(b));
  const out: HomePromo[] = active.slice(0, limit).map((item) => ({ kind: 'participation', item }));
  if (out.length < limit) {
    const avail = [...view.available].sort((a, b) => Number(b.enrollable) - Number(a.enrollable));
    for (const item of avail) {
      if (out.length >= limit) break;
      out.push({ kind: 'available', item });
    }
  }
  return out;
}

function rankParticipation(p: ParticipationView): number {
  if (p.state === 'qualified' || p.status === 'qualified') return 0;
  if (p.type === 'deposit_bonus' || p.type === 'referral') return 1;
  return 2;
}

export type ContestTab = 'running' | 'upcoming' | 'finished';

export function contestTab(c: Pick<ContestSummary, 'phase'>): ContestTab | null {
  if (c.phase === 'running') return 'running';
  if (c.phase === 'upcoming') return 'upcoming';
  if (c.phase === 'finished' || c.phase === 'finalized') return 'finished';
  return null;
}

export function defaultContest<T extends Pick<ContestSummary, 'phase' | 'startsAt' | 'endsAt' | 'promotionId'>>(
  list: readonly T[],
): T | null {
  const by = (tab: ContestTab) => list.filter((c) => contestTab(c) === tab);
  const running = by('running').sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  if (running[0]) return running[0];
  const upcoming = by('upcoming').sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (upcoming[0]) return upcoming[0];
  const finished = by('finished').sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt));
  return finished[0] ?? null;
}

export function hasLiveContest(list: readonly Pick<ContestSummary, 'phase'>[]): boolean {
  return list.some((c) => c.phase === 'running' || c.phase === 'upcoming');
}

export type FeeShape =
  | { kind: 'none' }
  | { kind: 'markup'; markupBps: number }
  | { kind: 'commission'; commissionBps: number }
  | { kind: 'both'; markupBps: number; commissionBps: number };

export function feeShape(markupBps: number, commissionBps: number): FeeShape {
  const m = Number.isFinite(markupBps) && markupBps > 0;
  const c = Number.isFinite(commissionBps) && commissionBps > 0;
  if (m && c) return { kind: 'both', markupBps, commissionBps };
  if (m) return { kind: 'markup', markupBps };
  if (c) return { kind: 'commission', commissionBps };
  return { kind: 'none' };
}

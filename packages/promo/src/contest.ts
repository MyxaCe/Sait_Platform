import type { ContestRules } from './rules';

export interface ContestEntryFacts {
  userId: string;
  displayName: string;
  status: 'pending_reset' | 'active' | 'disqualified' | 'withdrawn';
  joinedAt: string;
  baselineMinor: number | null;
  tradesCount: number;
  pnlMinor: number;
  kycVerified: boolean;
}

export type ContestIneligibility = 'pending_reset' | 'disqualified' | 'withdrawn' | 'min_trades';

export interface ContestStanding {
  userId: string;
  displayName: string;
  place: number | null;
  returnBps: number | null;
  pnlMinor: number;
  tradesCount: number;
  baselineMinor: number | null;
  ineligible: ContestIneligibility | null;
  prizeMinor: number | null;
  prizeBlockedByKyc: boolean;
}

export function rankContest(rules: ContestRules, entries: readonly ContestEntryFacts[]): ContestStanding[] {
  const prizeByPlace = new Map(rules.prizes.map((p) => [p.place, p.amountMinor]));

  const withReturn = entries.map((e) => {
    const returnBps =
      e.baselineMinor && e.baselineMinor > 0 ? Math.round((e.pnlMinor * 10_000) / e.baselineMinor) : null;
    let ineligible: ContestIneligibility | null = null;
    if (e.status !== 'active') ineligible = e.status;
    else if (e.tradesCount < rules.minTrades) ineligible = 'min_trades';
    return { e, returnBps, ineligible };
  });

  const eligible = withReturn
    .filter((x) => x.ineligible === null && x.returnBps !== null)
    .sort(
      (a, b) =>
        b.returnBps! - a.returnBps! ||
        b.e.tradesCount - a.e.tradesCount ||
        Date.parse(a.e.joinedAt) - Date.parse(b.e.joinedAt) ||
        a.e.userId.localeCompare(b.e.userId),
    );
  const rest = withReturn
    .filter((x) => !(x.ineligible === null && x.returnBps !== null))
    .sort((a, b) => (b.returnBps ?? -Infinity) - (a.returnBps ?? -Infinity));

  const out: ContestStanding[] = [];
  eligible.forEach((x, i) => {
    const place = i + 1;
    const prize = prizeByPlace.get(place) ?? null;
    out.push({
      userId: x.e.userId,
      displayName: x.e.displayName,
      place,
      returnBps: x.returnBps,
      pnlMinor: x.e.pnlMinor,
      tradesCount: x.e.tradesCount,
      baselineMinor: x.e.baselineMinor,
      ineligible: null,
      prizeMinor: prize,
      prizeBlockedByKyc: prize !== null && rules.prizeRequiresKyc && !x.e.kycVerified,
    });
  });
  for (const x of rest) {
    out.push({
      userId: x.e.userId,
      displayName: x.e.displayName,
      place: null,
      returnBps: x.returnBps,
      pnlMinor: x.e.pnlMinor,
      tradesCount: x.e.tradesCount,
      baselineMinor: x.e.baselineMinor,
      ineligible: x.ineligible ?? 'pending_reset',
      prizeMinor: null,
      prizeBlockedByKyc: false,
    });
  }
  return out;
}

export function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

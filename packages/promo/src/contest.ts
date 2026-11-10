import type { ContestRules } from './rules';

/**
 * КОНКУРС НА ДЕМО-СЧЕТАХ — ранжирование (чистая функция).
 *
 * Стартовая сумма одинакова у всех: участие сбрасывает демо-счёт терминалом
 * (`POST /account/demo-reset`), база участника (`baselineMinor`) — сумма,
 * которую сброс фактически применил (консюмер берёт её из события
 * `terminal.balance.changed` reason=reset).
 *
 * Доходность = Σ realized P&L закрытых демо-сделок в окне конкурса / база.
 * Почему не «баланс на конец»: баланс после конца конкурса продолжает
 * меняться, а снимок ровно в момент окончания нам никто не пришлёт. Сумма
 * результатов сделок в окне — факт, который не зависит от того, когда
 * подводим итоги, и не обнуляется повторным сбросом (сброс — не сделка).
 * Незакрытые позиции в зачёт не идут.
 *
 * В зачёт: статус `active`, база известна, сделок ≥ `minTrades`. Остальные —
 * в таблице без места, с причиной. Ничья — по числу сделок (больше выше),
 * затем по раннему вступлению.
 */

export interface ContestEntryFacts {
  userId: string;
  displayName: string;
  status: 'pending_reset' | 'active' | 'disqualified' | 'withdrawn';
  joinedAt: string;
  baselineMinor: number | null;
  /** Закрывающих (с результатом) сделок в окне. */
  tradesCount: number;
  /** Σ realized P&L сделок в окне, минорные. */
  pnlMinor: number;
  kycVerified: boolean;
}

export type ContestIneligibility = 'pending_reset' | 'disqualified' | 'withdrawn' | 'min_trades';

export interface ContestStanding {
  userId: string;
  displayName: string;
  place: number | null;
  /** Доходность, б.п. (1 % = 100). `null` — базы нет. */
  returnBps: number | null;
  pnlMinor: number;
  tradesCount: number;
  baselineMinor: number | null;
  ineligible: ContestIneligibility | null;
  /** Приз за место (минорные), если место призовое. */
  prizeMinor: number | null;
  /** Приз есть, но не выплачивается: нужен KYC. */
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

/** Имя для публичного лидерборда: «Алексей М.» — фамилия до инициала. */
export function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

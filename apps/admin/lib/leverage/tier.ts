/**
 * Тип счёта (портфель плеча) по балансу — чистые правила, без базы и сети.
 *
 * Решение владельца 26.11: тип при регистрации не выбирается; клиент начинает
 * с портфеля по умолчанию и автоматически переходит на более высокий, когда его
 * реальный баланс достигает порога. Только вверх: понижения нет никогда.
 */

export interface TierPortfolio {
  key: string;
  title: string;
  minBalanceMinor: number;
  sortOrder: number;
  isDefault: boolean;
  isPublic: boolean;
}

/** Порядок «ниже → выше»: сначала по порогу, при равном пороге — по порядку в списке. */
export function compareTier(a: TierPortfolio, b: TierPortfolio): number {
  if (a.minBalanceMinor !== b.minBalanceMinor) return a.minBalanceMinor - b.minBalanceMinor;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Куда повысить клиента или `null`, если повышать некуда.
 * Кандидаты — только публичные портфели (служебные/закрытые выдаёт оператор руками)
 * и портфель по умолчанию. Текущий портфель неизвестен → считается портфелем по умолчанию.
 */
export function pickUpgrade(
  portfolios: readonly TierPortfolio[],
  currentKey: string | null,
  balanceMinor: number,
): TierPortfolio | null {
  if (!Number.isFinite(balanceMinor) || balanceMinor < 0) return null;
  const current =
    portfolios.find((p) => p.key === currentKey) ?? portfolios.find((p) => p.isDefault) ?? null;
  const eligible = portfolios
    .filter((p) => (p.isPublic || p.isDefault) && p.minBalanceMinor <= balanceMinor)
    .sort(compareTier);
  const best = eligible[eligible.length - 1] ?? null;
  if (!best) return null;
  if (current && (best.key === current.key || compareTier(best, current) <= 0)) return null;
  return best;
}

export type TierValidation =
  | { ok: true }
  | { ok: false; reason: 'defaultNotZero'; key: string }
  | { ok: false; reason: 'notMonotonic'; lower: string; higher: string };

/**
 * Пороги должны расти вместе с порядком портфелей в списке (Standard → Pro → ENC Prime),
 * у портфеля по умолчанию — 0. Иначе «старший» портфель доставался бы при меньшем балансе.
 */
export function validateThresholds(portfolios: readonly TierPortfolio[]): TierValidation {
  for (const p of portfolios) {
    if (p.isDefault && p.minBalanceMinor !== 0) return { ok: false, reason: 'defaultNotZero', key: p.key };
  }
  const ordered = [...portfolios]
    .filter((p) => p.isPublic || p.isDefault)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : 1));
  for (let i = 1; i < ordered.length; i++) {
    const lower = ordered[i - 1]!;
    const higher = ordered[i]!;
    if (higher.minBalanceMinor < lower.minBalanceMinor) {
      return { ok: false, reason: 'notMonotonic', lower: lower.key, higher: higher.key };
    }
  }
  return { ok: true };
}

export function formatUsdt(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return `${whole.toLocaleString('ru-RU')}${cents ? `,${String(cents).padStart(2, '0')}` : ''}`;
}

export {
  resolveLeverage,
  type LeverageSource,
  type PortfolioLeverage,
  type ClientLeverageOverride,
  type ResolveInput,
  type ResolvedLeverage,
} from '@broker/money';
import type { PortfolioLeverage, ClientLeverageOverride } from '@broker/money';

export interface AccountLeverageSnapshot {
  readonly portfolioKey: string;
  readonly baseLeverage: number;
  readonly classOverrides: Readonly<Record<string, number>>;
  readonly clientOverride: number | null;
  readonly resolvedAt: string;
}

export function buildAccountLeverageSnapshot(
  portfolio: PortfolioLeverage,
  clientOverride: ClientLeverageOverride | null,
  resolvedAt: string = new Date().toISOString(),
): AccountLeverageSnapshot {
  return {
    portfolioKey: portfolio.key,
    baseLeverage: portfolio.baseLeverage,
    classOverrides: { ...portfolio.classOverrides },
    clientOverride: clientOverride ? clientOverride.leverage : null,
    resolvedAt,
  };
}

export function formatLeverage(denominator: number): string {
  return `1:${denominator}`;
}

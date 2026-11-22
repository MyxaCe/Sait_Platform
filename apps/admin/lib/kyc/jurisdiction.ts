export interface JurisdictionProfile {
  key: string;
  sourceOfFundsThresholdUsd: number;
}

export const DEFAULT_JURISDICTION_PROFILE: JurisdictionProfile = {
  key: 'default',
  sourceOfFundsThresholdUsd: 10_000,
};

export interface DepositFacts {
  singleMaxUsd: number;
  rolling30dTotalUsd: number;
}

export function sourceOfFundsRequiredByAmount(
  facts: DepositFacts,
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): boolean {
  const threshold = profile.sourceOfFundsThresholdUsd;
  return facts.singleMaxUsd >= threshold || facts.rolling30dTotalUsd >= threshold;
}

export function sourceOfFundsRuleText(
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): string {
  const usd = profile.sourceOfFundsThresholdUsd.toLocaleString('en-US');
  return `Документ «источник средств» требуется, если единичный депозит ≥ $${usd} или суммарно за 30 дней ≥ $${usd}.`;
}

export type SourceOfFundsStatus =
  | 'submitted'
  | 'missing_amounts_unknown'
  | 'missing_required';

export function sourceOfFundsStatus(
  hasSourceOfFundsDoc: boolean,
  deposits?: DepositFacts,
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): SourceOfFundsStatus {
  if (hasSourceOfFundsDoc) return 'submitted';
  if (!deposits) return 'missing_amounts_unknown';
  return sourceOfFundsRequiredByAmount(deposits, profile)
    ? 'missing_required'
    : 'missing_amounts_unknown';
}

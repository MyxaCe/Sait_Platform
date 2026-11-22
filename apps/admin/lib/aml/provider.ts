import type { AmlOutcome, SanctionsListId } from './lists';

export type AmlProviderId = 'complyadvantage' | 'dowjones' | 'sumsub';

export interface AmlScreeningSubject {
  userId: string;
  fullName: string;
}

export interface AmlScreeningHit {
  source: SanctionsListId | string;
  score?: number;
  detail?: string;
}

export interface AmlScreeningProviderResult {
  outcome: AmlOutcome;
  hits: AmlScreeningHit[];
  providerRef: string;
}

export interface AmlScreeningProvider {
  readonly id: AmlProviderId;
  screen(subject: AmlScreeningSubject): Promise<AmlScreeningProviderResult>;
}

export function resolveAmlProvider(): AmlScreeningProvider | null {
  return null;
}

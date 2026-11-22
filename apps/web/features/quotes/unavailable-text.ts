import { isSymbolUnavailableReason, type SymbolUnavailableReason } from '@broker/realtime';

export type UnavailableFamily = 'limited' | 'fault' | 'market';

export interface UnavailableExplanation {
  key: string;
  family: UnavailableFamily;
}

const BY_REASON: Record<SymbolUnavailableReason, UnavailableExplanation> = {
  'source-disabled': { key: 'sourceDisabled', family: 'limited' },
  'no-source': { key: 'noSource', family: 'limited' },
  'not-in-catalog': { key: 'notInCatalog', family: 'limited' },
  'source-silent': { key: 'sourceSilent', family: 'fault' },
  stale: { key: 'stale', family: 'fault' },
  'registry-unreadable': { key: 'registryUnreadable', family: 'fault' },
  'threshold-unset': { key: 'thresholdUnset', family: 'fault' },
  'market-closed': { key: 'marketClosed', family: 'market' },
  'market-halted': { key: 'marketHalted', family: 'market' },
};

export function shortKeyOf(explanation: UnavailableExplanation): string {
  if (explanation.family === 'market') return explanation.key;
  return explanation.family === 'limited' ? 'shortLimited' : 'shortFault';
}

export const MISSING: UnavailableExplanation = { key: 'notMentioned', family: 'fault' };

export const UNKNOWN_REASON: UnavailableExplanation = { key: 'technical', family: 'fault' };

export function explainUnavailable(reason: string | null | undefined): UnavailableExplanation {
  if (reason === null || reason === undefined) return UNKNOWN_REASON;
  if (reason === 'missing') return MISSING;
  if (!isSymbolUnavailableReason(reason)) return UNKNOWN_REASON;
  return BY_REASON[reason];
}

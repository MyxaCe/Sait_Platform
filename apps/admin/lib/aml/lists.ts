export type AmlStatus = 'unscreened' | 'clear' | 'escalated';

export type AmlOutcome = 'clear' | 'escalated';

export const AML_STATUSES: readonly AmlStatus[] = ['unscreened', 'clear', 'escalated'];

export const AML_STATUS_LABELS: Record<AmlStatus, string> = {
  unscreened: 'Не сверялся',
  clear: 'Проверено, совпадений нет',
  escalated: 'Найдено — эскалация',
};

export function asAmlStatus(value: unknown): AmlStatus {
  if (value === 'unscreened' || value === 'clear' || value === 'escalated') {
    return value;
  }
  throw new Error(`client_aml_screening.status вне допустимого множества: ${String(value)}`);
}

export type SanctionsListId = 'ofsi' | 'ofac' | 'eu';

export interface SanctionsList {
  id: SanctionsListId;
  label: string;
  authority: string;
}

export const SANCTIONS_LISTS: readonly SanctionsList[] = [
  { id: 'ofsi', label: 'OFSI', authority: 'HM Treasury (UK)' },
  { id: 'ofac', label: 'OFAC', authority: 'US Treasury' },
  { id: 'eu', label: 'EU consolidated', authority: 'European Union' },
];

export const REQUIRED_LISTS_FOR_CLEAR: readonly SanctionsListId[] = ['ofsi', 'ofac', 'eu'];

const SANCTIONS_LIST_IDS: ReadonlySet<string> = new Set(SANCTIONS_LISTS.map((l) => l.id));

export function coversAllRequiredForClear(lists: readonly SanctionsListId[]): boolean {
  return REQUIRED_LISTS_FOR_CLEAR.every((id) => lists.includes(id));
}

export function isSanctionsListId(value: unknown): value is SanctionsListId {
  return typeof value === 'string' && SANCTIONS_LIST_IDS.has(value);
}

export function normalizeSanctionsLists(values: readonly unknown[]): SanctionsListId[] {
  const picked = new Set<SanctionsListId>();
  for (const v of values) {
    if (isSanctionsListId(v)) picked.add(v);
  }
  return SANCTIONS_LISTS.map((l) => l.id).filter((id) => picked.has(id));
}

export function sanctionsListLabel(id: SanctionsListId): string {
  return SANCTIONS_LISTS.find((l) => l.id === id)?.label ?? id;
}

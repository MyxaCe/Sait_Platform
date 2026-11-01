/**
 * Состояния проверки и виды KYC-документа — локальная копия словаря для зоны
 * «Клиенты» (ADM-02). Держим её здесь, а не тянем приватные помощники из зоны
 * KYC: источник правды о множестве — CHECK в схеме (`client_verification.state`
 * и `kyc_documents.doc_kind`), а этот модуль приводит строку БД к известному
 * значению fail-closed (неизвестное — не «наверное ок», а сломанная строка).
 */

export type VerificationState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'resubmit_requested';

export const VERIFICATION_STATES: readonly VerificationState[] = [
  'unverified',
  'pending',
  'verified',
  'rejected',
  'resubmit_requested',
];

/** Человекочитаемые подписи состояний — для бейджей реестра и карточки. */
export const STATE_LABELS: Record<VerificationState, string> = {
  unverified: 'Не проверен',
  pending: 'Ожидает решения',
  verified: 'Подтверждён',
  rejected: 'Отклонён',
  resubmit_requested: 'Запрошена переподача',
};

export function asState(value: unknown): VerificationState {
  if (
    value === 'unverified' ||
    value === 'pending' ||
    value === 'verified' ||
    value === 'rejected' ||
    value === 'resubmit_requested'
  ) {
    return value;
  }
  throw new Error(`client_verification.state вне допустимого множества: ${String(value)}`);
}

/**
 * Сортировки реестра — закрытый whitelist. Держим ЗДЕСЬ (client-safe модуль без
 * `pg`), чтобы панель фильтров (client component) могла импортировать список и
 * тип, не втягивая серверный `queries.ts` (а с ним драйвер БД) в браузерный
 * бандл. Соответствие сортировки → SQL живёт в `queries.ts` (сервер).
 */
export type ClientSort = 'registered_desc' | 'registered_asc' | 'name_asc' | 'activity_desc';

export const CLIENT_SORTS: readonly ClientSort[] = [
  'registered_desc',
  'registered_asc',
  'name_asc',
  'activity_desc',
];

export function asSort(value: unknown): ClientSort {
  return CLIENT_SORTS.includes(value as ClientSort) ? (value as ClientSort) : 'registered_desc';
}

export type KycDocKind = 'identity' | 'selfie_liveness' | 'address_proof' | 'source_of_funds';

export const DOC_KIND_LABELS: Record<KycDocKind, string> = {
  identity: 'Паспорт / ID',
  selfie_liveness: 'Селфи с liveness',
  address_proof: 'Подтверждение адреса',
  source_of_funds: 'Источник средств',
};

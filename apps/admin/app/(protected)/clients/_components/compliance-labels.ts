import type { StatusKey } from '@broker/ui';
import type { AmlStatus } from '@/lib/aml/lists';
import type { FilterOption } from './FilterBar';

/**
 * Подписи и опции фильтров зоны «Клиенты и комплаенс». Тон/подпись статусов —
 * из `STATUS_DICTIONARY` (@broker/ui); здесь только привязка AML-статуса БД к
 * ключу словаря и короткие подписи для колонки «AML» (префикс «AML:» в
 * колонке с заголовком AML — лишний).
 */

export const AML_KEY: Record<AmlStatus, StatusKey> = {
  unscreened: 'aml_unscreened',
  clear: 'aml_clear',
  escalated: 'aml_escalated',
};

export function amlKey(s: AmlStatus): StatusKey {
  return AML_KEY[s];
}

export const AML_SHORT: Record<AmlStatus, string> = {
  unscreened: 'Не сверялся',
  clear: 'Чисто',
  escalated: 'Эскалация',
};

export const KYC_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'pending', label: 'На проверке' },
  { value: 'resubmit_requested', label: 'Переподача' },
  { value: 'verified', label: 'Подтверждён' },
  { value: 'rejected', label: 'Отклонён' },
  { value: 'unverified', label: 'Не подавал' },
];

export const AML_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'escalated', label: 'Эскалация' },
  { value: 'unscreened', label: 'Не сверялся' },
  { value: 'clear', label: 'Чисто' },
];

export const ACCESS_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Не заблокирован' },
  { value: 'blocked', label: 'Заблокирован' },
  { value: 'restricted', label: 'Ограничены деньги' },
];

/**
 * Денежные команды ЦУ → терминал: модель и типы (Р-452).
 *
 * ЭТО СКЕЛЕТ И ДИЗАЙН-ДО-КОДА, не боевой путь денег. Деньги здесь НЕ двигаются
 * (Р-396): команда — это НАМЕРЕНИЕ и его аудит, владелец денежной строки —
 * терминал. Полный дизайн: `_brain/money-команды-дизайн.md`.
 */

/**
 * Тип денежной команды (закрытый перечень по Р-452). Неизвестный тип не
 * существует — fail-closed и в CHECK схемы, и в типе.
 */
export type MoneyCommandType =
  | 'credit' // начисление
  | 'debit' // списание
  | 'reversal' // сторно
  | 'zeroing' // обнуление
  | 'adjustment'; // корректировка

export const MONEY_COMMAND_TYPES: readonly MoneyCommandType[] = [
  'credit',
  'debit',
  'reversal',
  'zeroing',
  'adjustment',
];

/**
 * Состояния стейт-машины dual control (Р-452). Порядок = нормальный путь.
 * `executed`/`rejected` — терминальны.
 */
export type MoneyCommandState =
  | 'draft'
  | 'awaiting_second_approval'
  | 'signed'
  | 'dispatched'
  | 'executed'
  | 'rejected';

export const MONEY_COMMAND_STATES: readonly MoneyCommandState[] = [
  'draft',
  'awaiting_second_approval',
  'signed',
  'dispatched',
  'executed',
  'rejected',
];

/**
 * Денежная ТРОЙКА (Р-452): величина ТОЛЬКО в минорных единицах целым, плюс
 * валюта и точность. Никаких float — деньги не в double. `amountMinor` строкой:
 * BIGINT из базы и значения больше 2^53 переживают JSON без потери.
 */
export interface MoneyAmount {
  /** Целое число минорных единиц, строкой (например «1050» = 10.50 при scale=2). */
  amountMinor: string;
  /** ISO-код валюты. */
  currency: string;
  /** Точность — число десятичных знаков. */
  scale: number;
}

/**
 * Каноническая нагрузка команды — РОВНО то, что подписывается и что видит
 * терминал (Р-452). Набор полей фиксирован; порядок незначим (канонизация
 * сортирует ключи). Терминал (Rust) воспроизводит ту же каноническую строку.
 */
export interface MoneyCommandPayload {
  /** UUID команды (генерит ЦУ). */
  commandId: string;
  type: MoneyCommandType;
  /** UUID счёта-субъекта (клиент/счёт). */
  accountId: string;
  amount: MoneyAmount;
  /** UUID оператора-инициатора (из сессии, НЕ из формы). */
  initiatorId: string;
  /** Основание: id заявки/тикета/инцидента. Непустое. */
  basisRef: string;
  /** Метка времени выпуска, ISO-8601 (генерит ЦУ при подписи). */
  issuedAt: string;
  /** Одноразовый маркер против повтора. */
  nonce: string;
}

/** Подписанная команда: нагрузка + подпись ЦУ и версия ключа. */
export interface SignedMoneyCommand {
  payload: MoneyCommandPayload;
  /** Ed25519-подпись канонической нагрузки, base64. */
  signature: string;
  /** Версия ключа ЦУ, которым подписано (ротация, Р-452). */
  keyVersion: string;
}

/** Род аппрува в dual control. */
export type ApprovalKind = 'initiate' | 'second_approval';

export interface MoneyCommandApproval {
  commandId: string;
  /** UUID оператора-аппрувера. */
  approverId: string;
  kind: ApprovalKind;
  approvedAt: string;
}

import { canonicalize } from '../journal/journal';
import type { MoneyCommandPayload } from './types';

/**
 * Канонизация подписываемой нагрузки (Р-452).
 *
 * РОВНО ТА ЖЕ канонизация, что у журнала (`canonicalize`): рекурсивная
 * сортировка ключей, массивы в своём порядке, детерминированная строка.
 * Переиспользуем её намеренно — «канонизация подписываемого как в журнале»:
 * одна форма истины, и подпись, и хеш-цепочка журнала считаются по одному
 * закону, их нельзя рассинхронизировать.
 *
 * ПОРЯДОК полей в объекте незначим: канонизация сортирует ключи. Значим НАБОР
 * полей (Р-452 + Р-455 R-1/R-4: id · тип · счёт · тройка · автор · основание ·
 * исходная-команда · id-инициации · id-второго-аппрува · метка · nonce).
 * Терминал (Rust) ОБЯЗАН воспроизвести эту же каноническую строку — это
 * межзонный контракт. Тест-векторы (`money/vectors`) дают эталон для сверки.
 */
export function canonicalizeCommandPayload(payload: MoneyCommandPayload): string {
  // Строим плоский объект с явными полями — чтобы ни лишнее поле объекта-носителя,
  // ни его прототип не попали в подпись. Только договорённый набор (Р-452).
  return canonicalize({
    commandId: payload.commandId,
    type: payload.type,
    accountId: payload.accountId,
    amountMinor: payload.amount.amountMinor,
    currency: payload.amount.currency,
    scale: payload.amount.scale,
    initiatorId: payload.initiatorId,
    basisRef: payload.basisRef,
    // Р-455 R-4: ссылка на исходную команду для reversal (иначе null).
    originalCommandId: payload.originalCommandId,
    // Р-455 R-1: id обоих аппрувов в подписи (secondApprovalId=null для admin).
    initiateApprovalId: payload.initiateApprovalId,
    secondApprovalId: payload.secondApprovalId,
    issuedAt: payload.issuedAt,
    nonce: payload.nonce,
  });
}

/** UTF-8 байты канонической строки — ровно то, над чем ставится Ed25519-подпись. */
export function commandSigningBytes(payload: MoneyCommandPayload): Buffer {
  return Buffer.from(canonicalizeCommandPayload(payload), 'utf8');
}

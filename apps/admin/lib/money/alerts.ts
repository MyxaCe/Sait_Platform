import type { MoneyAmount, MoneyCommandType } from './types';

/**
 * Алерты денежного контура (Р-455 R-5 / R-6) — ПОРТЫ и эталонная сборка
 * состава. Живых каналов тут НЕТ: ни Telegram-токена, ни SMTP, ни сетевых
 * вызовов. Зона отдаёт (а) интерфейсы каналов, (б) детерминированную сборку
 * состава алерта, (в) правило «Telegram основной + email резерв». Боевые
 * реализации каналов (с секретами из Vault/env) — отдельной задачей той же
 * абстракцией.
 *
 * Два повода для алерта:
 *  - break-glass (Р-455 R-5): немедленный алерт ВСЕМ админам при инициации.
 *  - приём терминалом (Р-455 R-6): replay nonce / просрочка / отказ — алерт с
 *    полным составом. Приём живёт на терминале (Rust); состав задаём здесь как
 *    контракт.
 */

/** Канал доставки. Р-455 R-6: Telegram — основной, email — резерв. */
export type MoneyAlertChannel = 'telegram' | 'email';

/** Повод алерта — для маршрутизации и текста. */
export type MoneyAlertKind =
  | 'break_glass'
  // Р-456 C: admin подтвердил собственную команду в bootstrap-режиме. Временное
  // исключение «со следом»: не молча, а алертом + записью в журнал.
  | 'bootstrap_self_approval'
  | 'replayed_nonce'
  | 'expired_timestamp'
  | 'future_timestamp'
  | 'rejected'
  | 'bad_signature';

/**
 * Полный состав алерта (Р-455 R-6): id/тип/счёт/сумма+валюта+scale/инициатор/
 * подтверждающий/основание/результат. Самодостаточен — читается без похода в
 * базу. `secondApproverId=null` — легитимный admin-путь (Р-455 R-2-поправка).
 */
export interface MoneyAlert {
  kind: MoneyAlertKind;
  commandId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  initiatorId: string;
  secondApproverId: string | null;
  basisRef: string;
  /** Исход (для приёма терминалом) либо повод (для break-glass). */
  result: string;
  breakGlass: boolean;
  /** Описание инцидента для break-glass (Р-455 R-5); иначе null. */
  incidentRef: string | null;
}

export interface BuildMoneyAlertInput {
  kind: MoneyAlertKind;
  commandId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  initiatorId: string;
  secondApproverId?: string | null;
  basisRef: string;
  result: string;
  breakGlass?: boolean;
  incidentRef?: string | null;
}

/** Детерминированная сборка состава алерта (контракт для всех каналов). */
export function buildMoneyAlert(input: BuildMoneyAlertInput): MoneyAlert {
  return {
    kind: input.kind,
    commandId: input.commandId,
    type: input.type,
    accountId: input.accountId,
    amount: input.amount,
    initiatorId: input.initiatorId,
    secondApproverId: input.secondApproverId ?? null,
    basisRef: input.basisRef,
    result: input.result,
    breakGlass: input.breakGlass ?? false,
    incidentRef: input.incidentRef ?? null,
  };
}

/** Канал доставки алерта — порт. Реализация (Telegram/email) — отдельно. */
export interface MoneyAlertChannelPort {
  readonly channel: MoneyAlertChannel;
  send(alert: MoneyAlert): Promise<void>;
}

/**
 * Порт оповещения всех админов (Р-455 R-5 break-glass, Р-456 C bootstrap
 * self-approval). На проде за ним — мультиканальная доставка
 * (`dispatchMoneyAlert`); в скелете по умолчанию no-op-порт `noopAdminAlert`,
 * чтобы оркестрация не зависела от живого канала.
 */
export interface AdminAlertPort {
  alertAllAdmins(alert: MoneyAlert): Promise<void>;
}

export const noopAdminAlert: AdminAlertPort = {
  async alertAllAdmins() {
    /* скелет: живого канала нет (Р-455/Р-456) */
  },
};

export interface DispatchResult {
  channel: MoneyAlertChannel;
  ok: boolean;
  error?: unknown;
}

/**
 * Рассылка алерта по каналам (Р-455 R-6). Telegram — основной, email — резерв:
 * шлём во ВСЕ переданные каналы (резерв не ждёт отказа основного — важное не
 * должно потеряться из-за одного упавшего канала), но порядок попыток —
 * Telegram раньше email. Сбой одного канала НЕ роняет остальные; результат по
 * каждому возвращается, решение об эскалации — у вызывающего.
 */
export async function dispatchMoneyAlert(
  alert: MoneyAlert,
  channels: readonly MoneyAlertChannelPort[],
): Promise<DispatchResult[]> {
  const order: Record<MoneyAlertChannel, number> = { telegram: 0, email: 1 };
  const sorted = [...channels].sort((a, b) => order[a.channel] - order[b.channel]);
  const results: DispatchResult[] = [];
  for (const ch of sorted) {
    try {
      await ch.send(alert);
      results.push({ channel: ch.channel, ok: true });
    } catch (error) {
      results.push({ channel: ch.channel, ok: false, error });
    }
  }
  return results;
}

/**
 * Пороги денежных команд (Р-452, Р-454 I-2).
 *
 * Порог dual control — КОНФИГ. Старт по Р-452: ЛЮБАЯ корректировка баланса
 * требует второго аппрува, то есть порог = 0 (всегда dual control). Живёт в
 * профиле юрисдикции позже (как риск-пороги); сейчас — env.
 *
 * Окно времени и окно ротации — тоже конфиг; значения по умолчанию из Р-452.
 */

/** Разбор целого минорного значения из env; дефолт при пустом/битом — fail-safe к строгому. */
function envInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  try {
    const v = BigInt(raw.trim());
    return v < 0n ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * Порог dual control в МИНОРНЫХ единицах. Команда со `|amountMinor|` СТРОГО
 * больше порога требует второго аппрува. Дефолт `0` → второй аппрув нужен
 * всегда (старт Р-452: любая корректировка).
 */
export function dualControlThresholdMinor(): bigint {
  return envInt('MONEY_DUAL_CONTROL_THRESHOLD_MINOR', 0n);
}

/** Окно свежести метки времени, мс (Р-452: 5 мин). */
export function timestampWindowMs(): number {
  const raw = Number(process.env.MONEY_TIMESTAMP_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

/**
 * Допустимый перекос часов «в будущее», мс (метка чуть впереди наших часов).
 * Р-455 R-6: ≤30 сек — узко, т.к. `issuedAt` ставится ПОСЛЕ сбора аппрувов,
 * прямо перед отправкой, а не в момент аппрува.
 */
export function clockSkewMs(): number {
  const raw = Number(process.env.MONEY_CLOCK_SKEW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30 * 1000;
}

/**
 * Время жизни nonce в кэше терминала, мс (Р-455 R-6: 10 мин). Это ПАРАМЕТР
 * ПОРТА терминала (персистентный кэш nonce — его сторона, Rust): величина
 * задаёт, как долго повтор ловится как replay. Приводится здесь как часть
 * контракта приёма; терминал обязан держать nonce не меньше этого окна.
 */
export function nonceTtlMs(): number {
  const raw = Number(process.env.MONEY_NONCE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

/**
 * Условие ИСТЕЧЕНИЯ bootstrap-режима (Р-456 C) — не дата, а условие: bootstrap
 * снимается, когда ADM-01 умеет заводить операторов, ключ денег переехал в
 * Vault и заработала реконсиляция терминала (появились реальные фин-операторы).
 * До тех пор admin в bootstrap-режиме инициирует и подтверждает сам. Константа —
 * для журнала/алерта (пишем вместе с пометкой), чтобы «временность» была видна.
 */
export const BOOTSTRAP_MODE_EXPIRY_CONDITION =
  'ADM-01 заводит операторов + ключ денег в Vault + реконсиляция терминала (появились реальные finance_operator)';

/**
 * bootstrap-режим (Р-456 C). `true` — admin инициирует И подтверждает сам
 * (временное исключение, пока нет реальных фин-операторов): self-approval
 * admin'а разрешён стейт-машиной, НО каждый — с алертом и записью в журнал.
 * `false` (ДЕФОЛТ, fail-closed) — admin подчиняется dual control как
 * finance_operator; self-approval блокируется (инициатор≠подтверждающий и для
 * admin). Снятие режима — по условию `BOOTSTRAP_MODE_EXPIRY_CONDITION`.
 *
 * Дефолт false намеренно: «временное исключение» включается ЯВНО, а не живёт
 * молчаливым состоянием по умолчанию.
 */
export function bootstrapMode(): boolean {
  return process.env.MONEY_BOOTSTRAP_MODE === 'true';
}

/**
 * Нужен ли второй аппрув для суммы (по модулю: списание/сторно несут знак
 * смысла, порог — по величине). `> порога` → да; `0`-порог → всегда да.
 */
export function requiresSecondApproval(amountMinor: string): boolean {
  let magnitude: bigint;
  try {
    const v = BigInt(amountMinor);
    magnitude = v < 0n ? -v : v;
  } catch {
    // Непарсируемая сумма — самый строгий путь: требуем второй аппрув.
    return true;
  }
  return magnitude > dualControlThresholdMinor();
}

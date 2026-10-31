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

/** Допустимый перекос часов «в будущее», мс (метка чуть впереди наших часов). */
export function clockSkewMs(): number {
  const raw = Number(process.env.MONEY_CLOCK_SKEW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 1000;
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

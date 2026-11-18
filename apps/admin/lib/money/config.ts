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

export function dualControlThresholdMinor(): bigint {
  return envInt('MONEY_DUAL_CONTROL_THRESHOLD_MINOR', 0n);
}

export function timestampWindowMs(): number {
  const raw = Number(process.env.MONEY_TIMESTAMP_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

export function clockSkewMs(): number {
  const raw = Number(process.env.MONEY_CLOCK_SKEW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30 * 1000;
}

export function nonceTtlMs(): number {
  const raw = Number(process.env.MONEY_NONCE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

export const BOOTSTRAP_MODE_EXPIRY_CONDITION =
  'ADM-01 заводит операторов + ключ денег в Vault + реконсиляция терминала (появились реальные finance_operator)';

export function bootstrapMode(): boolean {
  return process.env.MONEY_BOOTSTRAP_MODE === 'true';
}

export function requiresSecondApproval(amountMinor: string): boolean {
  let magnitude: bigint;
  try {
    const v = BigInt(amountMinor);
    magnitude = v < 0n ? -v : v;
  } catch {
    return true;
  }
  return magnitude > dualControlThresholdMinor();
}

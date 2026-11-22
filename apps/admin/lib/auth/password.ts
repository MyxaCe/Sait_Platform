import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { envOr } from '@broker/utils';

export interface ArgonParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const DEFAULT_ARGON_PARAMS: ArgonParams = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function intFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(envOr(raw, String(fallback)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function currentArgonParams(): ArgonParams {
  return {
    memoryCost: intFromEnv(process.env.ADMIN_ARGON_MEMORY_KIB, DEFAULT_ARGON_PARAMS.memoryCost),
    timeCost: intFromEnv(process.env.ADMIN_ARGON_TIME, DEFAULT_ARGON_PARAMS.timeCost),
    parallelism: intFromEnv(process.env.ADMIN_ARGON_PARALLELISM, DEFAULT_ARGON_PARAMS.parallelism),
  };
}

export function hashPassword(password: string): Promise<string> {
  const params = currentArgonParams();
  return argonHash(password, {
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

export interface ParsedPhc {
  algorithm: string;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export function parsePhc(hash: string): ParsedPhc | null {
  const match = /^\$(argon2(?:id|i|d))\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  if (!match) return null;
  const [, algorithm, m, t, p] = match;
  if (!algorithm || !m || !t || !p) return null;
  return {
    algorithm,
    memoryCost: Number.parseInt(m, 10),
    timeCost: Number.parseInt(t, 10),
    parallelism: Number.parseInt(p, 10),
  };
}

export function needsRehash(hash: string): boolean {
  const parsed = parsePhc(hash);
  if (!parsed) return true;
  if (parsed.algorithm !== 'argon2id') return true;
  const current = currentArgonParams();
  return (
    parsed.memoryCost !== current.memoryCost ||
    parsed.timeCost !== current.timeCost ||
    parsed.parallelism !== current.parallelism
  );
}

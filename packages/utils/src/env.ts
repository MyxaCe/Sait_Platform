export function readEnv(raw: string | undefined | null): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function envOr(raw: string | undefined | null, fallback: string): string {
  return readEnv(raw) ?? fallback;
}

export const UNKNOWN_ENVIRONMENT = 'unknown';

export function sentryEnvironment(raw: string | undefined | null): string {
  return readEnv(raw) ?? UNKNOWN_ENVIRONMENT;
}

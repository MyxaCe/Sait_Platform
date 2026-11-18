import os from 'node:os';

export interface InstanceIdentity {
  host: string;
  pid: number;
  startedAt: string;
}

export function instanceIdentity(): InstanceIdentity {
  return {
    host: os.hostname(),
    pid: process.pid,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };
}

const TRACKED_ENV = [
  'DATABASE_URL',
  'CMS_API_URL',
  'CMS_API_KEY',
  'CMS_WEBHOOK_SECRET',
  'PREVIEW_SECRET',
  'MDS_HTTP_URL',
  'NEXT_PUBLIC_WS_URL',
  'SITE_SLUG',
  'SENTRY_DSN',
  'ALLOW_SENTRY_TEST',
] as const;

export function configFingerprint(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of TRACKED_ENV) {
    const value = process.env[name];
    out[name] = typeof value === 'string' && value.length > 0;
  }
  return out;
}

export function buildFingerprint(): Record<string, boolean> | null {
  const raw = process.env.BUILD_CONFIG_FINGERPRINT;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, boolean> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'boolean') return null;
      out[name] = value;
    }
    return out;
  } catch {
    return null;
  }
}

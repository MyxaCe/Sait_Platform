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
  'MDS_HTTP_URL',
  'NEXT_PUBLIC_WS_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_TERMINAL_URL',
  'SITE_SLUG',
  'SSO_PRIVATE_KEY_B64',
  'CABINET_TOTP_KEY',
  'UPLOAD_DIR',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
] as const;

export function configFingerprint(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of TRACKED_ENV) {
    const value = process.env[name];
    out[name] = typeof value === 'string' && value.length > 0;
  }
  return out;
}

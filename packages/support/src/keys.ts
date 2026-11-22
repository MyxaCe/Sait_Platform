import { randomUUID } from 'node:crypto';

export const SUPPORT_KEY_PREFIX = 'support';
export const SUPPORT_RAW_PREFIX = 'support-raw';

function seg(name: string, v: string): string {
  if (!v || v.trim() !== v || v.includes('/') || v.includes(String.fromCharCode(92)) || v === '.' || v === '..') {
    throw new Error(`Сегмент ключа «${name}» непригоден: ${JSON.stringify(v)}`);
  }
  return v;
}

export function buildAttachmentKey(tenant: string, ticketId: string, uuid: string = randomUUID()): string {
  return [SUPPORT_KEY_PREFIX, seg('tenant', tenant), seg('ticket', ticketId), seg('uuid', uuid)].join('/');
}

export function buildRawMailKey(tenant: string, at: Date, uuid: string = randomUUID()): string {
  const ym = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  return [SUPPORT_RAW_PREFIX, seg('tenant', tenant), ym, `${seg('uuid', uuid)}.eml`].join('/');
}

export function buildPendingAttachmentKey(tenant: string, userId: string, uuid: string = randomUUID()): string {
  return [SUPPORT_KEY_PREFIX, seg('tenant', tenant), 'u', seg('user', userId), seg('uuid', uuid)].join('/');
}

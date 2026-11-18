import { ImapFlow } from 'imapflow';
import type { ImapConfig } from './config';

export interface MailboxMessage {
  uid: number;
  source: Buffer;
}

export function imapClient(cfg: ImapConfig, onError?: (e: Error) => void): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    doSTARTTLS: cfg.secure ? undefined : true,
    auth: { user: cfg.user, pass: cfg.password },
    tls: { rejectUnauthorized: cfg.rejectUnauthorized },
    logger: false,
    maxIdleTime: 5 * 60_000,
  });
  client.on('error', (e: Error) => onError?.(e));
  return client;
}

export async function ensureFolders(client: ImapFlow, cfg: ImapConfig): Promise<void> {
  const list = await client.list();
  const paths = new Set(list.map((m) => m.path));
  for (const f of [cfg.processedFolder, cfg.failedFolder]) {
    if (!paths.has(f)) await client.mailboxCreate(f).catch(() => {});
  }
}

export async function resolveSentFolder(client: ImapFlow, cfg: ImapConfig): Promise<string> {
  if (cfg.sentFolder) return cfg.sentFolder;
  const list = await client.list();
  const special = list.find((m) => m.specialUse === '\\Sent');
  if (special) return special.path;
  const named = list.find((m) => /^(INBOX\.)?Sent$/i.test(m.path));
  if (named) return named.path;
  await client.mailboxCreate('Sent').catch(() => {});
  return 'Sent';
}

export async function drainInbox(
  client: ImapFlow,
  cfg: ImapConfig,
  handle: (m: MailboxMessage, uidValidity: number | null) => Promise<'processed' | 'failed'>,
): Promise<{ processed: number; failed: number }> {
  const out = { processed: 0, failed: 0 };
  const lock = await client.getMailboxLock(cfg.inbox);
  try {
    const mb = client.mailbox;
    const uidValidity = mb && typeof mb === 'object' && mb.uidValidity != null ? Number(mb.uidValidity) : null;
    const uids = (await client.search({ all: true }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const res = await handle({ uid, source: msg.source }, uidValidity);
      const dest = res === 'processed' ? cfg.processedFolder : cfg.failedFolder;
      await client.messageMove(String(uid), dest, { uid: true });
      out[res]++;
    }
  } finally {
    lock.release();
  }
  return out;
}

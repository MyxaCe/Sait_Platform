import 'dotenv/config';

import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Pool } from 'pg';
import { assertSchemaCurrent } from '@broker/db';
import type { PoolLike } from '@broker/money';
import { loadStorageConfig, putObject } from '@broker/storage';
import {
  autoCloseResolved,
  loadSupportSettings,
  recoverContactLeads,
  writeMailEvent,
  writeMailHeartbeat,
} from '@broker/support';
import { assertTenantSlugAtStartup } from '@broker/tenant';
import { readEnv } from '@broker/utils';
import { domainOfAddress, readMailConfig } from './config';
import { drainInbox, ensureFolders, imapClient, resolveSentFolder } from './imap';
import { handleRawMessage, type ObjectStore } from './inbound';
import { sendTick, type RawTransport, type SentCopy } from './sender';

/**
 * Почтовый воркер поддержки (support-mail): свой контейнер, свой failure
 * domain — как наблюдатель сети. Делает:
 *  - отправку очереди `outbound_mail` через SMTP хостинга (+ копия в Sent);
 *  - приём ящика по IMAP (IDLE + страховочный опрос) → тикеты;
 *  - восстановление потерянных обращений из `leads` и автозакрытие решённых;
 *  - отметку состояния в `support_mail_status` (админка: «почта не настроена»).
 *
 * Без почтовых env НЕ падает: почта выключена (fail-closed), остальное
 * работает. Без базы, слага тенанта или с отстающей схемой — не стартует.
 */

const log = (m: string) => console.info(`[support-mail] ${m}`);
const warn = (m: string) => console.error(`[support-mail] ${m}`);
function fatal(m: string): never {
  warn(m);
  process.exit(1);
}

const databaseUrl = readEnv(process.env.DATABASE_URL) ?? fatal('DATABASE_URL обязателен');
let tenant: string;
try {
  tenant = assertTenantSlugAtStartup('старт почтового воркера поддержки');
} catch (error) {
  fatal((error as Error).message);
}

const cfg = readMailConfig();
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const db = pool as unknown as PoolLike;

let store: ObjectStore | null = null;
try {
  loadStorageConfig();
  store = { put: (key, body, contentType) => putObject({ key, body, contentType }) };
} catch {
  warn('объектное хранилище (S3_*) не настроено — сырые письма и вложения писем не сохраняются');
}

let stopping = false;
const timers: NodeJS.Timeout[] = [];

async function heartbeat(): Promise<void> {
  await writeMailHeartbeat(pool, {
    smtp: cfg.smtp !== null,
    imap: cfg.imap !== null,
    missing: cfg.missing,
    mailbox: cfg.address,
  }).catch((e: Error) => warn(`heartbeat: ${e.message}`));
}

async function housekeeping(): Promise<void> {
  try {
    const settings = await loadSupportSettings(pool);
    const r = await recoverContactLeads(db, settings);
    if (r.recovered > 0) log(`восстановлено обращений с формы контактов: ${r.recovered} (#${r.numbers.join(', #')})`);
    const closed = await autoCloseResolved(db, settings);
    if (closed > 0) log(`автозакрыто решённых: ${closed}`);
  } catch (e) {
    warn(`housekeeping: ${(e as Error).message}`);
  }
}

/* ─── исходящие ─────────────────────────────────────────────────────── */

let sentCopy: SentCopy | null = null;

function startSender(): void {
  const smtp = cfg.smtp!;
  const address = cfg.address!;
  const smtpOptions: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: smtp.rejectUnauthorized },
  };
  const t = nodemailer.createTransport(smtpOptions);
  const transport: RawTransport = {
    send: async (raw, envelope) => {
      const info = await t.sendMail({ envelope, raw });
      return { response: String(info.response ?? '') };
    },
  };
  if (cfg.imap) {
    const imapCfg = cfg.imap;
    sentCopy = {
      append: async (raw) => {
        const c = imapClient(imapCfg);
        await c.connect();
        try {
          await c.append(await resolveSentFolder(c, imapCfg), raw, ['\\Seen']);
        } finally {
          await c.logout().catch(() => {});
        }
      },
    };
  }
  const loop = async () => {
    if (stopping) return;
    try {
      const settings = await loadSupportSettings(pool);
      const r = await sendTick({
        db: pool,
        transport,
        sentCopy,
        from: { address, name: settings.mail.fromName },
        domain: domainOfAddress(address),
        perHour: cfg.sendPerHour,
        supportEmailEnabled: settings.channels.email,
        log: warn,
      });
      if (r.sent || r.failed || r.retry) log(`отправка: ${JSON.stringify(r)}`);
      if (r.throttled) warn(`лимит отправки хостинга (${cfg.sendPerHour}/ч) исчерпан — ждём`);
    } catch (e) {
      warn(`отправка: ${(e as Error).message}`);
    }
    if (!stopping) timers.push(setTimeout(() => void loop(), cfg.sendIntervalMs));
  };
  void loop();
}

/* ─── входящие ──────────────────────────────────────────────────────── */

function startReceiver(): void {
  const imapCfg = cfg.imap!;
  const own = [cfg.address!];
  let attempt = 0;
  let draining = false;
  let again = false;

  const connect = async (): Promise<void> => {
    if (stopping) return;
    const client = imapClient(imapCfg, (e) => warn(`IMAP: ${e.message}`));
    const drain = async () => {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          const settings = await loadSupportSettings(pool);
          if (!settings.channels.email) return; // канал выключен — письма ждут в INBOX, ничего не теряется
          const r = await drainInbox(client, imapCfg, async (m, uidValidity) => {
            const res = await handleRawMessage(db, m.source, { mailbox: imapCfg.inbox, uid: m.uid, uidValidity, tenant }, {
              settings,
              ownAddresses: own,
              store,
            });
            if (!res.ok) {
              warn(`письмо uid=${m.uid} не разобрано: ${res.error} → ${imapCfg.failedFolder}`);
              return 'failed';
            }
            if (res.verdict.verdict === 'accepted') {
              log(`письмо uid=${m.uid} → тикет #${res.verdict.number}${res.verdict.created ? ' (новый)' : ''}`);
            } else if (res.verdict.verdict !== 'duplicate') {
              log(`письмо uid=${m.uid}: ${res.verdict.verdict} (${res.verdict.reason})`);
            }
            return 'processed';
          });
          if (r.processed || r.failed) await writeMailEvent(pool, 'inboundOk');
        } while (again && !stopping);
      } catch (e) {
        warn(`приём: ${(e as Error).message}`);
        await writeMailEvent(pool, 'error', `IMAP: ${(e as Error).message}`).catch(() => {});
      } finally {
        draining = false;
      }
    };

    client.on('exists', () => void drain());
    client.on('close', () => {
      if (stopping) return;
      attempt++;
      const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
      warn(`IMAP соединение закрыто — переподключение через ${delay / 1000} с`);
      timers.push(setTimeout(() => void connect(), delay));
    });

    try {
      await client.connect();
      attempt = 0;
      await ensureFolders(client, imapCfg);
      await writeMailEvent(pool, 'inboundOk');
      log(`IMAP ${imapCfg.host}:${imapCfg.port} — ящик открыт, IDLE`);
      await drain();
      const poll = setInterval(() => void drain(), cfg.pollIntervalMs);
      timers.push(poll as unknown as NodeJS.Timeout);
      client.on('close', () => clearInterval(poll));
    } catch (e) {
      warn(`IMAP подключение: ${(e as Error).message}`);
      await writeMailEvent(pool, 'error', `IMAP: ${(e as Error).message}`).catch(() => {});
      client.close();
    }
  };
  void connect();
}

async function main(): Promise<void> {
  try {
    const state = await assertSchemaCurrent(pool as never);
    log(`схема: применено ${state.applied.length}`);
  } catch (error) {
    fatal((error as Error).message);
  }
  await heartbeat();
  timers.push(setInterval(() => void heartbeat(), 30_000) as unknown as NodeJS.Timeout);
  await housekeeping();
  timers.push(setInterval(() => void housekeeping(), 10 * 60_000) as unknown as NodeJS.Timeout);

  if (!cfg.smtp && !cfg.imap) {
    warn(`почта НЕ НАСТРОЕНА — канал выключен (нет: ${cfg.missing.join(', ')}). Работают восстановление обращений и автозакрытие.`);
  }
  if (cfg.smtp) {
    log(`SMTP ${cfg.smtp.host}:${cfg.smtp.port} (${cfg.smtp.secure ? 'TLS' : 'STARTTLS'}) от ${cfg.address}, лимит ${cfg.sendPerHour}/ч`);
    startSender();
  } else if (cfg.imap) {
    warn('SMTP не настроен — ответы письмом и auth-письма копятся в очереди');
  }
  if (cfg.imap) startReceiver();
  else if (cfg.smtp) warn('IMAP не настроен — приём писем выключен');
  log(`тенант ${tenant}`);
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true;
    for (const t of timers) clearTimeout(t);
    void pool.end().finally(() => process.exit(0));
  });
}

void main();

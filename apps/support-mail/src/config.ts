import { readEnv } from '@broker/utils';

/**
 * Конфигурация почтового канала из окружения ячейки (одна ячейка = свой домен
 * и свой ящик). Секреты (пароли ящика) — ТОЛЬКО здесь, не в базе и не в UI.
 *
 * Fail-closed по частям: нет SMTP-переменных → исходящие выключены (письма
 * копятся в очереди и уходят, когда ящик настроят); нет IMAP → приём выключен.
 * Остальное (восстановление обращений, автозакрытие) работает всегда. Список
 * недостающих имён (без значений) уходит в `support_mail_status` — админка
 * пишет «почта не настроена: нет …».
 */

export interface SmtpConfig {
  host: string;
  port: number;
  /** 465 — TLS сразу; иначе — обязательный STARTTLS (без шифрования не шлём). */
  secure: boolean;
  user: string;
  password: string;
  rejectUnauthorized: boolean;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  rejectUnauthorized: boolean;
  inbox: string;
  processedFolder: string;
  failedFolder: string;
  sentFolder: string | null;
}

export interface MailConfig {
  /** Адрес ящика поддержки: From, свой адрес (петли), домен Message-ID. */
  address: string | null;
  smtp: SmtpConfig | null;
  imap: ImapConfig | null;
  missing: string[];
  pollIntervalMs: number;
  sendIntervalMs: number;
  /** Лимит хостинга на отправку (писем в час). */
  sendPerHour: number;
}

type Env = Record<string, string | undefined>;

function num(raw: string | null, d: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
}

const flag = (raw: string | null, d: boolean) => (raw === null ? d : !['0', 'false', 'no', 'off'].includes(raw.toLowerCase()));

export function readMailConfig(env: Env = process.env): MailConfig {
  const missing: string[] = [];
  const need = (name: string): string | null => {
    const v = readEnv(env[name]);
    if (!v) missing.push(name);
    return v;
  };
  const address = need('SUPPORT_MAIL_ADDRESS');

  const smtpHost = need('SUPPORT_SMTP_HOST');
  const smtpUser = need('SUPPORT_SMTP_USER');
  const smtpPass = need('SUPPORT_SMTP_PASSWORD');
  const smtpPort = num(readEnv(env.SUPPORT_SMTP_PORT), 465, 1, 65535);
  const smtp: SmtpConfig | null =
    address && smtpHost && smtpUser && smtpPass
      ? {
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465 || flag(readEnv(env.SUPPORT_SMTP_SECURE), false),
          user: smtpUser,
          password: smtpPass,
          rejectUnauthorized: flag(readEnv(env.SUPPORT_SMTP_TLS_VERIFY), true),
        }
      : null;

  const imapHost = need('SUPPORT_IMAP_HOST');
  const imapUser = need('SUPPORT_IMAP_USER');
  const imapPass = need('SUPPORT_IMAP_PASSWORD');
  const imapPort = num(readEnv(env.SUPPORT_IMAP_PORT), 993, 1, 65535);
  const imap: ImapConfig | null =
    address && imapHost && imapUser && imapPass
      ? {
          host: imapHost,
          port: imapPort,
          secure: imapPort === 993 || flag(readEnv(env.SUPPORT_IMAP_SECURE), false),
          user: imapUser,
          password: imapPass,
          rejectUnauthorized: flag(readEnv(env.SUPPORT_IMAP_TLS_VERIFY), true),
          inbox: readEnv(env.SUPPORT_IMAP_INBOX) ?? 'INBOX',
          processedFolder: readEnv(env.SUPPORT_IMAP_PROCESSED_FOLDER) ?? 'Processed',
          failedFolder: readEnv(env.SUPPORT_IMAP_FAILED_FOLDER) ?? 'Failed',
          sentFolder: readEnv(env.SUPPORT_IMAP_SENT_FOLDER),
        }
      : null;

  return {
    address,
    smtp,
    imap,
    missing,
    pollIntervalMs: num(readEnv(env.SUPPORT_IMAP_POLL_MS), 60_000, 5_000, 3_600_000),
    sendIntervalMs: num(readEnv(env.SUPPORT_SEND_INTERVAL_MS), 5_000, 1_000, 600_000),
    sendPerHour: num(readEnv(env.SUPPORT_SEND_PER_HOUR), 100, 1, 100_000),
  };
}

export function domainOfAddress(address: string): string {
  return address.split('@')[1]?.toLowerCase() || 'localhost';
}

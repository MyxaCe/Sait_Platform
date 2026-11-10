import { createHash } from 'node:crypto';

/** Текстовые утилиты поддержки: шаблоны, тема письма, цитаты, нормализация. */

export const MAX_BODY = 10_000;
export const MAX_SUBJECT = 200;

/**
 * Подстановка `{{путь.к.значению}}`. Неизвестная переменная остаётся как
 * есть — оператор увидит её в предпросмотре, а не пустое место.
 */
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, path: string) => {
    let v: unknown = vars;
    for (const k of path.split('.')) {
      if (typeof v !== 'object' || v === null) return whole;
      v = (v as Record<string, unknown>)[k];
    }
    return v === undefined || v === null ? whole : String(v);
  });
}

/** Текст сообщения: только текст, без управляющих символов, обрезан по лимиту. */
export function sanitizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_BODY);
}

export function sanitizeSubject(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_SUBJECT);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isPlausibleEmail(raw: string): boolean {
  return /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]{2,}$/.test(raw.trim()) && raw.length <= 254;
}

export function domainOf(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

/** Метка номера в теме: «Тема [#1042]». */
export function subjectWithTag(subject: string, number: number): string {
  const clean = sanitizeSubject(subject).replace(/\s*\[#\d+\]\s*/g, ' ').trim();
  return `${clean} [#${number}]`.trim();
}

/** «Re: …» без накопления «Re: Re: Re:». */
export function replySubject(subject: string, number: number): string {
  const base = sanitizeSubject(subject).replace(/^((re|fwd?|ответ|отв)\s*:\s*)+/i, '');
  return `Re: ${subjectWithTag(base, number)}`;
}

/** Номер тикета из метки `[#1042]` в теме письма. */
export function ticketNumberFromSubject(subject: string | null | undefined): number | null {
  const m = /\[#(\d{1,12})\]/.exec(subject ?? '');
  return m ? Number(m[1]) : null;
}

/** Токен цепочки из plus-адреса `support+<token>@домен`. */
export function threadTokenFromAddress(addresses: readonly string[], mailbox: string): string | null {
  const [local, domain] = normalizeEmail(mailbox).split('@');
  if (!local || !domain) return null;
  for (const a of addresses) {
    const m = new RegExp(`^${escapeRe(local)}\\+([a-f0-9]{16,64})@${escapeRe(domain)}$`).exec(normalizeEmail(a));
    if (m) return m[1]!;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<id@host>` — с угловыми скобками, без пробелов; пусто → null. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const inner = t.replace(/^<|>$/g, '').trim();
  return inner ? `<${inner}>` : null;
}

/**
 * Ответ клиента без цитаты: обрезаем на первой строке-маркере цитирования
 * («On … wrote:», «… пишет:», «-----Original Message-----», «From:» блока
 * пересылки) и хвост из строк «>». Если обрезка съела всё — оставляем
 * исходный текст (лучше длинно, чем пусто).
 */
export function stripQuotedReply(text: string): string {
  const lines = sanitizeBody(text).split('\n');
  const markers = [
    /^\s*On .{3,200} wrote:\s*$/i,
    /^\s*.{3,200}(пишет|написал|написала)\s*:\s*$/i,
    /^\s*-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение)\s*-{2,}\s*$/i,
    /^\s*_{10,}\s*$/,
    /^\s*(From|От|Від):\s.+$/,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (markers.some((re) => re.test(lines[i]!))) {
      cut = i;
      break;
    }
  }
  let kept = lines.slice(0, cut);
  while (kept.length && (/^\s*>/.test(kept[kept.length - 1]!) || !kept[kept.length - 1]!.trim())) kept.pop();
  kept = kept.filter((l, i, a) => !(/^\s*>/.test(l) && a.slice(i).every((x) => /^\s*>/.test(x) || !x.trim())));
  const out = kept.join('\n').trim();
  return out || sanitizeBody(text);
}

/** Первое имя для обращения в шаблонах («Анна Клиентова» → «Анна»). */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

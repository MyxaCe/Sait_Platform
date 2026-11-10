import type { Queryable } from '@broker/money';

/**
 * Настройки поддержки — ничего не хардкодим (решение владельца 10.11).
 *
 * Хранятся одним JSONB (`support_settings.settings`, строка на базу = на
 * ячейку/тенант). **Ключи совпадают с будущим глобалом CMS «Поддержка»**
 * (camelCase, вложенность как у Payload-группы): переезд текстов в CMS —
 * смена источника чтения, а не схемы и не кода экранов.
 *
 * Чтение МЯГКОЕ (потребитель парсит мягко, CLAUDE.md): неизвестный ключ
 * отбрасывается, кривое значение заменяется умолчанием — экран поддержки не
 * падает из-за одной опечатки в настройке. Запись — СТРОГАЯ
 * (`validateSettings`): админка не сохранит то, что потом прочтётся иначе.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface DayHours {
  /** «HH:MM» местного времени. */
  open: string;
  close: string;
}

export interface SupportTexts {
  /** Приветствие в пустом чате кабинета. */
  greeting: string;
  /** Плашка/автоответ вне рабочих часов. */
  offHours: string;
  /** Автоответ на новое обращение (чат в часы работы / письмо-подтверждение). */
  autoReply: string;
  /** Подпись в письмах оператора. */
  signature: string;
  /** Подзаголовок формы обращения на витрине. */
  formIntro: string;
  /** Просьба оценить после «решено». */
  csatPrompt: string;
  passwordResetSubject: string;
  passwordResetBody: string;
  emailVerifySubject: string;
  emailVerifyBody: string;
}

export interface SupportCategory {
  key: string;
  label: { ru: string; en: string };
}

export interface SupportSettings {
  channels: {
    /** Чат в кабинете (кнопка в углу). */
    chat: boolean;
    /** Форма обращения на витрине (гость → тикет, ответ на почту). */
    webForm: boolean;
    /** Почтовый канал поддержки: приём писем и ответы письмом. */
    email: boolean;
  };
  hours: {
    timezone: string;
    alwaysOpen: boolean;
    week: Record<Weekday, DayHours | null>;
    /** Праздники «YYYY-MM-DD» (местная дата). */
    holidays: string[];
  };
  sla: {
    chatFirstResponseMinutes: number;
    emailFirstResponseMinutes: number;
    webFormFirstResponseMinutes: number;
  };
  autoReply: { enabled: boolean };
  /** Решённое закрывается после N дней тишины. */
  autoCloseDays: number;
  attachments: { maxBytes: number };
  limits: {
    chatMessagesPerMinute: number;
    emailsPerSenderPerHour: number;
  };
  /** Имя отправителя писем (адрес — env ячейки, не настройка). */
  mail: { fromName: string };
  categories: SupportCategory[];
  texts: { ru: SupportTexts; en: SupportTexts };
}

/** MIME вложений — закрытый перечень (как KYC); размер — настройка. */
export const ATTACHMENT_MIME: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png'];

const WORKDAY: DayHours = { open: '09:00', close: '21:00' };

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  channels: { chat: true, webForm: true, email: true },
  hours: {
    timezone: 'Europe/Moscow',
    alwaysOpen: false,
    week: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: null, sun: null },
    holidays: [],
  },
  sla: { chatFirstResponseMinutes: 15, emailFirstResponseMinutes: 240, webFormFirstResponseMinutes: 240 },
  autoReply: { enabled: true },
  autoCloseDays: 7,
  attachments: { maxBytes: 10 * 1024 * 1024 },
  limits: { chatMessagesPerMinute: 10, emailsPerSenderPerHour: 10 },
  mail: { fromName: 'Служба поддержки' },
  categories: [
    { key: 'account', label: { ru: 'Счёт и доступ', en: 'Account & access' } },
    { key: 'verification', label: { ru: 'Верификация', en: 'Verification' } },
    { key: 'deposit', label: { ru: 'Пополнение', en: 'Deposit' } },
    { key: 'withdrawal', label: { ru: 'Вывод средств', en: 'Withdrawal' } },
    { key: 'trading', label: { ru: 'Торговля', en: 'Trading' } },
    { key: 'other', label: { ru: 'Другое', en: 'Other' } },
  ],
  texts: {
    ru: {
      greeting: 'Здравствуйте! Опишите вопрос — оператор поддержки ответит здесь же.',
      offHours:
        'Сейчас нерабочее время поддержки. Сообщение получено — ответим в рабочие часы: {{hours}}.',
      autoReply: 'Обращение #{{ticket.number}} получено. Оператор ответит в рабочие часы: {{hours}}.',
      signature: '—\nСлужба поддержки',
      formIntro: 'Опишите вопрос — ответ придёт на указанный email.',
      csatPrompt: 'Помогли ли мы решить вопрос? Оцените ответ поддержки.',
      passwordResetSubject: 'Сброс пароля',
      passwordResetBody:
        'Здравствуйте, {{client.firstName}}!\n\nЧтобы задать новый пароль, перейдите по ссылке (действует {{ttlMinutes}} мин):\n{{link}}\n\nЕсли вы не запрашивали сброс, просто проигнорируйте письмо — пароль не изменится.',
      emailVerifySubject: 'Подтвердите email',
      emailVerifyBody:
        'Здравствуйте, {{client.firstName}}!\n\nПодтвердите адрес почты по ссылке (действует {{ttlHours}} ч):\n{{link}}\n\nЕсли вы не регистрировались, проигнорируйте письмо.',
    },
    en: {
      greeting: 'Hello! Describe your question — a support agent will reply right here.',
      offHours: 'Support is offline now. We received your message and will reply during business hours: {{hours}}.',
      autoReply: 'Request #{{ticket.number}} received. An agent will reply during business hours: {{hours}}.',
      signature: '—\nSupport team',
      formIntro: 'Describe your question — we will reply to the email you provide.',
      csatPrompt: 'Did we solve your issue? Please rate the support reply.',
      passwordResetSubject: 'Password reset',
      passwordResetBody:
        'Hello {{client.firstName}},\n\nTo set a new password, open this link (valid for {{ttlMinutes}} min):\n{{link}}\n\nIf you did not request a reset, ignore this email — your password stays the same.',
      emailVerifySubject: 'Confirm your email',
      emailVerifyBody:
        'Hello {{client.firstName}},\n\nConfirm your email address using this link (valid for {{ttlHours}} h):\n{{link}}\n\nIf you did not sign up, ignore this email.',
    },
  },
};

export const TEXT_KEYS: readonly (keyof SupportTexts)[] = [
  'greeting',
  'offHours',
  'autoReply',
  'signature',
  'formIntro',
  'csatPrompt',
  'passwordResetSubject',
  'passwordResetBody',
  'emailVerifySubject',
  'emailVerifyBody',
];

/* ─── мягкое чтение ─────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d;
const str = (v: unknown, d: string, max = 4000) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : d;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function day(v: unknown, d: DayHours | null): DayHours | null {
  if (v === null) return null;
  if (!isObj(v)) return d;
  const open = typeof v.open === 'string' && HHMM.test(v.open) ? v.open : null;
  const close = typeof v.close === 'string' && HHMM.test(v.close) ? v.close : null;
  if (!open || !close || open >= close) return d;
  return { open, close };
}

function texts(v: unknown, d: SupportTexts): SupportTexts {
  const o = isObj(v) ? v : {};
  const out = { ...d };
  for (const k of TEXT_KEYS) out[k] = str(o[k], d[k]);
  return out;
}

export function parseSupportSettings(raw: unknown): SupportSettings {
  const D = DEFAULT_SUPPORT_SETTINGS;
  const o = isObj(raw) ? raw : {};
  const ch = isObj(o.channels) ? o.channels : {};
  const h = isObj(o.hours) ? o.hours : {};
  const wk = isObj(h.week) ? h.week : {};
  const sla = isObj(o.sla) ? o.sla : {};
  const lim = isObj(o.limits) ? o.limits : {};
  const tz = typeof h.timezone === 'string' && isValidTimezone(h.timezone) ? h.timezone : D.hours.timezone;
  const week = {} as Record<Weekday, DayHours | null>;
  for (const w of WEEKDAYS) week[w] = w in wk ? day(wk[w], D.hours.week[w]) : D.hours.week[w];
  const cats = Array.isArray(o.categories)
    ? o.categories.flatMap((c): SupportCategory[] => {
        if (!isObj(c) || typeof c.key !== 'string' || !CATEGORY_KEY.test(c.key)) return [];
        const l = isObj(c.label) ? c.label : {};
        return [{ key: c.key, label: { ru: str(l.ru, c.key, 80), en: str(l.en, c.key, 80) } }];
      })
    : D.categories;
  const t = isObj(o.texts) ? o.texts : {};
  return {
    channels: {
      chat: bool(ch.chat, D.channels.chat),
      webForm: bool(ch.webForm, D.channels.webForm),
      email: bool(ch.email, D.channels.email),
    },
    hours: {
      timezone: tz,
      alwaysOpen: bool(h.alwaysOpen, D.hours.alwaysOpen),
      week,
      holidays: Array.isArray(h.holidays)
        ? h.holidays.filter((x): x is string => typeof x === 'string' && YMD.test(x))
        : D.hours.holidays,
    },
    sla: {
      chatFirstResponseMinutes: int(sla.chatFirstResponseMinutes, D.sla.chatFirstResponseMinutes, 1, 10080),
      emailFirstResponseMinutes: int(sla.emailFirstResponseMinutes, D.sla.emailFirstResponseMinutes, 1, 10080),
      webFormFirstResponseMinutes: int(sla.webFormFirstResponseMinutes, D.sla.webFormFirstResponseMinutes, 1, 10080),
    },
    autoReply: { enabled: bool(isObj(o.autoReply) ? o.autoReply.enabled : undefined, D.autoReply.enabled) },
    autoCloseDays: int(o.autoCloseDays, D.autoCloseDays, 1, 365),
    attachments: {
      maxBytes: int(isObj(o.attachments) ? o.attachments.maxBytes : undefined, D.attachments.maxBytes, 1024, 25 * 1024 * 1024),
    },
    limits: {
      chatMessagesPerMinute: int(lim.chatMessagesPerMinute, D.limits.chatMessagesPerMinute, 1, 120),
      emailsPerSenderPerHour: int(lim.emailsPerSenderPerHour, D.limits.emailsPerSenderPerHour, 1, 1000),
    },
    mail: { fromName: str(isObj(o.mail) ? o.mail.fromName : undefined, D.mail.fromName, 120) },
    categories: cats.length > 0 ? cats : D.categories,
    texts: { ru: texts(t.ru, D.texts.ru), en: texts(t.en, D.texts.en) },
  };
}

/* ─── строгая запись ────────────────────────────────────────────────── */

export type SettingsError = { field: string; code: string };

/**
 * Строгая проверка перед сохранением: то, что сохранили, прочтётся ровно так
 * же (мягкое чтение не подменит ни одного значения умолчанием).
 */
export function validateSettings(s: SupportSettings): SettingsError[] {
  const errors: SettingsError[] = [];
  if (!isValidTimezone(s.hours.timezone)) errors.push({ field: 'hours.timezone', code: 'invalidTimezone' });
  for (const w of WEEKDAYS) {
    const d = s.hours.week[w];
    if (d && (!HHMM.test(d.open) || !HHMM.test(d.close) || d.open >= d.close)) {
      errors.push({ field: `hours.week.${w}`, code: 'invalidHours' });
    }
  }
  if (!s.hours.alwaysOpen && WEEKDAYS.every((w) => s.hours.week[w] === null)) {
    errors.push({ field: 'hours.week', code: 'noWorkingDays' });
  }
  for (const h of s.hours.holidays) if (!YMD.test(h)) errors.push({ field: 'hours.holidays', code: 'invalidDate' });
  const mins = [s.sla.chatFirstResponseMinutes, s.sla.emailFirstResponseMinutes, s.sla.webFormFirstResponseMinutes];
  if (mins.some((m) => !Number.isInteger(m) || m < 1 || m > 10080)) errors.push({ field: 'sla', code: 'invalidSla' });
  if (!Number.isInteger(s.autoCloseDays) || s.autoCloseDays < 1 || s.autoCloseDays > 365)
    errors.push({ field: 'autoCloseDays', code: 'invalidNumber' });
  if (s.attachments.maxBytes < 1024 || s.attachments.maxBytes > 25 * 1024 * 1024)
    errors.push({ field: 'attachments.maxBytes', code: 'invalidNumber' });
  if (s.limits.chatMessagesPerMinute < 1 || s.limits.chatMessagesPerMinute > 120)
    errors.push({ field: 'limits.chatMessagesPerMinute', code: 'invalidNumber' });
  if (s.limits.emailsPerSenderPerHour < 1 || s.limits.emailsPerSenderPerHour > 1000)
    errors.push({ field: 'limits.emailsPerSenderPerHour', code: 'invalidNumber' });
  if (!s.mail.fromName.trim()) errors.push({ field: 'mail.fromName', code: 'required' });
  const keys = new Set<string>();
  for (const c of s.categories) {
    if (!CATEGORY_KEY.test(c.key) || keys.has(c.key)) errors.push({ field: 'categories', code: 'invalidCategory' });
    keys.add(c.key);
  }
  if (s.categories.length === 0) errors.push({ field: 'categories', code: 'required' });
  for (const loc of ['ru', 'en'] as const) {
    for (const k of TEXT_KEYS) {
      const v = s.texts[loc][k];
      if (!v || !v.trim() || v.length > 4000) errors.push({ field: `texts.${loc}.${k}`, code: 'required' });
    }
  }
  return errors;
}

export async function loadSupportSettings(db: Queryable): Promise<SupportSettings> {
  const r = await db.query(`SELECT settings FROM support_settings WHERE id = 1`);
  return parseSupportSettings(r.rows[0]?.settings ?? {});
}

/** Подпись рабочих часов для текстов («пн–пт 09:00–21:00 (Europe/Moscow)»). */
export function describeHours(s: SupportSettings, locale: 'ru' | 'en'): string {
  if (s.hours.alwaysOpen) return locale === 'ru' ? 'круглосуточно' : '24/7';
  const names: Record<Weekday, [string, string]> = {
    mon: ['пн', 'Mon'],
    tue: ['вт', 'Tue'],
    wed: ['ср', 'Wed'],
    thu: ['чт', 'Thu'],
    fri: ['пт', 'Fri'],
    sat: ['сб', 'Sat'],
    sun: ['вс', 'Sun'],
  };
  const idx = locale === 'ru' ? 0 : 1;
  const groups: { from: Weekday; to: Weekday; h: DayHours }[] = [];
  for (const w of WEEKDAYS) {
    const h = s.hours.week[w];
    if (!h) continue;
    const last = groups[groups.length - 1];
    const prev = WEEKDAYS[WEEKDAYS.indexOf(w) - 1];
    if (last && prev === last.to && last.h.open === h.open && last.h.close === h.close) last.to = w;
    else groups.push({ from: w, to: w, h });
  }
  const parts = groups.map(
    (g) =>
      `${names[g.from][idx]}${g.from === g.to ? '' : `–${names[g.to][idx]}`} ${g.h.open}–${g.h.close}`,
  );
  return `${parts.join(', ')} (${s.hours.timezone})`;
}

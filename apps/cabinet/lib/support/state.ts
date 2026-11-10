import type { PoolLike } from '@broker/money';
import {
  describeHours,
  getClientChat,
  isWithinHours,
  loadSupportSettings,
  renderTemplate,
  type ClientChat,
} from '@broker/support';
import { getPool } from '../db';

/**
 * Состояние виджета поддержки для клиента. Тексты — из настроек поддержки
 * (админка, ключи совместимы с будущим глобалом CMS), а не из кода.
 * Внутренние заметки операторов сюда не попадают — их не выбирает запрос.
 */
export interface SupportWidgetState {
  enabled: boolean;
  online: boolean;
  hours: string;
  slaMinutes: number;
  greeting: string;
  offHours: string;
  csatPrompt: string;
  maxBytes: number;
  chat: ClientChat;
}

export function supportPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

export async function loadWidgetState(
  user: { id: string; fullName: string; locale: 'ru' | 'en' },
  ticketId?: string | null,
): Promise<SupportWidgetState> {
  const db = getPool();
  const [s, chat] = await Promise.all([loadSupportSettings(db), getClientChat(db, user.id, ticketId)]);
  const loc = user.locale;
  const hours = describeHours(s, loc);
  const vars = {
    client: { firstName: user.fullName.split(/\s+/)[0] ?? '' },
    hours,
    ticket: { number: chat.ticket?.number ?? '' },
  };
  return {
    enabled: s.channels.chat,
    online: isWithinHours(s, new Date()),
    hours,
    slaMinutes: s.sla.chatFirstResponseMinutes,
    greeting: renderTemplate(s.texts[loc].greeting, vars),
    offHours: renderTemplate(s.texts[loc].offHours, vars),
    csatPrompt: renderTemplate(s.texts[loc].csatPrompt, vars),
    maxBytes: s.attachments.maxBytes,
    chat,
  };
}

/**
 * Запрос с нашей же страницы (защита от CSRF у JSON/multipart-ручек: кука
 * сессии `lax`, плюс явная сверка Origin с хостом).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

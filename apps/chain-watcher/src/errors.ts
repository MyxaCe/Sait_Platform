/**
 * Причина ошибки прохода — в лог, БЕЗ секретов (волна 3).
 *
 * Раньше сводка прохода показывала только счётчик `errors:1`: при
 * не-Error исключении, пустом сообщении или `fetch failed` (настоящая
 * причина — в `cause`: ECONNRESET, ENOTFOUND, таймаут) причина терялась.
 * Теперь на каждую ошибку — строка с этапом, заявкой (id и хэш), типом,
 * сообщением и кодом/причиной. Секреты вырезаются: значения из окружения
 * (ключ TronGrid, токен терминала, пароль базы), Bearer-токены, пароли в
 * URL подключения, query-параметры с ключами.
 */

export interface ErrorInfo {
  /** Имя класса/тип: ChainUnavailableError, TypeError, string… */
  type: string;
  message: string;
  /** Системный/HTTP код, если есть (ECONNRESET, 23505…). */
  code?: string;
  /** Причина из `cause` (fetch failed → ECONNREFUSED 127.0.0.1:443). */
  cause?: string;
}

const MAX_LEN = 300;

/** Значения env, которые нельзя печатать, — берутся из окружения процесса. */
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const k of ['TRONGRID_API_KEY', 'INTERNAL_MONEY_TOKEN', 'DATABASE_URL']) {
    const v = env[k]?.trim();
    if (v && v.length >= 6) out.push(v);
  }
  // Пароль из DATABASE_URL — отдельно (он может всплыть без остального URL).
  const db = env.DATABASE_URL;
  if (db) {
    try {
      const pw = decodeURIComponent(new URL(db).password);
      if (pw.length >= 4) out.push(pw);
    } catch {
      /* не URL — нечего вырезать */
    }
  }
  return out;
}

export function redact(text: string, secrets: readonly string[] = []): string {
  let t = text;
  for (const s of secrets) t = t.split(s).join('***');
  return t
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1***@')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1***');
}

function clip(s: string): string {
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s;
}

function codeOf(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const c = (e as { code?: unknown; status?: unknown }).code ?? (e as { status?: unknown }).status;
    if (typeof c === 'string' || typeof c === 'number') return String(c);
  }
  return undefined;
}

export function describeError(e: unknown, secrets: readonly string[] = []): ErrorInfo {
  const r = (s: string) => clip(redact(s, secrets));
  if (e instanceof Error) {
    const info: ErrorInfo = {
      type: e.name && e.name !== 'Error' ? e.name : e.constructor?.name || 'Error',
      message: r(e.message || '(пустое сообщение)'),
    };
    const code = codeOf(e);
    if (code) info.code = r(code);
    const cause = (e as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== null) {
      const c = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      const cc = codeOf(cause);
      info.cause = r(cc && !c.includes(cc) ? `${cc} ${c}` : c);
    }
    return info;
  }
  if (typeof e === 'string') return { type: 'string', message: r(e || '(пустая строка)') };
  let text: string;
  try {
    text = JSON.stringify(e) ?? String(e);
  } catch {
    text = String(e);
  }
  return { type: e === null ? 'null' : typeof e, message: r(text) };
}

/** Одна строка лога: `тип: сообщение [код] (причина: …)`. */
export function formatError(info: ErrorInfo): string {
  let s = `${info.type}: ${info.message}`;
  if (info.code) s += ` [${info.code}]`;
  if (info.cause) s += ` (причина: ${info.cause})`;
  return s;
}

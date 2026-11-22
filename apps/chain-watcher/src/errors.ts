export interface ErrorInfo {
  type: string;
  message: string;
  code?: string;
  cause?: string;
}

const MAX_LEN = 300;

export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const k of ['TRONGRID_API_KEY', 'INTERNAL_MONEY_TOKEN', 'DATABASE_URL']) {
    const v = env[k]?.trim();
    if (v && v.length >= 6) out.push(v);
  }
  const db = env.DATABASE_URL;
  if (db) {
    try {
      const pw = decodeURIComponent(new URL(db).password);
      if (pw.length >= 4) out.push(pw);
    } catch {
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

export function formatError(info: ErrorInfo): string {
  let s = `${info.type}: ${info.message}`;
  if (info.code) s += ` [${info.code}]`;
  if (info.cause) s += ` (причина: ${info.cause})`;
  return s;
}

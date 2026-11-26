/**
 * Регистрация, ждущая подтверждения почты (решение владельца 26.11).
 *
 * После «Зарегистрироваться» и после входа с неподтверждённой почтой браузер получает
 * httpOnly-cookie с адресом и адресом возврата (`next`). Из неё экран «Проверьте почту»
 * показывает, куда ушло письмо, и отправляет его повторно, — без адреса в URL и истории
 * браузера. Секретов в cookie нет: подделать её можно, но это даёт лишь то же, что форма
 * «отправить письмо ещё раз» с любым адресом, а она ограничена по частоте и отвечает
 * одинаково для любого адреса.
 */
export const PENDING_ACTIVATION_COOKIE = 'cab_pending_activation';
export const PENDING_ACTIVATION_MAX_AGE = 24 * 3600;

export interface PendingActivation {
  email: string;
  next: string | null;
}

const MAX_LEN = 600;

export function encodePendingActivation(p: PendingActivation): string {
  return Buffer.from(JSON.stringify({ e: p.email, n: p.next ?? null }), 'utf8').toString('base64url');
}

export function decodePendingActivation(raw: string | null | undefined): PendingActivation | null {
  if (!raw || raw.length > MAX_LEN) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { e?: unknown; n?: unknown };
    if (typeof v.e !== 'string' || !v.e.includes('@') || v.e.length > 254) return null;
    return { email: v.e, next: typeof v.n === 'string' ? v.n : null };
  } catch {
    return null;
  }
}

/** a***@example.com — адрес узнаётся владельцем, но не читается с экрана целиком. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length - 1) || 1);
  return `${head}${'•'.repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

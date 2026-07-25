'use server';

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from './db';
import { isRateLimited } from './rate-limit';
import { hashPassword, verifyPassword } from './auth/password';
import { registerUser } from './auth/register';
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
} from './auth/schemas';
import {
  createSession,
  destroyCurrentSession,
  getSessionUser,
  revokeSession,
} from './auth/session';

/**
 * Серверные экшены кабинета. Контракт с формами:
 * { fieldErrors } — ключи namespace `validation` (ADR-011), перевод на рендере;
 * { error } — общая ошибка ('rateLimited' | 'invalidCredentials' | ...).
 * Успех навигационных экшенов — redirect (throw), не возврат.
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function clientIp(): string {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

function zodFieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

function homePath(locale: string): string {
  return locale === 'en' ? '/en' : '/';
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (isRateLimited(`register:${clientIp()}`, 5, 60_000)) {
    return { error: 'rateLimited' };
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    // honeypot: боту отвечаем как обычной ошибке валидации, без деталей
    return { fieldErrors: zodFieldErrors(parsed.error) };
  }

  const result = await registerUser(parsed.data);
  if (!result.ok) {
    return { fieldErrors: { email: 'emailExists' } };
  }
  await createSession(result.userId);
  redirect(homePath(parsed.data.locale));
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (isRateLimited(`login:${clientIp()}`, 10, 60_000)) {
    return { error: 'rateLimited' };
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: zodFieldErrors(parsed.error) };
  }

  const r = await getPool().query(
    `SELECT id, password_hash, locale FROM users WHERE lower(email) = lower($1)`,
    [parsed.data.email],
  );
  const row = r.rows[0];
  // Хеш сверяем и для несуществующего email — одинаковое время ответа
  const ok = row
    ? await verifyPassword(parsed.data.password, row.password_hash)
    : await verifyPassword(parsed.data.password, '$2a$12$invalidsaltinvalidsaltinvalidsaltinval');
  if (!row || !ok) {
    return { error: 'invalidCredentials' };
  }

  await getPool().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);
  await createSession(row.id);
  redirect(homePath(String(formData.get('uiLocale') ?? row.locale)));
}

export async function logoutAction(formData: FormData): Promise<void> {
  await destroyCurrentSession();
  redirect(String(formData.get('uiLocale')) === 'en' ? '/en/login' : '/login');
}

/* ------------------------------------------------------------------ */
/* Профиль и безопасность                                              */
/* ------------------------------------------------------------------ */

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };

  const parsed = profileSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };

  await getPool().query(`UPDATE users SET full_name = $1, locale = $2 WHERE id = $3`, [
    parsed.data.fullName,
    parsed.data.locale,
    user.id,
  ]);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`password:${user.id}`, 5, 60_000)) return { error: 'rateLimited' };

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };

  const r = await getPool().query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!(await verifyPassword(parsed.data.currentPassword, r.rows[0].password_hash))) {
    return { fieldErrors: { currentPassword: 'wrongPassword' } };
  }

  await getPool().query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    await hashPassword(parsed.data.newPassword),
    user.id,
  ]);
  return { ok: true };
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const sessionId = String(formData.get('sessionId') ?? '');
  if (sessionId) await revokeSession(user.id, sessionId);
  revalidatePath('/security');
}

/* ------------------------------------------------------------------ */
/* Документы (KYC-заглушка до интеграции с CRM)                        */
/* ------------------------------------------------------------------ */

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export async function uploadDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`upload:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };

  const kind = String(formData.get('kind') ?? 'other');
  if (!['identity', 'address', 'other'].includes(kind)) return { error: 'invalidRequest' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: 'required' } };
  }
  if (!ALLOWED_MIME.has(file.type)) return { fieldErrors: { file: 'unsupportedFormat' } };
  if (file.size > MAX_DOC_BYTES) return { fieldErrors: { file: 'fileTooLarge' } };

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const storedName = `${randomUUID()}.${ext}`;
  await writeFile(path.join(uploadDir, storedName), Buffer.from(await file.arrayBuffer()));

  await getPool().query(
    `INSERT INTO documents (id, user_id, kind, filename, stored_path, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), user.id, kind, file.name.slice(0, 200), storedName, file.type, file.size],
  );
  await getPool().query(
    `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, 'documentUploaded', $3)`,
    [randomUUID(), user.id, JSON.stringify({ filename: file.name.slice(0, 200) })],
  );
  revalidatePath('/documents');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Уведомления                                                         */
/* ------------------------------------------------------------------ */

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const id = String(formData.get('id') ?? '');
  if (id) {
    await getPool().query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, user.id],
    );
  }
  revalidatePath('/notifications');
}

export async function markAllReadAction(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await getPool().query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [user.id],
  );
  revalidatePath('/notifications');
}

'use server';

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { ATTRIBUTION_COOKIES } from '@broker/promo/attribution';
import { redirect } from 'next/navigation';
import { getPool } from './db';
import { isRateLimited } from './rate-limit';
import { hashPassword, verifyPassword } from './auth/password';
import { registerUser } from './auth/register';
import { checkLogin } from './auth/login';
import { resetDemoAccount, type TerminalFailure } from './terminal/client';
import { safeNext } from './auth/next-path';
import { getTenantStartBalance } from './tenant';
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
} from './auth/schemas';
import { envOr } from '@broker/utils';
import { localeHref } from '@/i18n/redirect';
import { MAX_DOC_BYTES } from '@/upload-limits.mjs';
import {
  createSession,
  destroyCurrentSession,
  getSessionUser,
  revokeSession,
} from './auth/session';

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

function homePath(locale: string): Promise<string> {
  return localeHref('/', locale);
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (isRateLimited(`register:${clientIp()}`, 5, 60_000)) {
    return { error: 'rateLimited' };
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: zodFieldErrors(parsed.error) };
  }

  const jar = cookies();
  const geoHeader = process.env.GEO_COUNTRY_HEADER?.trim();
  const ip = clientIp();
  const result = await registerUser(parsed.data, {
    cookies: {
      ref: jar.get(ATTRIBUTION_COOKIES.ref)?.value ?? null,
      promo: jar.get(ATTRIBUTION_COOKIES.promo)?.value ?? null,
    },
    params: {
      ref: typeof raw.ref === 'string' ? raw.ref : null,
      promo: typeof raw.promo === 'string' ? raw.promo : null,
    },
    ip: ip === 'local' ? null : ip,
    ipCountry: geoHeader ? headers().get(geoHeader) : null,
    invite: typeof raw.invite === 'string' && raw.invite ? raw.invite : null,
  });
  if (!result.ok) {
    if (result.reason === 'emailExists') {
      return { fieldErrors: { email: 'emailExists' } };
    }
    return { error: result.reason };
  }
  await createSession(result.userId);
  redirect(safeNext(formData.get('next')) ?? (await homePath(parsed.data.locale)));
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

  const check = await checkLogin(parsed.data.email, parsed.data.password);
  if (!check.ok) {
    return { error: check.error };
  }

  await getPool().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [check.userId]);
  await createSession(check.userId);
  if (check.mustChangePassword) {
    redirect(await localeHref('/change-password', String(formData.get('uiLocale') ?? check.locale)));
  }
  const next = safeNext(formData.get('next'));
  redirect(next ?? (await homePath(String(formData.get('uiLocale') ?? check.locale))));
}

export async function logoutAction(formData: FormData): Promise<void> {
  await destroyCurrentSession();
  redirect(await localeHref('/login', String(formData.get('uiLocale'))));
}

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
  revalidatePath('/profile');
}

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

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

  const uploadDir = envOr(process.env.UPLOAD_DIR, path.join(process.cwd(), 'uploads'));
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
  revalidatePath('/profile');
  return { ok: true };
}

export type DemoResetOutcome =
  | { state: 'idle' }
  | { state: 'accepted' }
  | { state: 'refused'; reason: 'not_a_demo_account' | 'account_not_flat' | null }
  | { state: 'unavailable'; reason: TerminalFailure }
  | { state: 'too-often' }
  | { state: 'no-session' };

export async function resetDemoAccountAction(
  _previous: DemoResetOutcome,
): Promise<DemoResetOutcome> {
  const user = await getSessionUser();
  if (!user) return { state: 'no-session' };
  if (isRateLimited(`demo-reset:${user.id}`, 5, 60_000)) {
    return { state: 'too-often' };
  }

  const outcome = await resetDemoAccount(user.id);

  if (outcome.state === 'unavailable') {
    console.error(`[demo-reset] терминал недоступен: ${outcome.reason}`, { userId: user.id });
    return { state: 'unavailable', reason: outcome.reason };
  }
  if (outcome.state === 'refused') {
    console.error(`[demo-reset] терминал отказал: ${outcome.raw}`, { userId: user.id });
    return { state: 'refused', reason: outcome.reason };
  }

  revalidatePath('/', 'layout');
  return { state: 'accepted' };
}

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

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
import { resetDemoAccount, type TerminalFailure } from './terminal/client';
import { getTenantStartBalance } from './tenant';
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
} from './auth/schemas';
import { envOr } from '@broker/utils';
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
    // Три причины отказа — три разных ответа формы. Прежде здесь любой
    // отказ превращался в «email занят»: один беззвучный исход на
    // несколько причин, ровно тот класс, который закрывает Р-025.
    if (result.reason === 'emailExists') {
      return { fieldErrors: { email: 'emailExists' } };
    }
    return { error: result.reason };
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

  // Пустая строка — не отсутствие (WEB-21): пустой UPLOAD_DIR уводил бы
  // запись файлов в корень рабочего каталога.
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
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Демо-счёт                                                           */
/* ------------------------------------------------------------------ */

/**
 * Сброс демо-счёта — **операция ТЕРМИНАЛА** (WEB-29, решение владельца).
 *
 * > Владелец денежного числа — терминал. Кабинет — проекция.
 *
 * **Чем это было.** Кабинет правил свою копию баланса сам, и следующее
 * же событие о балансе возвращало прежнюю сумму — **сброс отменялся
 * сам**, тихо и не сразу. Человек видел нужное число, уходил, а при
 * следующем тике оно пропадало. Это не потеря денег, а расхождение
 * проекции с источником, которое ничем не краснело.
 *
 * **Чем стало.** `POST /account/demo-reset` у терминала (`TRM-54`):
 * операция идёт его обычным путём мутации — журнал, инварианты,
 * сверка, исходящая очередь одной транзакцией, — и возвращается к нам
 * событием с причиной `reset`. Отдельного пути у денег не бывает.
 *
 * **«Принято» не равно «применено».** Новой суммы мы здесь не знаем и
 * не показываем: она приедет событием. Показать её сразу значило бы
 * утверждать результат, которого мы не видели, — и это ровно то, на
 * чём ломался прежний сброс.
 *
 * **Стартовую сумму здесь больше не читаем.** Её назначает владелец
 * счёта, а им стал терминал; наш барьер Р-040 переехал туда вместе с
 * операцией (`not_a_demo_account`).
 *
 * Барьер ограничения частоты остаётся здесь, а не только в интерфейсе:
 * кнопка в `BalanceModule` задизейблена с подписью, но экшен
 * вызывается запросом, а не кнопкой.
 */
/**
 * Исход сброса — для ЧЕЛОВЕКА, а не только для лога (WEB-42).
 *
 * Прежде действие возвращало пустоту. Это значило, что нажатие не
 * даёт отклика **вообще**: страница перерисовывается со старым
 * числом (событие ещё не приехало), а отказ терминала уходит в
 * `console.error`, то есть в серверный лог. Для человека успех и
 * отказ выглядели одинаково — наш основной класс, в единственном
 * месте, куда мы не смотрели: там, где нажимают кнопку.
 *
 * Оси те же, что у причин молчания инструментов: **не дошли** против
 * **отказано по существу**. Схлопнутые, они отправляют чинить
 * наугад — а здесь «чинит» сам человек, и `account_not_flat` он
 * исправить может: закрыть позиции.
 */
export type DemoResetOutcome =
  /** Ничего ещё не нажимали. */
  | { state: 'idle' }
  /** Терминал принял. **Не «сброшено»**: сумма приедет событием. */
  | { state: 'accepted' }
  /** Терминал отказал по существу. `null` — причина незнакомая. */
  | { state: 'refused'; reason: 'not_a_demo_account' | 'account_not_flat' | null }
  /** До терминала не дошли. */
  | { state: 'unavailable'; reason: TerminalFailure }
  /** Слишком часто. **Называется**, иначе человек жмёт в третью тишину. */
  | { state: 'too-often' }
  /** Сессии нет. */
  | { state: 'no-session' };

export async function resetDemoAccountAction(
  /** Предыдущее состояние: его требует `useFormState`, нам оно не нужно. */
  _previous: DemoResetOutcome,
): Promise<DemoResetOutcome> {
  const user = await getSessionUser();
  if (!user) return { state: 'no-session' };
  if (isRateLimited(`demo-reset:${user.id}`, 5, 60_000)) {
    /*
      Молчащее ограничение поверх молчащего отказа — худшее из
      сочетаний: человек жмёт второй раз именно потому, что первый не
      ответил, и получает за это третье молчание.
    */
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

  /*
    Уведомления здесь больше нет. Прежде кабинет писал «счёт сброшен до
    N» сам, и N брал из своей копии стартовой суммы — то есть сообщал
    человеку число, которого не наблюдал. Теперь уведомление родится
    из события шины, когда сброс действительно применится.
  */
  revalidatePath('/', 'layout');
  return { state: 'accepted' };
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

'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireTenantSlug } from '@broker/tenant';
import { buildKycObjectKey, putObject } from '@broker/storage';
import { getPool } from './db';
import { getSessionUser } from './auth/session';
import { isRateLimited } from './rate-limit';
import { isKycDocKind } from './kyc-kinds';
import type { ActionState } from './actions';

/**
 * Приём KYC-документа от КЛИЕНТА (CAB-KYC, Р-454 II-1).
 *
 * Жизненный цикл документа начинается здесь — на клиентской стороне, под
 * СОБСТВЕННОЙ авторизацией кабинета (`getSessionUser`, НЕ оператор):
 *
 *  1. файл кладётся в объектное хранилище по ключу
 *     `kyc/{tenant}/{client}/{doc_type}/{uuid}` (`@broker/storage`); uuid даёт
 *     неугадываемость, tenant/client/type — изоляцию префиксов;
 *  2. строкой `kyc_documents` фиксируется ССЫЛКА (не байты) + метаданные;
 *  3. `client_verification` переводится/создаётся в `pending` — клиент встаёт
 *     в операторскую очередь.
 *
 * Стиль повторяет `uploadDocumentAction` (та же валидация MIME/размера, тот же
 * контракт формы), но хранилище — объектное, а не локальный диск, и таблицы —
 * операторские (`kyc_documents` / `client_verification`), а не заглушка.
 *
 * **Порядок — fail-closed.** Сначала кладём объект, потом пишем строки. Если
 * хранилище не настроено/недоступно — `putObject` бросает, строки НЕ
 * появляются, оператор не увидит документ без файла. Строки же (документ +
 * перевод в pending) пишутся ОДНОЙ транзакцией: «подан документ» и «ждёт
 * решения» либо оба факта, либо ни одного.
 *
 * **tenant — из SITE_SLUG процесса, fail-closed.** `requireTenantSlug` бросает,
 * если слаг не задан (PKG-05): положить документ без тенанта значило бы смешать
 * клиентов разных брендов в одном префиксе.
 */

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export async function submitKycDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`kyc-upload:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };

  const kind = String(formData.get('kind') ?? '');
  if (!isKycDocKind(kind)) return { error: 'invalidRequest' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: 'required' } };
  }
  if (!ALLOWED_MIME.has(file.type)) return { fieldErrors: { file: 'unsupportedFormat' } };
  if (file.size > MAX_DOC_BYTES) return { fieldErrors: { file: 'fileTooLarge' } };

  // tenant обязателен для ключа — без него отказ, а не чужой префикс (PKG-05).
  const tenant = requireTenantSlug(process.env.SITE_SLUG, 'приём KYC-документа в кабинете');
  const uuid = randomUUID();
  const storageKey = buildKycObjectKey({ tenant, client: user.id, docKind: kind, uuid });

  // 1) Байты в объектное хранилище. Бросит, если хранилище не настроено —
  //    тогда строки ниже не появятся (fail-closed).
  await putObject({
    key: storageKey,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  // 2) Ссылка + перевод в pending — ОДНОЙ транзакцией.
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), user.id, kind, storageKey, file.type],
    );
    // Подача документа ставит клиента в очередь: нет строки — создаём pending;
    // есть — переводим в pending (новая подача заново открывает проверку).
    await client.query(
      `INSERT INTO client_verification (user_id, state, updated_at)
       VALUES ($1, 'pending', now())
       ON CONFLICT (user_id) DO UPDATE SET state = 'pending', updated_at = now()`,
      [user.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  revalidatePath('/verification');
  revalidatePath('/profile'); // r2: верификация — вкладка «Профиля»
  return { ok: true };
}

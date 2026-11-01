'use server';

import { getOperatorSession } from '../auth/current';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { issueViewUrl } from '@broker/storage';

/**
 * Выдача оператору ВРЕМЕННОЙ ссылки на просмотр KYC-документа (ADM-12).
 *
 * **Почему server action, а не `/api`.** Та же причина, что у решения по KYC
 * (`actions.ts`): `/api` закрыт по умолчанию (Р-451 п.3), а server action — это
 * POST в уже защищённый `(protected)`-роут, без новой публичной поверхности и
 * без записи в allowlist. Байты документа наружу не проксируются: оператор
 * получает короткоживущий подписанный URL и идёт в хранилище напрямую.
 *
 * **Доступ ЖУРНАЛИРУЕТСЯ (Р-049).** Открыть документ клиента — наблюдаемое
 * действие оператора, а не бесследное чтение. Перед выдачей ссылки пишем
 * запись `client.document.viewed` (кто/когда/какой документ) в неизменяемый
 * журнал. Личность оператора — из СЕССИИ (`getOperatorSession`), НЕ из формы
 * (Р-451): иначе доступ можно было бы записать на чужое имя.
 *
 * **Порядок — fail-closed.** Подпись URL (локальный расчёт, без побочных
 * эффектов) → запись в журнал → только потом отдаём ссылку. Если журнал
 * недоступен, запись не создана — и ссылку мы НЕ отдаём: доступ без следа не
 * выдаётся. Журналируем через пул (самостоятельная транзакция с advisory-lock
 * внутри `appendJournalEntry`): просмотр — отдельное действие, чужой транзакции
 * здесь нет.
 */

export type ViewUrlResult =
  | { ok: true; url: string }
  /** Нет валидной операторской сессии (defense in depth поверх middleware). */
  | { ok: false; reason: 'unauthorized' }
  /** Документа с таким id нет. */
  | { ok: false; reason: 'notFound' }
  /** Хранилище не настроено/недоступно или журнал не принял запись. */
  | { ok: false; reason: 'unavailable' };

interface DocRow {
  user_id: string;
  doc_kind: string;
  storage_key: string;
}

export async function issueDocumentViewUrlAction(docId: string): Promise<ViewUrlResult> {
  const operator = await getOperatorSession();
  if (!operator) {
    // Личность автора доступа обязана быть из валидной сессии — иначе отказ.
    return { ok: false, reason: 'unauthorized' };
  }

  const id = String(docId ?? '').trim();
  if (!id) return { ok: false, reason: 'notFound' };

  const found = await getPool().query(
    `SELECT user_id, doc_kind, storage_key FROM kyc_documents WHERE id = $1`,
    [id],
  );
  const doc = found.rows[0] as DocRow | undefined;
  if (!doc) return { ok: false, reason: 'notFound' };

  try {
    // 1) Подпись ссылки — локальный расчёт, срок зажат в 5–15 мин в модуле хранилища.
    const url = await issueViewUrl(doc.storage_key);

    // 2) Журналируем доступ ДО выдачи ссылки: если журнал не принял — ссылку не отдаём.
    await appendJournalEntry({
      operatorId: operator.operatorId,
      action: 'client.document.viewed',
      subjectKind: 'client',
      subjectId: doc.user_id,
      payload: { docId: id, kind: doc.doc_kind },
    });

    return { ok: true, url };
  } catch (error) {
    // Хранилище не настроено, недоступно, или журнал отклонил запись — fail-closed.
    console.error('[kyc] выдача ссылки на документ не удалась', {
      docId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'unavailable' };
  }
}

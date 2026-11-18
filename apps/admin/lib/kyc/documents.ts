'use server';

import { canViewKycDocuments } from '@/components/shell/sections';
import { getOperatorSession } from '../auth/current';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { issueViewUrl } from '@broker/storage';

export type ViewUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'notFound' }
  | { ok: false; reason: 'unavailable' };

interface DocRow {
  user_id: string;
  doc_kind: string;
  storage_key: string;
}

export async function issueDocumentViewUrlAction(docId: string): Promise<ViewUrlResult> {
  const operator = await getOperatorSession();
  if (!operator) {
    return { ok: false, reason: 'unauthorized' };
  }
  if (!canViewKycDocuments(operator.role)) return { ok: false, reason: 'unauthorized' };

  const id = String(docId ?? '').trim();
  if (!id) return { ok: false, reason: 'notFound' };

  const found = await getPool().query(
    `SELECT user_id, doc_kind, storage_key FROM kyc_documents WHERE id = $1`,
    [id],
  );
  const doc = found.rows[0] as DocRow | undefined;
  if (!doc) return { ok: false, reason: 'notFound' };

  try {
    const url = await issueViewUrl(doc.storage_key);

    await appendJournalEntry({
      operatorId: operator.operatorId,
      action: 'client.document.viewed',
      subjectKind: 'client',
      subjectId: doc.user_id,
      payload: { docId: id, kind: doc.doc_kind },
    });

    return { ok: true, url };
  } catch (error) {
    console.error('[kyc] выдача ссылки на документ не удалась', {
      docId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'unavailable' };
  }
}

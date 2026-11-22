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

export interface SelfieReviewIdentity {
  id: string;
  url: string;
  contentType: string | null;
  submittedAt: string;
}

export type SelfieReviewResult =
  | { ok: true; frames: { index: number; url: string }[]; identity: SelfieReviewIdentity | null }
  | { ok: false; reason: 'unauthorized' | 'notFound' | 'unavailable' };

export async function issueSelfieReviewAction(docId: string): Promise<SelfieReviewResult> {
  const operator = await getOperatorSession();
  if (!operator || !canViewKycDocuments(operator.role)) return { ok: false, reason: 'unauthorized' };

  const id = String(docId ?? '').trim();
  if (!id) return { ok: false, reason: 'notFound' };

  const pool = getPool();
  const found = await pool.query(`SELECT user_id, doc_kind FROM kyc_documents WHERE id = $1`, [id]);
  const doc = found.rows[0] as { user_id: string; doc_kind: string } | undefined;
  if (!doc || doc.doc_kind !== 'selfie_liveness') return { ok: false, reason: 'notFound' };

  const frames = (
    await pool.query(
      `SELECT frame_index, storage_key FROM kyc_document_frames WHERE document_id = $1 ORDER BY frame_index`,
      [id],
    )
  ).rows as { frame_index: number; storage_key: string }[];
  if (frames.length === 0) return { ok: false, reason: 'notFound' };

  const identityRow = (
    await pool.query(
      `SELECT id, storage_key, content_type, submitted_at FROM kyc_documents
        WHERE user_id = $1 AND doc_kind = 'identity' ORDER BY submitted_at DESC LIMIT 1`,
      [doc.user_id],
    )
  ).rows[0] as { id: string; storage_key: string; content_type: string | null; submitted_at: string | Date } | undefined;

  try {
    const urls = await Promise.all(frames.map((f) => issueViewUrl(f.storage_key)));
    const identity: SelfieReviewIdentity | null = identityRow
      ? {
          id: identityRow.id,
          url: await issueViewUrl(identityRow.storage_key),
          contentType: identityRow.content_type ?? null,
          submittedAt: new Date(identityRow.submitted_at).toISOString(),
        }
      : null;

    await appendJournalEntry({
      operatorId: operator.operatorId,
      action: 'client.document.viewed',
      subjectKind: 'client',
      subjectId: doc.user_id,
      payload: { docId: id, kind: doc.doc_kind, frames: frames.length },
    });
    if (identity) {
      await appendJournalEntry({
        operatorId: operator.operatorId,
        action: 'client.document.viewed',
        subjectKind: 'client',
        subjectId: doc.user_id,
        payload: { docId: identity.id, kind: 'identity', comparedWith: id },
      });
    }

    return {
      ok: true,
      frames: frames.map((f, i) => ({ index: Number(f.frame_index), url: urls[i]! })),
      identity,
    };
  } catch (error) {
    console.error('[kyc] выдача ссылок на снимки селфи не удалась', {
      docId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'unavailable' };
  }
}

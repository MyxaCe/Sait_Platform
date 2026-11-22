import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorRole } from '../auth/session';

const session = vi.hoisted(() => ({ role: 'operator' as OperatorRole | null }));
const query = vi.hoisted(() => vi.fn());
const journal = vi.hoisted(() => vi.fn(async (_entry: unknown) => undefined));
const issueViewUrl = vi.hoisted(() => vi.fn(async (key: string) => `https://signed.example/${key}`));

vi.mock('../auth/current', () => ({
  getOperatorSession: async () =>
    session.role ? { operatorId: 'op-1', role: session.role, displayName: 'Тест', login: 't' } : null,
}));
vi.mock('../db', () => ({ getPool: () => ({ query }) }));
vi.mock('../journal/journal', () => ({ appendJournalEntry: journal }));
vi.mock('@broker/storage', () => ({ issueViewUrl }));

const { issueSelfieReviewAction } = await import('./documents');

function answer(opts: { kind?: string; frames?: number; identity?: boolean } = {}) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM kyc_documents WHERE id')) return { rows: [{ user_id: 'u1', doc_kind: opts.kind ?? 'selfie_liveness' }] };
    if (sql.includes('FROM kyc_document_frames'))
      return { rows: Array.from({ length: opts.frames ?? 3 }, (_, i) => ({ frame_index: i, storage_key: `kyc/t/u1/selfie_liveness/f${i}` })) };
    if (sql.includes("doc_kind = 'identity'"))
      return {
        rows:
          opts.identity === false
            ? []
            : [{ id: 'id-doc', storage_key: 'kyc/t/u1/identity/p', content_type: 'image/jpeg', submitted_at: '2026-11-20T10:00:00Z' }],
      };
    return { rows: [] };
  });
}

beforeEach(() => {
  query.mockReset();
  journal.mockClear();
  issueViewUrl.mockClear();
  session.role = 'operator';
  answer();
});

describe('снимки селфи в админке: права', () => {
  for (const role of ['finance_operator', 'support_operator'] as const) {
    it(`${role} — отказ без чтения базы и без подписи ссылок`, async () => {
      session.role = role;
      expect(await issueSelfieReviewAction('d1')).toEqual({ ok: false, reason: 'unauthorized' });
      expect(query).not.toHaveBeenCalled();
      expect(issueViewUrl).not.toHaveBeenCalled();
    });
  }
  it('без сессии — отказ', async () => {
    session.role = null;
    expect(await issueSelfieReviewAction('d1')).toEqual({ ok: false, reason: 'unauthorized' });
  });
});

describe('снимки селфи в админке: просмотр', () => {
  for (const role of ['admin', 'operator'] as const) {
    it(`${role} — все снимки и фото документа рядом, оба просмотра в журнале`, async () => {
      session.role = role;
      const r = await issueSelfieReviewAction('d1');
      expect(r).toEqual({
        ok: true,
        frames: [0, 1, 2].map((i) => ({ index: i, url: `https://signed.example/kyc/t/u1/selfie_liveness/f${i}` })),
        identity: {
          id: 'id-doc',
          url: 'https://signed.example/kyc/t/u1/identity/p',
          contentType: 'image/jpeg',
          submittedAt: '2026-11-20T10:00:00.000Z',
        },
      });
      expect(journal).toHaveBeenCalledTimes(2);
      expect(journal.mock.calls[0]![0]).toMatchObject({
        action: 'client.document.viewed',
        subjectId: 'u1',
        payload: { docId: 'd1', kind: 'selfie_liveness', frames: 3 },
      });
      expect(journal.mock.calls[1]![0]).toMatchObject({ payload: { docId: 'id-doc', kind: 'identity', comparedWith: 'd1' } });
    });
  }

  it('документа личности нет — снимки всё равно видны, identity = null', async () => {
    answer({ identity: false });
    const r = await issueSelfieReviewAction('d1');
    expect(r.ok && r.identity).toBeNull();
    expect(journal).toHaveBeenCalledOnce();
  });

  it('не селфи или селфи без снимков (старый файл) — notFound', async () => {
    answer({ kind: 'identity' });
    expect(await issueSelfieReviewAction('d1')).toEqual({ ok: false, reason: 'notFound' });
    answer({ frames: 0 });
    expect(await issueSelfieReviewAction('d1')).toEqual({ ok: false, reason: 'notFound' });
    expect(issueViewUrl).not.toHaveBeenCalled();
  });

  it('хранилище недоступно — unavailable, просмотр не журналируется', async () => {
    issueViewUrl.mockRejectedValueOnce(new Error('down'));
    expect(await issueSelfieReviewAction('d1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(journal).not.toHaveBeenCalled();
  });
});

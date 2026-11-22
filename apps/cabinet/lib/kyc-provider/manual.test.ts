import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, seedUser, type TestDb } from '@broker/support/testing';
import { LIVENESS_SUBMIT_GRACE_MS, LIVENESS_TTL_MS } from './liveness';
import { createManualKycProvider } from './manual';
import type { LivenessChallenge, LivenessFrame } from './types';

let db: TestDb;
let clock: Date;
let puts: { key: string; contentType: string }[];
let failPut: boolean;

const provider = () =>
  createManualKycProvider({
    db,
    maxTotalBytes: 10 * 1024 * 1024,
    now: () => clock,
    objectKey: (userId, uuid) => `kyc/test/${userId}/selfie_liveness/${uuid}`,
    put: async (input) => {
      if (failPut) throw new Error('хранилище недоступно');
      puts.push({ key: input.key, contentType: input.contentType });
    },
  });

const jpeg = (): Uint8Array => {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

const frames = (c: LivenessChallenge): LivenessFrame[] =>
  c.tasks.map((_, i) => ({ bytes: jpeg(), contentType: 'image/jpeg', elapsedMs: 2000 + i * 3000 }));

const later = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeEach(async () => {
  db = await createTestDb();
  clock = new Date('2026-11-22T10:00:00Z');
  puts = [];
  failPut = false;
});

afterEach(async () => {
  await db.close();
});

describe('ручной провайдер: выдача задания', () => {
  it('задание пишется в базу с кодом, сроком и провайдером manual', async () => {
    const user = await seedUser(db);
    const c = await provider().issueLivenessChallenge(user);
    expect(c.provider).toBe('manual');
    expect(c.code).toMatch(/^\d{4}$/);
    expect(c.tasks[0]).toEqual({ kind: 'face_front' });
    expect(c.expiresAt.getTime() - c.issuedAt.getTime()).toBe(LIVENESS_TTL_MS);

    const row = (await db.query(`SELECT * FROM kyc_liveness_challenges WHERE id = $1`, [c.id])).rows[0]!;
    expect(row.user_id).toBe(user);
    expect(row.provider).toBe('manual');
    expect(row.code).toBe(c.code);
    expect(row.used_at).toBeNull();
    expect(row.tasks).toEqual(c.tasks);
  });
});

describe('ручной провайдер: приём снимков', () => {
  it('снимки по заданию — один документ selfie_liveness, кадры, user-agent, заявка на проверке', async () => {
    const user = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(user);
    later(15_000);
    const out = await p.acceptLivenessCapture(user, {
      challengeId: c.id,
      code: c.code,
      frames: frames(c),
      userAgent: 'Mozilla/5.0 (iPhone)',
    });
    expect(out).toMatchObject({ ok: true, review: 'operator' });
    if (!out.ok) return;

    const docs = (await db.query(`SELECT * FROM kyc_documents WHERE user_id = $1`, [user])).rows;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: out.documentId, doc_kind: 'selfie_liveness', content_type: 'image/jpeg' });

    const stored = (
      await db.query(`SELECT * FROM kyc_document_frames WHERE document_id = $1 ORDER BY frame_index`, [out.documentId])
    ).rows;
    expect(stored.map((f) => f.frame_index)).toEqual([0, 1, 2]);
    expect(docs[0]!.storage_key).toBe(stored[0]!.storage_key);
    expect(puts.map((x) => x.key)).toEqual(stored.map((f) => f.storage_key));
    expect(puts.every((x) => x.key.startsWith(`kyc/test/${user}/selfie_liveness/`))).toBe(true);
    expect(new Date(stored[1]!.captured_at as string).getTime() - c.issuedAt.getTime()).toBe(5000);

    const ch = (await db.query(`SELECT * FROM kyc_liveness_challenges WHERE id = $1`, [c.id])).rows[0]!;
    expect(ch.document_id).toBe(out.documentId);
    expect(ch.user_agent).toBe('Mozilla/5.0 (iPhone)');
    expect(ch.used_at).not.toBeNull();

    const state = (await db.query(`SELECT state FROM client_verification WHERE user_id = $1`, [user])).rows[0];
    expect(state?.state).toBe('pending');
  });

  it('задание одноразовое: повторная подача — used', async () => {
    const user = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(user);
    const capture = { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null };
    expect((await p.acceptLivenessCapture(user, capture)).ok).toBe(true);
    expect(await p.acceptLivenessCapture(user, capture)).toEqual({ ok: false, reason: 'used' });
    expect((await db.query(`SELECT 1 FROM kyc_documents WHERE user_id = $1`, [user])).rows).toHaveLength(1);
  });

  it('истёкшее задание — expired, ничего не пишется', async () => {
    const user = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(user);
    later(LIVENESS_TTL_MS + LIVENESS_SUBMIT_GRACE_MS + 1);
    expect(await p.acceptLivenessCapture(user, { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(puts).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM kyc_documents`)).rows).toHaveLength(0);
  });

  it('в пределах запаса на отправку — принимается', async () => {
    const user = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(user);
    later(LIVENESS_TTL_MS + LIVENESS_SUBMIT_GRACE_MS - 1000);
    expect((await p.acceptLivenessCapture(user, { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null })).ok).toBe(true);
  });

  it('чужое задание — notFound; неверный код — invalidCode; не те снимки — invalidFrames', async () => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(owner);
    expect(await p.acceptLivenessCapture(other, { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null })).toEqual({
      ok: false,
      reason: 'notFound',
    });
    expect(await p.acceptLivenessCapture(owner, { challengeId: 'не-uuid', code: c.code, frames: frames(c), userAgent: null })).toEqual({
      ok: false,
      reason: 'notFound',
    });
    const wrong = c.code === '1234' ? '4321' : '1234';
    expect(await p.acceptLivenessCapture(owner, { challengeId: c.id, code: wrong, frames: frames(c), userAgent: null })).toEqual({
      ok: false,
      reason: 'invalidCode',
    });
    const png = frames(c).map((f) => ({ ...f, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]) }));
    expect(await p.acceptLivenessCapture(owner, { challengeId: c.id, code: c.code, frames: png, userAgent: null })).toEqual({
      ok: false,
      reason: 'invalidFrames',
    });
    expect(await p.acceptLivenessCapture(owner, { challengeId: c.id, code: c.code, frames: frames(c).slice(1), userAgent: null })).toEqual({
      ok: false,
      reason: 'invalidFrames',
    });
    expect(puts).toHaveLength(0);
    expect((await p.acceptLivenessCapture(owner, { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null })).ok).toBe(true);
  });

  it('сбой хранилища — откат: ни документа, ни отметки об использовании', async () => {
    const user = await seedUser(db);
    const p = provider();
    const c = await p.issueLivenessChallenge(user);
    failPut = true;
    await expect(
      p.acceptLivenessCapture(user, { challengeId: c.id, code: c.code, frames: frames(c), userAgent: null }),
    ).rejects.toThrow('хранилище недоступно');
    expect((await db.query(`SELECT 1 FROM kyc_documents`)).rows).toHaveLength(0);
    const ch = (await db.query(`SELECT used_at FROM kyc_liveness_challenges WHERE id = $1`, [c.id])).rows[0]!;
    expect(ch.used_at).toBeNull();
  });
});

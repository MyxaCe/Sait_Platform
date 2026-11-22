import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, seedUser, type TestDb } from '@broker/support/testing';
import { getClientVerificationCard } from './queries';
import { livenessTaskLabel, toSelfieCaptureView } from './selfie-view';

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

const ISSUED = '2026-11-22T10:00:00Z';

async function seedSelfie(user: string): Promise<string> {
  await db.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'pending')`, [user]);
  await db.query(
    `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type, submitted_at)
     VALUES (gen_random_uuid(), $1, 'identity', 'kyc/t/u/identity/p', 'image/jpeg', '2026-11-22T09:00:00Z')`,
    [user],
  );
  const doc = (
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_kind, storage_key, content_type, submitted_at)
       VALUES ($1, 'selfie_liveness', 'kyc/t/u/selfie_liveness/f0', 'image/jpeg', '2026-11-22T10:01:00Z') RETURNING id`,
      [user],
    )
  ).rows[0]!.id as string;
  for (const [i, sec] of [[0, 4], [1, 11], [2, 19]] as const) {
    await db.query(
      `INSERT INTO kyc_document_frames (document_id, frame_index, storage_key, content_type, captured_at)
       VALUES ($1, $2, $3, 'image/jpeg', $4)`,
      [doc, i, `kyc/t/u/selfie_liveness/f${i}`, new Date(Date.parse(ISSUED) + sec * 1000)],
    );
  }
  await db.query(
    `INSERT INTO kyc_liveness_challenges (user_id, code, tasks, issued_at, expires_at, used_at, document_id, user_agent)
     VALUES ($1, '4821', $2::jsonb, $3, $4, '2026-11-22T10:00:30Z', $5, 'Mozilla/5.0 (Android)')`,
    [
      user,
      JSON.stringify([{ kind: 'face_front' }, { kind: 'show_fingers', count: 3 }, { kind: 'turn_left' }]),
      ISSUED,
      '2026-11-22T10:02:00Z',
      doc,
    ],
  );
  return doc;
}

describe('карточка KYC: селфи с камеры', () => {
  it('у селфи видны задание, код, время, браузер и все снимки; у документа личности — нет', async () => {
    const user = await seedUser(db);
    const doc = await seedSelfie(user);
    const card = await getClientVerificationCard(user, db);
    const selfie = card!.documents.find((d) => d.id === doc)!;
    expect(selfie.capture).toMatchObject({
      provider: 'manual',
      code: '4821',
      tasks: [{ kind: 'face_front' }, { kind: 'show_fingers', count: 3 }, { kind: 'turn_left' }],
      issuedAt: '2026-11-22T10:00:00.000Z',
      expiresAt: '2026-11-22T10:02:00.000Z',
      usedAt: '2026-11-22T10:00:30.000Z',
      userAgent: 'Mozilla/5.0 (Android)',
    });
    expect(selfie.capture!.frames.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(card!.documents.find((d) => d.kind === 'identity')!.capture).toBeNull();

    const view = toSelfieCaptureView(selfie.capture!);
    expect(view.provider).toBe('ручная проверка оператором');
    expect(view.tasks).toEqual(['Лицо прямо в камеру', 'Поднять пальцев: 3', 'Поворот головы влево (для клиента)']);
    expect(view.frames.map((f) => f.offsetText)).toEqual(['+4 с', '+11 с', '+19 с']);
  });

  it('селфи файлом (до камеры) — capture = null, карточка не падает', async () => {
    const user = await seedUser(db);
    await db.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'pending')`, [user]);
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_kind, storage_key, content_type) VALUES ($1, 'selfie_liveness', 'k', 'video/mp4')`,
      [user],
    );
    const card = await getClientVerificationCard(user, db);
    expect(card!.documents[0]!.capture).toBeNull();
  });

  it('схема: задание без документа не может быть отмечено использованным', async () => {
    const user = await seedUser(db);
    await expect(
      db.query(
        `INSERT INTO kyc_liveness_challenges (user_id, code, tasks, issued_at, expires_at, used_at)
         VALUES ($1, '1234', '[]'::jsonb, now(), now() + interval '2 minutes', now())`,
        [user],
      ),
    ).rejects.toThrow();
  });

  it('подписи заданий', () => {
    expect(livenessTaskLabel({ kind: 'hold_document' })).toBe('Документ рядом с лицом');
    expect(livenessTaskLabel(undefined)).toBe('Задание не распознано');
  });
});

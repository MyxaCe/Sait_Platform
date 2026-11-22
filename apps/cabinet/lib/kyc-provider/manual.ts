import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import type { PoolLike } from '@broker/money';
import {
  LIVENESS_SUBMIT_GRACE_MS,
  LIVENESS_TTL_MS,
  framesFit,
  makeLivenessCode,
  parseLivenessTasks,
  pickLivenessTasks,
  type RandomInt,
} from './liveness';
import type { KycProvider, LivenessCapture, LivenessOutcome, LivenessRejection } from './types';

export interface ManualProviderDeps {
  db: PoolLike;
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  objectKey(userId: string, uuid: string): string;
  maxTotalBytes: number;
  now?: () => Date;
  randomInt?: RandomInt;
  uuid?: () => string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UA_MAX = 512;

export function createManualKycProvider(deps: ManualProviderDeps): KycProvider {
  const now = deps.now ?? (() => new Date());
  const rand = deps.randomInt ?? ((max: number) => cryptoRandomInt(max));
  const uuid = deps.uuid ?? randomUUID;

  return {
    id: 'manual',
    review: 'operator',

    async issueLivenessChallenge(userId) {
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + LIVENESS_TTL_MS);
      const tasks = pickLivenessTasks(rand);
      const code = makeLivenessCode(rand);
      const id = uuid();
      await deps.db.query(
        `INSERT INTO kyc_liveness_challenges (id, user_id, provider, code, tasks, issued_at, expires_at)
         VALUES ($1, $2, 'manual', $3, $4::jsonb, $5, $6)`,
        [id, userId, code, JSON.stringify(tasks), issuedAt, expiresAt],
      );
      return { id, provider: 'manual', code, tasks, issuedAt, expiresAt, ttlMs: LIVENESS_TTL_MS };
    },

    async acceptLivenessCapture(userId, capture: LivenessCapture): Promise<LivenessOutcome> {
      if (!UUID_RE.test(capture.challengeId)) return { ok: false, reason: 'notFound' };

      const client = await deps.db.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query(
          `SELECT code, tasks, issued_at, expires_at, used_at
             FROM kyc_liveness_challenges WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [capture.challengeId, userId],
        );
        const row = found.rows[0];
        const tasks = row ? parseLivenessTasks(row.tasks) : null;
        let reason: LivenessRejection | null = null;
        if (!row) reason = 'notFound';
        else if (row.used_at) reason = 'used';
        else if (now().getTime() > new Date(row.expires_at as string).getTime() + LIVENESS_SUBMIT_GRACE_MS) reason = 'expired';
        else if (row.code !== capture.code.trim()) reason = 'invalidCode';
        else if (!tasks || !framesFit(capture.frames, tasks, deps.maxTotalBytes)) reason = 'invalidFrames';
        if (reason || !row) {
          await client.query('ROLLBACK');
          return { ok: false, reason: reason ?? 'notFound' };
        }

        const issuedMs = new Date(row.issued_at as string).getTime();
        const documentId = uuid();
        const keys = capture.frames.map(() => deps.objectKey(userId, uuid()));
        for (const [i, frame] of capture.frames.entries()) {
          await deps.put({ key: keys[i]!, body: frame.bytes, contentType: frame.contentType });
        }

        await client.query(
          `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type)
           VALUES ($1, $2, 'selfie_liveness', $3, 'image/jpeg')`,
          [documentId, userId, keys[0]],
        );
        for (const [i, frame] of capture.frames.entries()) {
          await client.query(
            `INSERT INTO kyc_document_frames (document_id, frame_index, storage_key, content_type, captured_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [documentId, i, keys[i], frame.contentType, new Date(issuedMs + Math.round(frame.elapsedMs))],
          );
        }
        await client.query(
          `UPDATE kyc_liveness_challenges SET used_at = $2, document_id = $3, user_agent = $4 WHERE id = $1`,
          [capture.challengeId, now(), documentId, capture.userAgent?.slice(0, UA_MAX) ?? null],
        );
        await client.query(
          `INSERT INTO client_verification (user_id, state, updated_at)
           VALUES ($1, 'pending', now())
           ON CONFLICT (user_id) DO UPDATE SET state = 'pending', updated_at = now()`,
          [userId],
        );
        await client.query('COMMIT');
        return { ok: true, documentId, review: 'operator' };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

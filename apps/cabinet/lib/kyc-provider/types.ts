export const LIVENESS_TASK_KINDS = ['face_front', 'turn_left', 'turn_right', 'show_fingers', 'hold_document'] as const;

export type LivenessTaskKind = (typeof LIVENESS_TASK_KINDS)[number];

export interface LivenessTask {
  kind: LivenessTaskKind;
  count?: number;
}

export interface LivenessChallenge {
  id: string;
  provider: string;
  code: string;
  tasks: LivenessTask[];
  issuedAt: Date;
  expiresAt: Date;
  ttlMs: number;
}

export interface LivenessFrame {
  bytes: Uint8Array;
  contentType: string;
  elapsedMs: number;
}

export interface LivenessCapture {
  challengeId: string;
  code: string;
  frames: LivenessFrame[];
  userAgent: string | null;
}

export type LivenessRejection = 'notFound' | 'used' | 'expired' | 'invalidCode' | 'invalidFrames';

export type KycReviewMode = 'operator' | 'provider';

export type LivenessOutcome =
  | { ok: true; documentId: string; review: KycReviewMode }
  | { ok: false; reason: LivenessRejection };

export interface KycProvider {
  readonly id: string;
  readonly review: KycReviewMode;
  issueLivenessChallenge(userId: string): Promise<LivenessChallenge>;
  acceptLivenessCapture(userId: string, capture: LivenessCapture): Promise<LivenessOutcome>;
}

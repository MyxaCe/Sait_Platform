import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  state: 'unverified' as string | null,
  put: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] })),
  issue: vi.fn(async () => ({
    id: 'c1',
    provider: 'manual',
    code: '4821',
    tasks: [{ kind: 'face_front' }],
    issuedAt: new Date(),
    expiresAt: new Date(),
    ttlMs: 120_000,
  })),
  accept: vi.fn(async (): Promise<unknown> => ({ ok: true, documentId: 'd1', review: 'operator' })),
}));

vi.mock('./auth/session', () => ({ getSessionUser: async () => env.user }));
vi.mock('./db', () => ({
  getPool: () => ({ query: env.query, connect: async () => ({ query: env.query, release: () => {} }) }),
}));
vi.mock('./kyc', () => ({ getVerificationState: async () => env.state }));
vi.mock('./kyc-provider', () => ({
  getKycProvider: () => ({ id: 'manual', review: 'operator', issueLivenessChallenge: env.issue, acceptLivenessCapture: env.accept }),
}));
vi.mock('@broker/storage', () => ({
  putObject: env.put,
  buildKycObjectKey: ({ client, docKind, uuid }: { client: string; docKind: string; uuid: string }) =>
    `t/${client}/${docKind}/${uuid}`,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ headers: () => new Headers({ 'user-agent': 'TestAgent/1.0' }) }));

const jpegFile = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], name, { type: 'image/jpeg' });

beforeEach(async () => {
  process.env.SITE_SLUG = 'demo';
  env.user = { id: 'user-1' };
  env.state = 'unverified';
  env.put.mockClear();
  env.query.mockClear();
  env.issue.mockClear();
  env.accept.mockClear();
  const { __resetRateLimit } = await import('./rate-limit');
  __resetRateLimit();
});

describe('селфи нельзя подать файлом', () => {
  it('submitKycDocumentAction с видом selfie_liveness — selfieCameraOnly, хранилище и база не тронуты', async () => {
    const { submitKycDocumentAction } = await import('./kyc-actions');
    const fd = new FormData();
    fd.set('kind', 'selfie_liveness');
    fd.set('file', jpegFile('selfie.jpg'));
    expect(await submitKycDocumentAction({}, fd)).toEqual({ error: 'selfieCameraOnly' });
    expect(env.put).not.toHaveBeenCalled();
    expect(env.query).not.toHaveBeenCalled();
  });

  it('документ личности файлом по-прежнему принимается', async () => {
    const { submitKycDocumentAction } = await import('./kyc-actions');
    const fd = new FormData();
    fd.set('kind', 'identity');
    fd.set('file', jpegFile('id.jpg'));
    expect(await submitKycDocumentAction({}, fd)).toEqual({ ok: true });
    expect(env.put).toHaveBeenCalledOnce();
  });
});

describe('выдача задания', () => {
  it('без сессии — unauthorized, задание не выдаётся', async () => {
    env.user = null;
    const { startSelfieChallengeAction } = await import('./kyc-liveness-actions');
    expect(await startSelfieChallengeAction()).toEqual({ ok: false, error: 'unauthorized' });
    expect(env.issue).not.toHaveBeenCalled();
  });

  it('уже верифицирован — задание не выдаётся', async () => {
    env.state = 'verified';
    const { startSelfieChallengeAction } = await import('./kyc-liveness-actions');
    expect(await startSelfieChallengeAction()).toEqual({ ok: false, error: 'alreadyVerified' });
  });

  it('клиенту уходят id, код, задания и срок — без серверного времени', async () => {
    const { startSelfieChallengeAction } = await import('./kyc-liveness-actions');
    expect(await startSelfieChallengeAction()).toEqual({
      ok: true,
      challenge: { id: 'c1', code: '4821', tasks: [{ kind: 'face_front' }], ttlMs: 120_000 },
    });
    expect(env.issue).toHaveBeenCalledWith('user-1');
  });

  it('частые запросы задания — rateLimited', async () => {
    const { startSelfieChallengeAction } = await import('./kyc-liveness-actions');
    for (let i = 0; i < 6; i++) expect((await startSelfieChallengeAction()).ok).toBe(true);
    expect(await startSelfieChallengeAction()).toEqual({ ok: false, error: 'rateLimited' });
  });
});

describe('приём снимков', () => {
  const capture = () => {
    const fd = new FormData();
    fd.set('challengeId', 'c1');
    fd.set('code', '4821');
    for (let i = 0; i < 3; i++) {
      fd.append('frame', jpegFile(`f${i}.jpg`));
      fd.append('elapsed', String(1000 * (i + 1)));
    }
    return fd;
  };

  it('кадры, время и user-agent из заголовка уходят провайдеру', async () => {
    const { submitSelfieCaptureAction } = await import('./kyc-liveness-actions');
    expect(await submitSelfieCaptureAction(capture())).toEqual({ ok: true });
    const [userId, sent] = env.accept.mock.calls[0] as unknown as [string, { frames: { elapsedMs: number; contentType: string }[]; userAgent: string; code: string }];
    expect(userId).toBe('user-1');
    expect(sent.code).toBe('4821');
    expect(sent.userAgent).toBe('TestAgent/1.0');
    expect(sent.frames.map((f) => f.elapsedMs)).toEqual([1000, 2000, 3000]);
    expect(sent.frames.every((f) => f.contentType === 'image/jpeg')).toBe(true);
  });

  it('истёкшее или использованное задание — selfieExpired; негодные снимки — selfieInvalid', async () => {
    const { submitSelfieCaptureAction } = await import('./kyc-liveness-actions');
    env.accept.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    expect(await submitSelfieCaptureAction(capture())).toEqual({ error: 'selfieExpired' });
    env.accept.mockResolvedValueOnce({ ok: false, reason: 'used' });
    expect(await submitSelfieCaptureAction(capture())).toEqual({ error: 'selfieExpired' });
    env.accept.mockResolvedValueOnce({ ok: false, reason: 'invalidFrames' });
    expect(await submitSelfieCaptureAction(capture())).toEqual({ error: 'selfieInvalid' });
  });

  it('без кадров или с рассинхроном кадров и времени — selfieInvalid без вызова провайдера', async () => {
    const { submitSelfieCaptureAction } = await import('./kyc-liveness-actions');
    const empty = new FormData();
    empty.set('challengeId', 'c1');
    expect(await submitSelfieCaptureAction(empty)).toEqual({ error: 'selfieInvalid' });
    const skew = capture();
    skew.append('elapsed', '4000');
    expect(await submitSelfieCaptureAction(skew)).toEqual({ error: 'selfieInvalid' });
    expect(env.accept).not.toHaveBeenCalled();
  });

  it('без сессии — unauthorized', async () => {
    env.user = null;
    const { submitSelfieCaptureAction } = await import('./kyc-liveness-actions');
    expect(await submitSelfieCaptureAction(capture())).toEqual({ error: 'unauthorized' });
    expect(env.accept).not.toHaveBeenCalled();
  });
});

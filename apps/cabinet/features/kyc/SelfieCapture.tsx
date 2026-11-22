'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@broker/ui';
import {
  startSelfieChallengeAction,
  submitSelfieCaptureAction,
  type SelfieChallengeView,
} from '@/lib/kyc-liveness-actions';
import type { LivenessTask } from '@/lib/kyc-provider/types';
import { FormMessage } from '@/features/auth/FormMessage';

type Unavailable = 'unsupported' | 'denied' | 'nocamera' | 'error';

interface Shot {
  blob: Blob;
  url: string;
  elapsedMs: number;
}

type Phase =
  | { name: 'intro' }
  | { name: 'starting' }
  | { name: 'unavailable'; reason: Unavailable }
  | { name: 'capture'; challenge: SelfieChallengeView; shots: Shot[] }
  | { name: 'review'; challenge: SelfieChallengeView; shots: Shot[] }
  | { name: 'expired' }
  | { name: 'done' };

const MAX_SIDE = 1280;

export function cameraUnavailableReason(error: unknown): Unavailable {
  const name = error instanceof Error || (typeof error === 'object' && error !== null) ? (error as { name?: string }).name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'nocamera';
  return 'error';
}

function canUseCamera(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false && !!navigator.mediaDevices?.getUserMedia;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function SelfieCapture() {
  const t = useTranslations('kyc.selfie');
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(0);
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [left, setLeft] = useState(0);

  const release = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  const active = phase.name === 'capture' || phase.name === 'review' ? phase.challenge : null;

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const rest = active.ttlMs - (performance.now() - startedRef.current);
      setLeft(Math.max(0, Math.ceil(rest / 1000)));
      if (rest <= 0) {
        release();
        setPhase({ name: 'expired' });
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [active, release]);

  useEffect(() => {
    if (phase.name === 'capture' && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  async function start() {
    setError(undefined);
    if (!canUseCamera()) {
      setPhase({ name: 'unavailable', reason: 'unsupported' });
      return;
    }
    setPhase({ name: 'starting' });
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      setPhase({ name: 'unavailable', reason: cameraUnavailableReason(e) });
      return;
    }
    const issued = await startSelfieChallengeAction().catch(() => null);
    if (!issued || !issued.ok) {
      release();
      setError(issued?.error === 'alreadyVerified' ? 'invalidRequest' : (issued?.error ?? 'invalidRequest'));
      setPhase({ name: 'intro' });
      return;
    }
    startedRef.current = performance.now();
    setPhase({ name: 'capture', challenge: issued.challenge, shots: [] });
  }

  function snap() {
    if (phase.name !== 'capture') return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { challenge, shots } = phase;
    const elapsedMs = Math.round(performance.now() - startedRef.current);
    const band = Math.max(24, Math.round(canvas.height / 24));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, canvas.height - band, canvas.width, band);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(band * 0.6)}px sans-serif`;
    ctx.fillText(
      `${challenge.code} · ${shots.length + 1}/${challenge.tasks.length} · ${new Date().toISOString().slice(0, 19)}Z`,
      8,
      canvas.height - Math.round(band * 0.3),
    );
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const next = [...shots, { blob, url: URL.createObjectURL(blob), elapsedMs }];
        if (next.length >= challenge.tasks.length) {
          release();
          setPhase({ name: 'review', challenge, shots: next });
        } else {
          setPhase({ name: 'capture', challenge, shots: next });
        }
      },
      'image/jpeg',
      0.85,
    );
  }

  async function send() {
    if (phase.name !== 'review') return;
    setSending(true);
    setError(undefined);
    const fd = new FormData();
    fd.set('challengeId', phase.challenge.id);
    fd.set('code', phase.challenge.code);
    phase.shots.forEach((shot, i) => {
      fd.append('frame', new File([shot.blob], `frame-${i + 1}.jpg`, { type: 'image/jpeg' }));
      fd.append('elapsed', String(shot.elapsedMs));
    });
    const result = await submitSelfieCaptureAction(fd).catch(() => ({ error: 'invalidRequest' }) as const);
    setSending(false);
    if ('ok' in result && result.ok) {
      phase.shots.forEach((s) => URL.revokeObjectURL(s.url));
      setPhase({ name: 'done' });
      router.refresh();
      return;
    }
    if (result.error === 'selfieExpired') {
      setPhase({ name: 'expired' });
      return;
    }
    setError(result.error);
  }

  const taskText = (task: LivenessTask) =>
    task.kind === 'show_fingers' ? t('tasks.show_fingers', { count: task.count ?? 1 }) : t(`tasks.${task.kind}` as never);

  return (
    <div className="space-y-4" data-testid="selfie-capture">
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-secondary">{t('cameraOnly')}</p>
      <FormMessage error={error} />

      {phase.name === 'intro' || phase.name === 'starting' ? (
        <div className="space-y-3">
          <p className="text-sm text-secondary">{t('intro')}</p>
          <Button type="button" onClick={start} loading={phase.name === 'starting'}>
            {t('start')}
          </Button>
        </div>
      ) : null}

      {phase.name === 'unavailable' ? <CameraUnavailable reason={phase.reason} onRetry={start} /> : null}

      {phase.name === 'capture' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {t('stepOf', { current: phase.shots.length + 1, total: phase.challenge.tasks.length })}
            </span>
            <span className="tabular-nums text-secondary" aria-live="polite">
              {t('timeLeft', { seconds: left })}
            </span>
          </div>
          <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-[15px] font-medium" data-testid="selfie-task">
            {taskText(phase.challenge.tasks[phase.shots.length]!)}
          </p>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label={t('preview')}
              className="aspect-[3/4] w-full -scale-x-100 object-cover sm:aspect-video"
            />
            <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-semibold tabular-nums text-white">
              {t('code', { code: phase.challenge.code })}
            </span>
          </div>
          <p className="text-xs text-secondary">{t('codeHint')}</p>
          <Button type="button" onClick={snap}>
            {t('capture')}
          </Button>
        </div>
      ) : null}

      {phase.name === 'review' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{t('review')}</span>
            <span className="tabular-nums text-secondary">{t('timeLeft', { seconds: left })}</span>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {phase.shots.map((shot, i) => (
              <li key={shot.url} className="space-y-1">
                <img src={shot.url} alt={taskText(phase.challenge.tasks[i]!)} className="aspect-[3/4] w-full rounded-lg object-cover" />
                <p className="text-[11px] leading-tight text-secondary">{taskText(phase.challenge.tasks[i]!)}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={send} loading={sending}>
              {sending ? t('sending') : t('send')}
            </Button>
            <Button type="button" variant="secondary" disabled={sending} onClick={start}>
              {t('retake')}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.name === 'expired' ? (
        <div className="space-y-3">
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            {t('expired')}
          </p>
          <Button type="button" onClick={start}>
            {t('restart')}
          </Button>
        </div>
      ) : null}

      {phase.name === 'done' ? (
        <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">{t('done')}</p>
      ) : null}
    </div>
  );
}

function CameraUnavailable({ reason, onRetry }: { reason: Unavailable; onRetry: () => void }) {
  const t = useTranslations('kyc.selfie');
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `${window.location.origin}${window.location.pathname}?tab=verification&step=selfie_liveness`;
    import('qrcode')
      .then((m) => m.default.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))
      .then((svg) => alive && setQr(svg))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-3" data-testid="camera-unavailable">
      <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        {t(`unavailable.${reason}` as never)}
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {qr ? (
          <div
            role="img"
            aria-label={t('qrAlt')}
            className="size-36 shrink-0 rounded-lg bg-white p-2"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        ) : null}
        <p className="text-sm text-secondary">{t('phoneHint')}</p>
      </div>
      <Button type="button" variant="secondary" onClick={onRetry}>
        {t('tryAgain')}
      </Button>
    </div>
  );
}

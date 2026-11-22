'use client';

import { useState, useTransition } from 'react';
import { Button, Callout, ToneBadge, cn } from '@broker/ui';
import { issueDocumentViewUrlAction, issueSelfieReviewAction, type SelfieReviewIdentity } from '@/lib/kyc/documents';
import type { SelfieCaptureView } from '@/lib/kyc/selfie-view';
import { SelfieComparison } from './SelfieComparison';

export interface ReviewDocument {
  id: string;
  label: string;
  contentType: string | null;
  submittedAt: string;
  submittedText: string;
  flag?: string | null;
  capture?: SelfieCaptureView | null;
}

const MESSAGES: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  notFound: 'Документ не найден.',
  unavailable:
    'Хранилище документов недоступно — ссылка не выдана, просмотр не записан в журнал. Метаданные документа видны слева.',
};

type View =
  | { state: 'idle' }
  | { state: 'loading'; id: string }
  | { state: 'ok'; id: string; url: string }
  | { state: 'selfie'; id: string; frames: { index: number; url: string }[]; identity: SelfieReviewIdentity | null }
  | { state: 'error'; id: string; message: string };

function kindOf(contentType: string | null): 'image' | 'pdf' | 'video' | 'other' {
  if (!contentType) return 'other';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('video/')) return 'video';
  return 'other';
}

const TYPE_LABEL: Record<ReturnType<typeof kindOf>, string> = {
  image: 'изображение',
  pdf: 'PDF',
  video: 'видео',
  other: 'файл',
};

function FileGlyph({ kind }: { kind: ReturnType<typeof kindOf> }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-sunken text-[10px] font-semibold uppercase text-secondary"
    >
      {kind === 'image' ? 'IMG' : kind === 'pdf' ? 'PDF' : kind === 'video' ? 'VID' : 'FILE'}
    </span>
  );
}

export function DocumentReview({ documents }: { documents: ReviewDocument[] }) {
  const [view, setView] = useState<View>({ state: 'idle' });
  const [, startTransition] = useTransition();

  function open(id: string) {
    setView({ state: 'loading', id });
    if (documents.find((d) => d.id === id)?.capture) {
      startTransition(async () => {
        const result = await issueSelfieReviewAction(id);
        setView(
          result.ok
            ? { state: 'selfie', id, frames: result.frames, identity: result.identity }
            : { state: 'error', id, message: MESSAGES[result.reason] ?? 'Не удалось открыть снимки.' },
        );
      });
      return;
    }
    startTransition(async () => {
      const result = await issueDocumentViewUrlAction(id);
      setView(
        result.ok
          ? { state: 'ok', id, url: result.url }
          : { state: 'error', id, message: MESSAGES[result.reason] ?? 'Не удалось открыть документ.' },
      );
    });
  }

  const current = view.state === 'idle' ? null : documents.find((d) => d.id === view.id) ?? null;

  return (
    <div className="grid min-h-[22rem] lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <ul className="divide-y divide-border border-border lg:border-r" aria-label="Поданные документы">
        {documents.map((d) => {
          const k = kindOf(d.contentType);
          const active = view.state !== 'idle' && view.id === d.id;
          return (
            <li key={d.id} className={cn('flex items-start gap-3 px-4 py-3', active && 'bg-accent/[0.08]')}>
              <FileGlyph kind={k} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-primary">{d.label}</p>
                <p className="text-xs text-muted tabular-nums">
                  {d.capture ? `снимки с камеры: ${d.capture.frames.length}` : TYPE_LABEL[k]} · подан {d.submittedText}
                </p>
                {d.flag ? <ToneBadge tone="warning">{d.flag}</ToneBadge> : null}
                <div className="pt-1">
                  <Button
                    type="button"
                    variant={active ? 'primary' : 'secondary'}
                    size="xs"
                    loading={view.state === 'loading' && view.id === d.id}
                    onClick={() => open(d.id)}
                  >
                    {active && (view.state === 'ok' || view.state === 'selfie') ? 'Открыт' : 'Просмотреть'}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex min-h-[22rem] flex-col border-t border-border bg-sunken/60 lg:border-t-0">
        {view.state === 'idle' || !current ? (
          <div className="m-auto max-w-sm px-6 py-10 text-center">
            <p className="text-sm font-medium text-primary">Выберите документ для просмотра</p>
            <p className="mt-1 text-xs text-muted">
              Документ откроется здесь, рядом с решением. Каждый просмотр записывается в журнал
              (кто и когда открыл), ссылка действует несколько минут.
            </p>
          </div>
        ) : (
          <>
            <div className="flex min-h-[44px] items-center justify-between gap-3 border-b border-border px-4 py-2">
              <p className="min-w-0 truncate text-[13px] text-primary">
                <span className="font-medium">{current.label}</span>
                <span className="text-muted"> · {current.contentType ?? 'тип не указан'}</span>
              </p>
              {view.state === 'ok' ? (
                <a
                  href={view.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[13px] font-medium text-accent hover:underline"
                >
                  В новой вкладке ↗
                </a>
              ) : null}
            </div>
            <div className="flex flex-1 items-center justify-center p-4">
              {view.state === 'loading' ? (
                <p className="text-sm text-muted">Запрашиваю ссылку и записываю просмотр в журнал…</p>
              ) : view.state === 'error' ? (
                <Callout tone="negative" className="w-full">
                  {view.message}
                </Callout>
              ) : view.state === 'selfie' && current.capture ? (
                <SelfieComparison capture={current.capture} frames={view.frames} identity={view.identity} />
              ) : view.state === 'ok' ? (
                kindOf(current.contentType) === 'image' ? (
                  <img src={view.url} alt={current.label} className="max-h-[36rem] max-w-full rounded-md object-contain" />
                ) : kindOf(current.contentType) === 'pdf' ? (
                  <iframe src={view.url} title={current.label} className="h-[36rem] w-full rounded-md bg-card" />
                ) : kindOf(current.contentType) === 'video' ? (
                  <video src={view.url} controls className="max-h-[36rem] max-w-full rounded-md" />
                ) : (
                  <p className="text-sm text-secondary">
                    Этот тип файла не показывается встроенно — откройте его в новой вкладке.
                  </p>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

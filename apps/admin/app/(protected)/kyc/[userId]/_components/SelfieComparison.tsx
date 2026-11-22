import { Callout } from '@broker/ui';
import type { SelfieReviewIdentity } from '@/lib/kyc/documents';
import type { SelfieCaptureView } from '@/lib/kyc/selfie-view';

export function SelfieComparison({
  capture,
  frames,
  identity,
}: {
  capture: SelfieCaptureView;
  frames: { index: number; url: string }[];
  identity: SelfieReviewIdentity | null;
}) {
  const byIndex = new Map(frames.map((f) => [f.index, f.url]));
  return (
    <div className="w-full space-y-4" data-testid="selfie-comparison">
      <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted">Задание</dt>
        <dd className="text-primary">{capture.tasks.join(' → ')}</dd>
        <dt className="text-muted">Код на снимках</dt>
        <dd className="font-medium tabular-nums text-primary">{capture.code}</dd>
        <dt className="text-muted">Выдано · срок</dt>
        <dd className="tabular-nums text-primary">
          {capture.issuedText} · до {capture.expiresText}
        </dd>
        <dt className="text-muted">Отправлено</dt>
        <dd className="tabular-nums text-primary">{capture.usedText ?? '—'}</dd>
        <dt className="text-muted">Браузер</dt>
        <dd className="break-all text-secondary">{capture.userAgent ?? '—'}</dd>
        <dt className="text-muted">Проверка</dt>
        <dd className="text-secondary">{capture.provider}</dd>
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <figure className="space-y-1.5">
          <figcaption className="text-xs font-medium text-secondary">Фото документа</figcaption>
          {!identity ? (
            <Callout tone="warning">Документ личности не подан — сравнить не с чем.</Callout>
          ) : identity.contentType === 'application/pdf' ? (
            <iframe src={identity.url} title="Документ личности" className="h-80 w-full rounded-md bg-card" />
          ) : (
            <img src={identity.url} alt="Документ личности" className="max-h-80 w-full rounded-md object-contain" />
          )}
        </figure>
        <ol className="grid gap-3 sm:grid-cols-3">
          {capture.frames.map((f) => (
            <li key={f.index} className="space-y-1.5">
              {byIndex.get(f.index) ? (
                <img
                  src={byIndex.get(f.index)}
                  alt={`Снимок ${f.index + 1}: ${f.task}`}
                  className="aspect-[3/4] w-full rounded-md bg-card object-cover"
                />
              ) : null}
              <p className="text-xs font-medium text-primary">
                {f.index + 1}. {f.task}
              </p>
              <p className="text-[11px] tabular-nums text-muted">
                {f.capturedText} · {f.offsetText}
              </p>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted">
        Сверьте лицо на снимках с фото документа, выполнение задания и код на снимках. Автоматического
        распознавания нет — решение принимает оператор.
      </p>
    </div>
  );
}

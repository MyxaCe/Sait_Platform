import { Container } from '@broker/ui';

export interface AccessNoticeProps {
  state: 'empty' | 'unavailable';
  title?: string;
  text: string;
  reason?: string;
  reasonLabel?: string;
  variant?: 'strip' | 'panel';
}

export function AccessNotice({
  state,
  title,
  text,
  reason,
  reasonLabel,
  variant = 'panel',
}: AccessNoticeProps) {
  if (variant === 'strip') {
    return (
      <div
        role="status"
        data-testid="access-notice"
        data-access-state={state}
        data-access-reason={reason}
        className="border-y border-border bg-primary/[0.03] py-2 text-sm text-secondary"
      >
        <Container>
          <span>{text}</span>
          {reason && (
            <span className="ml-2 font-mono text-xs opacity-70">({reasonLabel ?? reason})</span>
          )}
        </Container>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="access-notice"
      data-access-state={state}
      data-access-reason={reason}
      className="rounded-2xl border border-border bg-primary/[0.03] px-5 py-6"
    >
      {title && <p className="font-medium text-primary">{title}</p>}
      <p className="mt-1 max-w-2xl text-secondary">{text}</p>
      {reason && <p className="mt-3 font-mono text-xs text-secondary">{reasonLabel ?? reason}</p>}
    </div>
  );
}

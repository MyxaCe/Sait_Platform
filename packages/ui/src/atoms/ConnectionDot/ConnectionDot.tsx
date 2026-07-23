import { cn } from '../../lib/cn';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const STYLES: Record<ConnectionState, string> = {
  connected: 'bg-positive',
  connecting: 'bg-accent animate-pulse',
  reconnecting: 'bg-accent animate-pulse',
  offline: 'bg-negative',
};

const LABELS: Record<ConnectionState, string> = {
  connected: 'Данные в реальном времени',
  connecting: 'Подключение…',
  reconnecting: 'Переподключение…',
  offline: 'Нет соединения',
};

export interface ConnectionDotProps {
  status: ConnectionState;
  /** Локализованная подпись; по умолчанию — русские тексты */
  label?: string;
  className?: string;
}

export function ConnectionDot({ status, label, className }: ConnectionDotProps) {
  const text = label ?? LABELS[status];
  return (
    <span
      role="status"
      aria-label={text}
      title={text}
      className={cn('inline-block size-2 shrink-0 rounded-full', STYLES[status], className)}
    />
  );
}

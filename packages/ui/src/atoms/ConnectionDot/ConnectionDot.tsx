import { cn } from '../../lib/cn';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'simulated';

const STYLES: Record<ConnectionState, string> = {
  connected: 'bg-positive',
  connecting: 'bg-accent animate-pulse',
  reconnecting: 'bg-accent animate-pulse',
  offline: 'bg-negative',
  simulated: 'bg-secondary ring-1 ring-secondary/40',
};

const LABELS: Record<ConnectionState, string> = {
  connected: 'Соединение установлено',
  connecting: 'Подключение…',
  reconnecting: 'Переподключение…',
  offline: 'Нет соединения',
  simulated: 'Демо-данные: цены не рыночные',
};

export interface ConnectionDotProps {
  status: ConnectionState;
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

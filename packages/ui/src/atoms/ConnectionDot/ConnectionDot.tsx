import { cn } from '../../lib/cn';

/**
 * `simulated` — данные синтетические, к рынку отношения не имеют. Отдельное
 * состояние, а не оттенок `connected`: подключённость и подлинность — разные
 * вопросы (B-018). Цвет намеренно не зелёный и не пульсирующий: зелёный уже
 * означает «живые данные», пульсация — «идёт подключение».
 */
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

/**
 * Подписи по умолчанию. `connected` называет ровно то, что состояние знает
 * (CAB-04): точка поднимается по факту ОТКРЫТОГО СОКЕТА браузер→сервис, и про
 * наличие данных это соединение не знает ничего. Прежняя подпись «Данные в
 * реальном времени» утверждала больше: молчащий, но открытый сокет выглядел
 * живым фидом. Не возвращать её сюда — обещание про данные имеет право дать
 * только состояние, которое данные видит (таймер тишины транспорта, вторая
 * часть CAB-04, ещё не сделана).
 */
const LABELS: Record<ConnectionState, string> = {
  connected: 'Соединение установлено',
  connecting: 'Подключение…',
  reconnecting: 'Переподключение…',
  offline: 'Нет соединения',
  simulated: 'Демо-данные: цены не рыночные',
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

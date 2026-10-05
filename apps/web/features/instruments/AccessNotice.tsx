import { Container } from '@broker/ui';

/**
 * Объяснение закрытой границы доступа (Р-025, п. 3).
 *
 * Отказ, выглядящий как отсутствие функции, — наш общий класс: до Р-025
 * закрытая или недоступная граница давала пустую страницу, пустой тикер и
 * `404` на деталке, и ни одно из трёх состояний не было отличимо от
 * четвёртого — «такого инструмента у нас просто нет». Этот блок и есть
 * разница между «нечего показывать» и «мы не смогли узнать, что можно
 * показать».
 *
 * Текстов внутри нет — только пропсы (ADR-012): компонент не знает ни
 * локали, ни причины, он знает только как это выглядит.
 */
export interface AccessNoticeProps {
  /**
   * Состояние границы: `empty` и `unavailable` обязаны быть отличимы
   * машиной, а не только по тексту. Передаётся явно — умолчание здесь
   * было бы ровно той подменой, от которой блок и защищает.
   */
  state: 'empty' | 'unavailable';
  title?: string;
  text: string;
  /**
   * Машинный код причины недоступности — едет в `data-access-reason` как
   * есть. Отдельно от подписи сознательно: первая версия клала в атрибут
   * переведённую строку, и машинный признак оказался локализованным —
   * поймано e2e, а не чтением кода.
   */
  reason?: string;
  /** Человеческая подпись к причине; текст приходит снаружи (ADR-012). */
  reasonLabel?: string;
  /** `strip` — одна строка на месте тикера, `panel` — блок на месте списка. */
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

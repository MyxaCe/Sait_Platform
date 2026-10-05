import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionDot } from './ConnectionDot';

/**
 * CAB-04. Подпись состояния не должна утверждать больше, чем состояние знает.
 *
 * Точка `connected` поднимается по факту открытого сокета браузер→сервис.
 * Про данные это соединение не знает ничего: молчащий, но открытый сокет
 * неотличим от живого фида (родня B-018, где мок называл себя живым сам).
 *
 * Тест-растяжка, а не проверка строки: он существует, чтобы попытка вернуть
 * подпись про данные к состоянию, которое данных не видит, покраснела здесь,
 * а не обнаружилась потом на витрине.
 */

/** Слова, которыми подпись обещает ДАННЫЕ, а не соединение. */
const DATA_CLAIMS = [/реальн/i, /real[-\s]?time/i, /\bлайв\b/i, /\blive\b/i];

function claimsData(text: string): boolean {
  return DATA_CLAIMS.some((re) => re.test(text));
}

describe('ConnectionDot · подпись по умолчанию', () => {
  it('connected говорит про соединение, а не про данные', () => {
    render(<ConnectionDot status="connected" />);
    const label = screen.getByRole('status').getAttribute('aria-label') ?? '';

    expect(claimsData(label)).toBe(false);
    expect(label).toMatch(/соединение/i);
  });

  it('ни одна подпись оси соединения не обещает настоящих данных', () => {
    // simulated исключён сознательно: он про подлинность и обязан говорить
    // о данных — но говорит, что их НЕТ. Проверяем это отдельно ниже.
    for (const status of ['connecting', 'connected', 'reconnecting', 'offline'] as const) {
      const { unmount } = render(<ConnectionDot status={status} />);
      const label = screen.getByRole('status').getAttribute('aria-label') ?? '';
      expect(claimsData(label), `${status}: «${label}»`).toBe(false);
      unmount();
    }
  });

  it('simulated по-прежнему говорит, что цены не рыночные (B-018 не откатан)', () => {
    render(<ConnectionDot status="simulated" />);
    const label = screen.getByRole('status').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/не рыночные/i);
  });

  it('явная подпись приложения перекрывает умолчание', () => {
    render(<ConnectionDot status="connected" label="Connection established" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Connection established');
  });
});

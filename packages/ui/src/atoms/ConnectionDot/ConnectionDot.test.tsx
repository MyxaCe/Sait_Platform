import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionDot } from './ConnectionDot';

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

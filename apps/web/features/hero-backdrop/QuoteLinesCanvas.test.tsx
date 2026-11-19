import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    realtime: { connect: vi.fn(), subscribe: vi.fn(() => () => undefined) },
  };
});

vi.mock('next/dynamic', () => ({
  default: () =>
    function Lazy({ symbols }: { symbols: string[] }) {
      return <canvas data-testid="lines" data-symbols={symbols.join(',')} />;
    },
}));

const { QuoteLinesCanvas } = await import('./QuoteLinesCanvas');
const { HeroBackdrop } = await import('./HeroBackdrop');

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('канвас — фон, а не содержимое', () => {
  it('скрыт от вспомогательных технологий, не ловит клики и фокус', () => {
    const { container } = render(<QuoteLinesCanvas symbols={['BTCUSD']} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.className).toContain('pointer-events-none');
    expect(canvas.hasAttribute('tabindex')).toBe(false);
  });
});

describe('островок фона спрашивает те же границы, что бегущая строка', () => {
  const answer = (access: unknown, catalog: unknown) =>
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('tenant') ? access : catalog),
    }));

  it('граница закрыта — канваса нет вовсе', async () => {
    const fetchMock = answer(
      { state: 'unavailable', reason: 'not-configured', symbols: [] },
      { state: 'available', symbols: ['BTCUSD'] },
    );
    vi.stubGlobal('fetch', fetchMock);
    const { queryByTestId } = render(<HeroBackdrop candidates={['BTCUSD']} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(queryByTestId('lines')).toBeNull();
  });

  it('пересечение есть — канвас получает символы', async () => {
    vi.stubGlobal(
      'fetch',
      answer(
        { state: 'allowed', symbols: ['BTCUSD', 'ETHUSD'] },
        { state: 'available', symbols: ['ETHUSD', 'BTCUSD'] },
      ),
    );
    const { findByTestId } = render(<HeroBackdrop candidates={['ETHUSD', 'XAUUSD', 'BTCUSD']} />);
    expect((await findByTestId('lines')).dataset.symbols).toBe('ETHUSD,BTCUSD');
  });
});

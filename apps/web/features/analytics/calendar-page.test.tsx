import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarResult } from '@/lib/economic-calendar';
import type { EconomicEvent } from './EconomicCalendar';

const translate = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${Object.values(values).join(',')}` : key;

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
  useLocale: () => 'ru',
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => translate,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const load = vi.fn<(q: { from: string; to: string; lang: string }) => Promise<CalendarResult>>();
vi.mock('@/lib/economic-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/economic-calendar')>()),
  loadCalendar: (q: { from: string; to: string; lang: string }) => load(q),
}));

afterEach(() => {
  vi.restoreAllMocks();
  load.mockReset();
});

const event: EconomicEvent = {
  id: 'us-cpi',
  datetime: '2026-11-18T23:30:00.000Z',
  currency: 'USD',
  title: 'Consumer Price Index (YoY)',
  importance: 3,
  previous: '3.1%',
  forecast: null,
  actual: null,
};

const ok = (over: Partial<Extract<CalendarResult, { state: 'ok' }>['data']> = {}, stale = false): CalendarResult => ({
  state: 'ok',
  stale,
  fetchedAt: Date.UTC(2026, 10, 19, 9, 5),
  data: { events: [event], lang: 'ru', source: 'ForexFactory (faireconomy.media)', complete: true, ...over },
});

async function renderPage(locale = 'ru', searchParams: Record<string, string> = {}) {
  const { default: CalendarPage } = await import('../../app/[locale]/(marketing)/analytics/calendar/page');
  render(await CalendarPage({ params: { locale }, searchParams }));
}

describe('страница экономического календаря', () => {
  it('нет источника — прежнее «данных нет»', async () => {
    load.mockResolvedValue({ state: 'not-configured' });
    await renderPage();
    expect(screen.getByTestId('calendar-no-source')).toBeTruthy();
    expect(screen.queryByTestId('calendar-unavailable')).toBeNull();
  });

  it('модуль недоступен — «временно недоступно», а не «нет источника»', async () => {
    load.mockResolvedValue({ state: 'unavailable', reason: 'http-error' });
    await renderPage();
    expect(screen.getByTestId('calendar-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('calendar-no-source')).toBeNull();
  });

  it('запрашивает текущую неделю на языке страницы', async () => {
    load.mockResolvedValue(ok());
    await renderPage('de', { week: '-1' });
    const q = load.mock.calls[0]![0];
    expect(q.lang).toBe('de');
    expect(new Date(`${q.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${q.to}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(Date.parse(q.from)).toBeLessThan(Date.now() - 6 * 86_400_000);
  });

  it('пустая неделя без данных у поставщика — честное пустое состояние', async () => {
    load.mockResolvedValue(ok({ events: [], complete: false }));
    await renderPage();
    expect(screen.getByTestId('calendar-incomplete')).toBeTruthy();
    expect(screen.getByTestId('calendar-source').textContent).toBe(
      'sourceLabel:ForexFactory (faireconomy.media)',
    );
  });

  it('пустая полная неделя — «событий нет»', async () => {
    load.mockResolvedValue(ok({ events: [] }));
    await renderPage();
    expect(screen.getByTestId('calendar-empty')).toBeTruthy();
  });

  it('названия на другом языке показываются как есть, с пометкой', async () => {
    load.mockResolvedValue(ok({ lang: 'en' }));
    await renderPage('de');
    expect(screen.getByTestId('calendar-title-lang')).toBeTruthy();
    const titles = screen.getAllByText('Consumer Price Index (YoY)');
    expect(titles.length).toBeGreaterThan(0);
    for (const el of titles) expect(el.getAttribute('lang')).toBe('en');
  });

  it('на своём языке пометки нет', async () => {
    load.mockResolvedValue(ok());
    await renderPage();
    expect(screen.queryByTestId('calendar-title-lang')).toBeNull();
    expect(screen.queryByTestId('calendar-partial')).toBeNull();
  });

  it('запасной ответ помечен временем получения', async () => {
    load.mockResolvedValue(ok({}, true));
    await renderPage();
    expect(screen.getByTestId('calendar-stale').textContent).toBe('staleNote:09:05');
  });

  it('факта нет — прочерк, не выдумка', async () => {
    load.mockResolvedValue(ok());
    await renderPage();
    const row = screen.getAllByText('Consumer Price Index (YoY)')[0]!.closest('li')!;
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('время и день — в поясе посетителя, пояс подписан', async () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: 'Asia/Tokyo' };
    });
    load.mockResolvedValue(ok());
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('calendar-timezone').textContent).toContain('Asia/Tokyo'),
    );
    expect(screen.getAllByText('08:30').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/четверг, 19 ноября/);
  });
});

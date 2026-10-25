import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-39 · СТРАНИЦА спрашивает состояние и доводит причину до списка.
 *
 * **Зачем отдельно от проверок списка.** Те передают причину пропом
 * сами и остаются зелёными, даже если страница её не передаёт. Ровно
 * так случилось в WEB-38: мутация «шлюз выбрасывает причину» не
 * покрасила ни одной из 54 проверок. Это мой постоянный разрыв, и
 * теперь проверка пути пишется вместе с правилом, а не после.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

vi.mock('@/lib/cms', () => ({
  getCms: async () => ({ items: [{ symbol: 'BTCUSD' }] }),
}));
vi.mock('@/lib/tenant', () => ({
  // Модуль именно `@/lib/tenant`: первая попытка подменила
  // `tenant-runtime`, настоящая граница закрылась, и страница показала
  // объяснение про доступ вместо списка. Проверка это и показала.
  getTenantAccess: async () => ({ state: 'allowed', symbols: ['BTCUSD'] }),
  isSymbolAllowed: () => true,
  accessNotice: () => null,
}));
vi.mock('@/lib/mds', () => ({
  getMdsIcons: async () => ({}),
  getMdsQuotesState: async () => ({
    state: 'available',
    quotes: { unavailable: [{ symbol: 'BTCUSD', reason: 'source-disabled' }], missing: [] },
  }),
}));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useRealtimeQuotes: () => [
      {
        symbol: 'BTCUSD',
        name: 'Bitcoin',
        category: 'crypto',
        price: 67450,
        digits: 0,
        changePercent: null,
        bid: null,
        ask: null,
        ts: 0,
      },
    ],
    useConnectionStatus: () => 'connected',
  };
});

afterEach(() => vi.restoreAllMocks());

describe('WEB-39 · путь от ручки до списка', () => {
  it('причина, названная источником, доходит до разметки страницы', async () => {
    const { default: InstrumentsPage } = await import(
      '../../app/[locale]/(marketing)/instruments/page'
    );

    render(await InstrumentsPage({ params: { locale: 'ru' } }));

    // Весь путь: ответ MDS → раскладка причин → проп страницы → строка.
    expect(screen.getAllByText('shortLimited').length).toBeGreaterThan(0);
  });
});

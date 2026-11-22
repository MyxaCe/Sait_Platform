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

vi.mock('next-intl', () => ({ useLocale: () => 'ru',
  useTranslations: () => (key: string) => key,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

const src = vi.hoisted(() => ({
  cmsItems: [{ symbol: 'BTCUSD', category: 'crypto' }] as unknown[],
  catalog: { state: 'unavailable', reason: 'network' } as unknown,
}));

vi.mock('@/lib/cms', () => ({
  getCms: async () => ({ items: src.cmsItems }),
}));
vi.mock('@/lib/tenant', () => ({
  // Модуль именно `@/lib/tenant`: первая попытка подменила
  // `tenant-runtime`, настоящая граница закрылась, и страница показала
  // объяснение про доступ вместо списка. Проверка это и показала.
  getTenantAccess: async () => ({ state: 'allowed', symbols: new Set(['BTCUSD']) }),
  isSymbolAllowed: () => true,
  accessNotice: () => null,
}));
vi.mock('@/lib/mds', () => ({
  getMdsIcons: async () => ({}),
  getMdsCatalogEntries: async () => src.catalog,
  getMdsQuotesState: async () => ({
    state: 'available',
    quotes: { unavailable: [{ symbol: 'BTCUSD', reason: 'source-disabled' }], missing: [] },
  }),
}));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useRealtimeQuotes: (symbols: string[]) => [
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
    ].filter((q) => symbols.includes(q.symbol)),
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

describe('каталог: состав — карточка сайта, запись CMS необязательна', () => {
  it('инструмент без записи CMS виден в списке по каталогу MDS', async () => {
    src.cmsItems = [];
    src.catalog = {
      state: 'available',
      entries: { BTCUSD: { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', digits: 0, minQty: null } },
    };
    const { default: InstrumentsPage } = await import('../../app/[locale]/(marketing)/instruments/page');

    render(await InstrumentsPage({ params: { locale: 'ru' } }));

    expect(screen.getAllByText('BTCUSD').length).toBeGreaterThan(0);
  });
});

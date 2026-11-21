import { expect, test, type Page } from '@playwright/test';
import { E2E_FEED_URL, OPEN_SITE_URL } from './support/open-site';

test.use({ baseURL: OPEN_SITE_URL });

interface FeedQuote {
  symbol: string;
  name: string;
  category: string;
  price: number;
  digits: number;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  ageMs: number;
}

const FEED: Record<string, FeedQuote> = {
  BTCUSD: { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', price: 67250.5, digits: 2, changePercent: 1.25, bid: 67248.25, ask: 67252.75, ageMs: 0 },
  EURUSD: { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex', price: 1.08412, digits: 5, changePercent: -0.08, bid: 1.0841, ask: 1.08414, ageMs: 0 },
  XAUUSD: { symbol: 'XAUUSD', name: 'Gold', category: 'metals', price: 2401.35, digits: 2, changePercent: 0.31, bid: 2401.1, ask: 2401.6, ageMs: 7_200_000 },
};

const feedHost = new URL(E2E_FEED_URL).host.replace(/\./g, '\\.');

async function serveFeed(page: Page, feed: Record<string, FeedQuote> = FEED): Promise<void> {
  await page.routeWebSocket(new RegExp(`${feedHost}/socket\\.io/`), (ws) => {
    ws.send(`0${JSON.stringify({ sid: 'e2e', upgrades: [], pingInterval: 25_000, pingTimeout: 60_000, maxPayload: 1_000_000 })}`);
    ws.onMessage((message) => {
      const text = String(message);
      if (text.startsWith('40')) {
        ws.send(`40${JSON.stringify({ sid: 'e2e-socket' })}`);
        return;
      }
      if (!text.startsWith('42')) return;
      const [event, symbols] = JSON.parse(text.slice(2)) as [string, string[]];
      if (event !== 'subscribe') return;
      const batch = symbols
        .map((s) => feed[s])
        .filter((q): q is FeedQuote => q !== undefined)
        .map(({ ageMs, ...q }) => ({ ...q, ts: Date.now() - ageMs, source: 'e2e' }));
      if (batch.length) ws.send(`42${JSON.stringify(['quotes:batch', batch])}`);
    });
  });
}

const digitsOnly = (text: string | null) => (text ?? '').replace(/[\s,  ]/g, '');

test.describe('Страница инструмента (сайт со списком инструментов)', () => {
  test('BTCUSD: цена, bid и ask — из фида, а не расчёт', async ({ page }) => {
    await serveFeed(page);
    const response = await page.goto('/instruments/crypto/btcusd');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bitcoin');
    await expect(page.getByTestId('quote-bid')).toHaveText(/67,248\.25/);
    expect(digitsOnly(await page.getByTestId('quote-ask').textContent())).toBe('67252.75');
    expect(digitsOnly(await page.getByTestId('quote-price').textContent())).toBe('67250.50');
    await expect(page.getByTestId('quote-unavailable')).toHaveCount(0);
  });

  test('кнопки ведут в кабинет на терминал: реальный и демо-счёт с этим инструментом', async ({ page }) => {
    await page.goto('/instruments/crypto/btcusd');

    await expect(page.getByTestId('trade-real')).toHaveAttribute('href', /\/terminal\?account=real&symbol=BTCUSD$/);
    await expect(page.getByTestId('trade-demo')).toHaveAttribute('href', /\/terminal\?account=demo&symbol=BTCUSD$/);
    expect(await page.getByTestId('trade-real').getAttribute('href')).not.toMatch(/\/(en|de)\/terminal/);
  });

  test('язык страницы сохраняется в адресе кабинета', async ({ page }) => {
    await page.goto('/en/instruments/forex/eurusd');

    await expect(page.getByTestId('trade-real')).toHaveAttribute('href', /\/en\/terminal\?account=real&symbol=EURUSD$/);
    await expect(page.getByTestId('trade-demo')).toHaveAttribute('href', /\/en\/terminal\?account=demo&symbol=EURUSD$/);
  });

  test('инструмент вне клиентского справочника тоже имеет страницу, причина без цены названа', async ({ page }) => {
    await serveFeed(page);
    const response = await page.goto('/instruments/crypto/ltcusd');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Litecoin');
    await expect(page.getByTestId('quote-unavailable')).toHaveAttribute('data-reason', 'source-silent');
    await expect(page.getByTestId('quote-bid')).toHaveText('—');
    await expect(page.getByTestId('quote-ask')).toHaveText('—');
  });

  test('рынок закрыт: последняя цена и понятная пометка', async ({ page }) => {
    await serveFeed(page);
    await page.goto('/instruments/metals/xauusd');

    await expect(page.getByTestId('quote-unavailable')).toHaveText('Рынок закрыт');
    await expect(page.getByTestId('quote-price')).toHaveText(/2,401\.35/);
    await expect(page.getByTestId('instrument-precision')).toHaveText('2 зн.');
  });

  for (const path of ['/instruments/crypto/ethusd', '/instruments/forex/btcusd', '/instruments/crypto/nosuchcoin']) {
    test(`чужой или несуществующий символ → 404: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    });
  }
});

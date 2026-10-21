import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAB-09 · ось отказа канала при чтении истории у терминала.
 *
 * «Не дозвонились», «ответил не-2xx» и «ответил непонятным телом» — три
 * разные неполадки у трёх разных людей (Р-070). Схлопнутые, они
 * отправляют чинить наугад.
 *
 * Отдельно проверяется, что **пустой список — это не отказ**: «сделок
 * нет» человек читает как факт о себе, «историю не получили» — как нашу
 * неполадку, и путать их нельзя.
 */

const issueHandoffToken = vi.hoisted(() =>
  vi.fn(async () => ({ token: 'handoff.jwt', expiresIn: 60 })),
);

vi.mock('@/lib/sso/jwt', () => ({
  issueHandoffToken,
  tenantSlug: () => 'apex-ru',
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const DEAL = {
  symbol: 'EURUSD',
  side: 'sell',
  qty: 10,
  entry: 108500,
  exit: 108200,
  pnl: -1234,
  level: 108500,
  across_gap: true,
  price_decimals: 5,
  qty_decimals: 2,
};

beforeEach(() => {
  vi.resetModules();
  issueHandoffToken.mockClear();
  vi.stubEnv('TERMINAL_HTTP_URL', 'http://terminal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getClosedDeals · ось канала', () => {
  it('адреса нет → not-configured, и в сеть не ходим', async () => {
    vi.stubEnv('TERMINAL_HTTP_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({
      state: 'unavailable',
      reason: 'not-configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // И токен не выпускается зря: одноразовый `jti` сжигать незачем.
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('сессию не дали (не-2xx) → http-error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'bad token' }, 401)));
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({ state: 'unavailable', reason: 'http-error' });
  });

  it('терминал не отвечает → network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('сессия пришла телом не того вида → malformed, а не network', async () => {
    // Дозвонились и ответ получили: назвать это «не дозвонились» значит
    // отправить чинить сеть вместо контракта.
    vi.stubGlobal('fetch', vi.fn(async () => json({ nothing: true })));
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('история пришла не массивом → malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'sess', expires_in: 900 }))
      .mockResolvedValueOnce(json({ deals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({ state: 'unavailable', reason: 'malformed' });
  });
});

describe('getClosedDeals · успех', () => {
  it('сделки разобраны и приведены к обычным числам', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'sess', expires_in: 900 }))
      .mockResolvedValueOnce(json([DEAL]));
    vi.stubGlobal('fetch', fetchMock);
    const { getClosedDeals } = await import('./client');

    const outcome = await getClosedDeals('u1');

    expect(outcome.state).toBe('available');
    expect(outcome.state === 'available' && outcome.deals[0]).toMatchObject({
      symbol: 'EURUSD',
      exit: 1.082,
      level: 1.085,
      pnlCents: -1234,
      acrossGap: true,
    });
  });

  it('пустой список — это `available`, а не отказ', async () => {
    // «Сделок нет» — факт о человеке. «Историю не получили» — наша
    // неполадка. Показать второе вместо первого значит соврать про себя.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'sess', expires_in: 900 }))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', fetchMock);
    const { getClosedDeals } = await import('./client');

    expect(await getClosedDeals('u1')).toEqual({ state: 'available', deals: [] });
  });

  it('история запрашивается с bearer, полученным от терминала', async () => {
    // Растяжка: без заголовка ручка ответит 401, и мы покажем отказ
    // вместо истории, не поняв почему.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'sess-42', expires_in: 900 }))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', fetchMock);
    const { getClosedDeals } = await import('./client');

    await getClosedDeals('u1');

    const [, init] = fetchMock.mock.calls[1]!;
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sess-42' });
  });
});

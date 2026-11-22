#!/usr/bin/env node
import http from 'node:http';

const PORT = Number(process.env.CMS_STUB_PORT || 55493);
const down = new Set();
const SITE_LANGUAGES = (process.env.CMS_STUB_LANGUAGES || 'ru,en,de').split(',');

const link = (label, href) => ({ label, href });

const FAQ_TEMPLATE = (q) =>
  q.map(([question, answer]) => ({ question, answer }));

const FAQ_ITEMS = {
  ru: FAQ_TEMPLATE([
    ['Какой минимальный депозит?', 'Минимальная сумма пополнения — {{deposit.min}}. На демо-счёте {{demo.startBalance}}.'],
    ['Какое плечо?', '{{account.standard.name}} — до {{account.standard.leverage}} (крипта — до {{account.standard.leverage.crypto}}), {{account.pro.name}} — до {{account.pro.leverage}}.'],
    ['Как пополнить и вывести?', 'Способ пополнения — {{deposit.methods}}. Вывод от {{withdraw.min}}, без верификации — до {{withdraw.unverifiedPercent}}. Поддержка работает {{support.hours}}. {{bonus.max}}'],
  ]),
  en: FAQ_TEMPLATE([
    ['What is the minimum deposit?', 'The minimum deposit is {{deposit.min}}. The demo account has {{demo.startBalance}}.'],
    ['What leverage is available?', '{{account.standard.name}} — up to {{account.standard.leverage}} (crypto up to {{account.standard.leverage.crypto}}), {{account.pro.name}} — up to {{account.pro.leverage}}.'],
    ['How do I deposit and withdraw?', 'Deposit method: {{deposit.methods}}. Withdrawals from {{withdraw.min}}, without verification up to {{withdraw.unverifiedPercent}}. Support is available {{support.hours}}. {{bonus.max}}'],
  ]),
  de: FAQ_TEMPLATE([
    ['Wie hoch ist die Mindesteinzahlung?', 'Die Mindesteinzahlung beträgt {{deposit.min}}. Das Demokonto enthält {{demo.startBalance}}.'],
    ['Welcher Hebel ist verfügbar?', '{{account.standard.name}} — bis {{account.standard.leverage}} (Krypto bis {{account.standard.leverage.crypto}}), {{account.pro.name}} — bis {{account.pro.leverage}}.'],
    ['Wie zahle ich ein und aus?', 'Einzahlungsmethode: {{deposit.methods}}. Auszahlungen ab {{withdraw.min}}, ohne Verifizierung bis {{withdraw.unverifiedPercent}}. Der Support ist {{support.hours}} erreichbar. {{bonus.max}}'],
  ]),
};

const promo = (id, title, description) => ({
  id,
  badge: 'E2E',
  title,
  description,
  terms: 'E2E terms',
  ctaLabel: 'Участвовать',
  ctaHref: '/register?promo=cashback-e2e',
  featured: true,
  activeFrom: null,
  activeTo: null,
});

const portfolio = (key, title, baseLeverage, sortOrder, extra = {}) => ({
  key,
  title,
  baseLeverage,
  classOverrides: {},
  markupBps: 0,
  commissionBps: 0,
  isDefault: false,
  isPublic: true,
  sortOrder,
  instruments: null,
  description: null,
  ...extra,
});

const PLATFORM_TERMS = {
  attributionWindowDays: 30,
  promotionsEnabled: true,
  live: {
    money: { minDepositMinor: 1000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 },
    portfolios: [
      portfolio('standard', 'Standard', 20, 10, { isDefault: true, classOverrides: { crypto: 10 } }),
      portfolio('pro', 'Pro', 50, 20, { markupBps: 15 }),
      portfolio('enc_prime', 'ECN Prime', 100, 30, { commissionBps: 5 }),
    ],
    support: { alwaysOpen: true, timezone: 'Europe/Moscow', week: {} },
    promo: { enabled: true, attributionWindowDays: 30 },
    promotions: [
      {
        id: '00000000-0000-4000-8000-0000000000e2',
        slug: 'cashback-e2e',
        type: 'cashback',
        cmsPromoId: 'welcome-cms',
        startsAt: null,
        endsAt: null,
        texts: { ru: { title: 'Кешбэк (админка)', summary: '', terms: '' } },
      },
    ],
  },
};

const cmsInstrument = (symbol, name, category, digits) => ({
  symbol,
  name,
  category,
  digits,
  spreadFrom: '0.1',
  swapFree: category !== 'crypto',
  icon: null,
});

const OPEN_SITE = 'e2e-open';
const OPEN_SITE_INSTRUMENTS = ['BTCUSD', 'XAUUSD', 'EURUSD', 'LTCUSD'];

const MDS_INSTRUMENTS = [
  { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', digits: 2, icon: null },
  { symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto', digits: 2, icon: null },
  { symbol: 'ETHUSD', name: 'Ethereum', category: 'crypto', digits: 2, icon: null },
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', category: 'metals', priceDecimals: 2, minQty: '0.01', icon: null },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex', priceDecimals: 5, minQty: '0.01', icon: null },
];

const MDS_QUOTES = {
  items: [],
  staleAfterMs: 20_000,
  missing: [],
  unavailable: [
    { symbol: 'XAUUSD', reason: 'market-closed', nextOpen: Date.now() + 2 * 24 * 3_600_000 },
    { symbol: 'LTCUSD', reason: 'source-silent' },
  ],
};

const OPEN_SITE_LEGAL_ENTITY = (locale) => ({
  name: 'Example Ltd',
  registrationNumber: 'EX-000000',
  address: locale === 'en' ? '1 Example Street, Example City' : 'Пример-сити, ул. Примерная, 1',
  licenses: [
    {
      number: 'LIC-0001',
      activity: locale === 'en' ? 'Brokerage' : 'Брокерская деятельность',
      regulator: 'Example Financial Authority',
      regulatorCountry: 'Exampleland',
      verifyUrl: 'https://register.example.test/firms/LIC-0001',
      document: {
        url: 'https://cms.example.test/api/media/file/license.pdf',
        filename: 'license.pdf',
        mimeType: 'application/pdf',
      },
    },
    {
      number: 'LIC-0002',
      activity: null,
      regulator: null,
      regulatorCountry: null,
      verifyUrl: null,
      document: null,
    },
  ],
});

const DATA = {
  brand: (locale, _raw, site) => ({
    name: 'E2E Brand',
    logo: null,
    favicon: null,
    primaryColor: null,
    socials: [],
    ...(site === OPEN_SITE ? { legalEntity: OPEN_SITE_LEGAL_ENTITY(locale) } : {}),
  }),
  navigation: (locale) => ({
    header:
      locale === 'en'
        ? [
            link('Instruments', '/instruments'),
            link('Accounts', '/accounts'),
            link('Analytics', '/analytics/news'),
            link('Education', '/education'),
            link('About', '/about'),
          ]
        : [
            link('Инструменты', '/instruments'),
            link('Счета и тарифы', '/accounts'),
            link('Аналитика', '/analytics/news'),
            link('Обучение', '/education'),
            link('О компании', '/about'),
          ],
    footer: {
      columns: [{ title: 'E2E', links: [link('Контакты', '/company/contacts')] }],
      riskWarning: 'E2E risk warning',
    },
  }),
  instruments: () => ({
    items: [
      {
        symbol: 'XAUUSD',
        name: 'Gold',
        category: 'metals',
        digits: 2,
        leverageMax: '1:100',
        spreadFrom: '0.1',
        swapFree: false,
        icon: null,
      },
      cmsInstrument('BTCUSD', 'Bitcoin', 'crypto', 2),
      cmsInstrument('EURUSD', 'Euro / US Dollar', 'forex', 5),
      cmsInstrument('LTCUSD', 'Litecoin', 'crypto', 2),
      cmsInstrument('ETHUSD', 'Ethereum', 'crypto', 2),
    ],
  }),
  accounts: () => ({
    items: [
      {
        id: 'standard',
        name: 'Standard',
        description: 'E2E',
        minDeposit: '$100',
        featured: false,
        features: [{ label: 'Spread', value: '1.0' }],
        pricing: { spreadPips: 1, commissionPerLotRT: 0 },
      },
      {
        id: 'pro-plan',
        portfolioKey: 'pro',
        name: 'Pro',
        description: 'E2E',
        minDeposit: '$1000',
        featured: true,
        features: [{ label: 'Spread', value: '0.5' }],
        pricing: { spreadPips: 0.5, commissionPerLotRT: 3 },
      },
    ],
  }),
  faq: (_short, locale) => ({ sections: [{ title: 'E2E', items: FAQ_ITEMS[locale] ?? FAQ_ITEMS.en }] }),
  promotions: () => ({
    items: [
      promo('welcome-cms', 'Кешбэк E2E', 'Возврат до {{withdraw.unverifiedPercent}} — E2E'),
      promo('switched-off', 'Акция, выключенная в движке', 'Не должна показываться'),
    ],
  }),
  partners: () => ({ models: [], tiers: [], steps: [] }),
  academy: () => ({ articles: [], webinars: [], glossary: [] }),
  streams: () => ({ items: [] }),
  articles: () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  contacts: () => ({
    channels: [{ title: 'Email', value: 'e2e@example.com', detail: 'E2E' }],
    offices: [],
  }),
  careers: () => ({ benefits: [], vacancies: [] }),
  legal: () => ({ items: [] }),
  'system-status': () => ({ services: [], incidents: [] }),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'POST' && (url.pathname === '/__stub/down' || url.pathname === '/__stub/up')) {
    const resource = url.searchParams.get('resource') ?? '';
    if (url.pathname === '/__stub/down') down.add(resource);
    else down.delete(resource);
    return send(200, { down: [...down] });
  }
  if (url.pathname === '/health') return send(200, { ok: true });
  if (/^\/v1\/cms\/sites\/[a-z0-9-]+$/.test(url.pathname)) {
    const card = { languages: SITE_LANGUAGES, defaultLanguage: 'ru', demoStartBalanceCents: 1_000_000 };
    if (url.pathname.endsWith(`/${OPEN_SITE}`)) card.instruments = OPEN_SITE_INSTRUMENTS;
    return send(200, card);
  }
  if (url.pathname === '/v1/instruments') return send(200, { items: MDS_INSTRUMENTS, catalogSource: 'e2e-stub' });
  if (url.pathname === '/v1/quotes') return send(200, MDS_QUOTES);
  if (url.pathname === '/api/public/platform-terms') {
    if (down.has('platform-terms')) return send(503, { error: 'unavailable' });
    return send(200, PLATFORM_TERMS);
  }

  const match = /^\/v1\/cms\/([a-z-]+)$/.exec(url.pathname);
  const build = match ? DATA[match[1]] : undefined;
  if (!build) return send(404, { error: 'not_found' });
  if (down.has(match[1])) return send(503, { error: 'stub_down' });
  const locale = url.searchParams.get('locale');
  return send(200, build(!locale || locale === 'ru' ? 'ru' : 'en', locale || 'ru', url.searchParams.get('site')));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[cms-stub] http://127.0.0.1:${PORT}/v1`);
});

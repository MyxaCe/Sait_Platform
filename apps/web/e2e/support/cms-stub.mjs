#!/usr/bin/env node
/*
 * Стаб CMS для e2e витрины (тестовые данные — только здесь, не в коде сайта).
 *
 * С 10.11 витрина без CMS ничего не показывает (контента в коде нет), и
 * прогон e2e без CMS стал бы прогоном страницы «Контент временно
 * недоступен». Стаб отвечает по контракту `/v1/cms/{resource}` минимальными
 * данными, достаточными для сценариев.
 *
 * Управление (только для сценария отказа CMS):
 *   POST /__stub/down?resource=<имя>   — ресурс отвечает 503
 *   POST /__stub/up?resource=<имя>     — снова отвечает
 * Отказ точечный, по ресурсу: параллельные сценарии на других ресурсах
 * его не замечают.
 *
 * Карточки сайта (`/v1/cms/sites/{slug}`) у стаба нет — граница доступа к
 * инструментам закрыта (fail-closed, причина `http-error`).
 *
 * Запуск: node e2e/support/cms-stub.mjs  (порт — CMS_STUB_PORT, по умолчанию 55493)
 */
import http from 'node:http';

const PORT = Number(process.env.CMS_STUB_PORT || 55493);
const down = new Set();

const link = (label, href) => ({ label, href });

const DATA = {
  brand: () => ({
    name: 'E2E Brand',
    logo: null,
    favicon: null,
    primaryColor: null,
    socials: [],
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
        id: 'pro',
        name: 'Pro',
        description: 'E2E',
        minDeposit: '$1000',
        featured: true,
        features: [{ label: 'Spread', value: '0.5' }],
        pricing: { spreadPips: 0.5, commissionPerLotRT: 3 },
      },
    ],
  }),
  faq: () => ({ sections: [{ title: 'E2E', items: [{ question: 'Q?', answer: 'A.' }] }] }),
  promotions: () => ({ items: [] }),
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

  const match = /^\/v1\/cms\/([a-z-]+)$/.exec(url.pathname);
  const build = match ? DATA[match[1]] : undefined;
  if (!build) return send(404, { error: 'not_found' });
  if (down.has(match[1])) return send(503, { error: 'stub_down' });
  return send(200, build(url.searchParams.get('locale') === 'en' ? 'en' : 'ru'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[cms-stub] http://127.0.0.1:${PORT}/v1`);
});

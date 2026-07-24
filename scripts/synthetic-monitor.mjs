/**
 * Синтетический мониторинг (этап 3, риск R-14): проверяет цикл
 * «публикация → вебхук → обновление страницы» на живом сайте.
 *
 * Запуск: node scripts/synthetic-monitor.mjs [--base http://localhost:3000]
 * Секрет вебхука: env CMS_WEBHOOK_SECRET (без него — только health-часть).
 * Код выхода != 0 — авария (для cron/CI-алертов).
 */
import { createHmac, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const base = (args[args.indexOf('--base') + 1] && args.includes('--base')
  ? args[args.indexOf('--base') + 1]
  : process.env.SITE_URL) ?? 'http://localhost:3000';
const secret = process.env.CMS_WEBHOOK_SECRET;
const INVALIDATION_TIMEOUT_MS = Number(process.env.MAX_INVALIDATION_MS ?? 120_000);
const POLL_MS = 3_000;

const results = [];
const fail = (step, detail) => {
  results.push({ step, ok: false, detail });
  console.error(`FAIL ${step}: ${detail}`);
};
const pass = (step, detail = '') => {
  results.push({ step, ok: true, detail });
  console.log(`ok   ${step}${detail ? ` (${detail})` : ''}`);
};

async function getRenderedAt() {
  const res = await fetch(`${base}/`, { headers: { 'Cache-Control': 'no-cache' } });
  const html = await res.text();
  const match = html.match(/<meta name="rendered-at" content="([^"]+)"/);
  return { status: res.status, renderedAt: match?.[1] ?? null };
}

// 1. Health
try {
  const health = await fetch(`${base}/api/health`);
  health.ok ? pass('health') : fail('health', `HTTP ${health.status}`);
  const ready = await fetch(`${base}/api/health/ready`);
  const body = await ready.json();
  ready.ok
    ? pass('ready', `db=${body.checks?.database}`)
    : fail('ready', `HTTP ${ready.status} db=${body.checks?.database}`);
} catch (error) {
  fail('health', String(error));
}

// 2. Возраст контента
let before = null;
try {
  before = await getRenderedAt();
  before.status === 200 && before.renderedAt
    ? pass('rendered-at', before.renderedAt)
    : fail('rendered-at', `HTTP ${before.status}, meta=${before.renderedAt}`);
} catch (error) {
  fail('rendered-at', String(error));
}

// 3. Полный цикл инвалидации (только при наличии секрета)
if (secret && before?.renderedAt) {
  const bodyText = JSON.stringify({ event_id: randomUUID(), tags: ['cms:brand'] });
  const signature = `sha256=${createHmac('sha256', secret).update(bodyText, 'utf8').digest('hex')}`;
  const started = Date.now();
  try {
    const webhook = await fetch(`${base}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      body: bodyText,
    });
    if (webhook.status !== 202) {
      fail('webhook', `HTTP ${webhook.status}`);
    } else {
      pass('webhook', 'accepted');
      // stale-while-revalidate: первый запрос может отдать старую версию,
      // опрашиваем до смены rendered-at
      let updated = false;
      while (Date.now() - started < INVALIDATION_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const now = await getRenderedAt();
        if (now.renderedAt && now.renderedAt !== before.renderedAt) {
          pass('invalidation-cycle', `${((Date.now() - started) / 1000).toFixed(1)}s`);
          updated = true;
          break;
        }
      }
      if (!updated) {
        fail('invalidation-cycle', `page not regenerated within ${INVALIDATION_TIMEOUT_MS}ms`);
      }
    }
  } catch (error) {
    fail('webhook', String(error));
  }
} else {
  console.log('skip invalidation-cycle (CMS_WEBHOOK_SECRET not set)');
}

const failed = results.filter((r) => !r.ok);
console.log(`\nsummary: ${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length > 0 ? 1 : 0);

import 'dotenv/config';

import { Pool } from 'pg';
import { assertSchemaCurrent } from '@broker/db';
import { isUsableExchangeAddress, isValidTronAddress, terminalMoneyClientFromEnv, type PoolLike } from '@broker/money';
import { assertTenantSlugAtStartup } from '@broker/tenant';
import { envOr, readEnv } from '@broker/utils';
import { createTronGridReader } from './trongrid';
import { runTick } from './watcher';
import { describeError, formatError, secretsFromEnv } from './errors';

/**
 * Наблюдатель сети TRON (chain-watcher): свой контейнер, свой failure domain.
 * Ключей нет — кошелёк биржи только наблюдается (дизайн §0 п.3). Деньги
 * двигает терминал через internal-маршруты.
 *
 * Fail-closed на старте: без базы, без валидного адреса биржи, без слага
 * тенанта, без отстающей схемы — не стартуем (лучше упасть громко, чем
 * молча не зачислять).
 */

function fatal(msg: string): never {
  console.error(`[chain-watcher] ${msg}`);
  process.exit(1);
}

const databaseUrl = readEnv(process.env.DATABASE_URL) ?? fatal('DATABASE_URL обязателен');
const exchange = readEnv(process.env.EXCHANGE_TRON_ADDRESS) ?? fatal('EXCHANGE_TRON_ADDRESS обязателен');
if (!isValidTronAddress(exchange)) fatal(`EXCHANGE_TRON_ADDRESS не адрес TRON (base58check): ${exchange}`);
if (!isUsableExchangeAddress(exchange))
  fatal('EXCHANGE_TRON_ADDRESS — это адрес КОНТРАКТА USDT, а не кошелька биржи: USDT на него сгорают. Укажите адрес своего кошелька.');

let tenant: string;
try {
  tenant = assertTenantSlugAtStartup('старт наблюдателя сети');
} catch (error) {
  fatal((error as Error).message);
}
if (!readEnv(process.env.TERMINAL_INTERNAL_URL) || !readEnv(process.env.INTERNAL_MONEY_TOKEN)) {
  fatal('TERMINAL_INTERNAL_URL и INTERNAL_MONEY_TOKEN обязательны: без них зачислять некуда');
}

const apiKey = readEnv(process.env.TRONGRID_API_KEY);
if (!apiKey) console.warn('[chain-watcher] TRONGRID_API_KEY не задан — лимиты публичного API TronGrid');
const intervalMs = Number(envOr(process.env.POLL_INTERVAL_MS, '15000'));

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const chain = createTronGridReader({
  baseUrl: envOr(process.env.TRONGRID_URL, 'https://api.trongrid.io'),
  apiKey,
});
const terminal = terminalMoneyClientFromEnv();

let stopping = false;
let timer: NodeJS.Timeout | null = null;

async function loop(): Promise<void> {
  if (stopping) return;
  try {
    const s = await runTick({ pool: pool as unknown as PoolLike, chain, terminal, exchangeAddress: exchange });
    const busy = Object.values(s).some((v) => v > 0);
    if (busy) console.info(`[chain-watcher] проход: ${JSON.stringify(s)}`);
  } catch (error) {
    // Причина целиком (тип, сообщение, код/cause), секреты вырезаны.
    console.error(`[chain-watcher] проход упал: ${formatError(describeError(error, secretsFromEnv()))}`);
  }
  if (!stopping) timer = setTimeout(() => void loop(), intervalMs);
}

async function main(): Promise<void> {
  try {
    const state = await assertSchemaCurrent(pool as never);
    console.info(`[chain-watcher] схема: применено ${state.applied.length}`);
  } catch (error) {
    fatal((error as Error).message);
  }
  console.info(`[chain-watcher] тенант ${tenant}, кошелёк ${exchange}, опрос ${intervalMs} мс`);
  void loop();
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    void pool.end().finally(() => process.exit(0));
  });
}

void main();

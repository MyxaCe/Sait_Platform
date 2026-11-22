import {
  TRANSFER_TOPIC,
  USDT_TRC20_CONTRACT,
  topicToTronAddress,
  tronHexToBase58,
} from '@broker/money';

export interface TokenTransfer {
  contract: string;
  from: string;
  to: string;
  amountRaw: bigint;
}

export interface SolidTx {
  txHash: string;
  success: boolean;
  blockTime: Date | null;
  transfers: TokenTransfer[];
}

export interface IncomingUsdt {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
  blockTime: Date;
}

export interface ChainReader {
  getSolidTx(txHash: string): Promise<SolidTx | null>;
  txExists(txHash: string): Promise<boolean>;
  listIncomingUsdt(address: string, sinceMs: number): Promise<IncomingUsdt[]>;
}

export class ChainUnavailableError extends Error {
  constructor(what: string) {
    super(`TronGrid недоступен: ${what}`);
    this.name = 'ChainUnavailableError';
  }
}

export function parseSolidTxInfo(txHash: string, json: unknown): SolidTx | null {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== 'object' || typeof j.id !== 'string') return null;
  const receipt = (j.receipt ?? {}) as { result?: unknown };
  const success = j.result !== 'FAILED' && receipt.result === 'SUCCESS';
  const ts = Number(j.blockTimeStamp);
  const transfers: TokenTransfer[] = [];
  const logs = Array.isArray(j.log) ? (j.log as Record<string, unknown>[]) : [];
  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? (log.topics as string[]) : [];
    if (topics.length < 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    try {
      transfers.push({
        contract: tronHexToBase58(String(log.address)),
        from: topicToTronAddress(String(topics[1])),
        to: topicToTronAddress(String(topics[2])),
        amountRaw: BigInt(`0x${String(log.data || '0')}`),
      });
    } catch {
    }
  }
  return { txHash, success, blockTime: Number.isFinite(ts) && ts > 0 ? new Date(ts) : null, transfers };
}

export function parseIncomingUsdt(address: string, json: unknown): IncomingUsdt[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new ChainUnavailableError('ответ trc20 без data');
  const out: IncomingUsdt[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const token = (raw.token_info ?? {}) as { address?: unknown };
    if (raw.type !== 'Transfer' || token.address !== USDT_TRC20_CONTRACT || raw.to !== address) continue;
    if (typeof raw.transaction_id !== 'string' || !/^\d+$/.test(String(raw.value))) continue;
    out.push({
      txHash: raw.transaction_id.toLowerCase(),
      fromAddress: String(raw.from),
      toAddress: String(raw.to),
      amountRaw: BigInt(String(raw.value)),
      blockTime: new Date(Number(raw.block_timestamp)),
    });
  }
  return out;
}

export function createTronGridReader(config: {
  baseUrl: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ChainReader {
  const base = config.baseUrl.replace(/\/$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
  if (config.apiKey) headers['TRON-PRO-API-KEY'] = config.apiKey;
  const timeoutMs = config.timeoutMs ?? 10_000;

  async function call(path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ChainUnavailableError(`сеть: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ChainUnavailableError(`HTTP ${res.status} на ${path.split('?')[0]}`);
    try {
      return await res.json();
    } catch {
      throw new ChainUnavailableError(`не JSON на ${path.split('?')[0]}`);
    }
  }

  return {
    async getSolidTx(txHash) {
      return parseSolidTxInfo(txHash, await call('/walletsolidity/gettransactioninfobyid', { value: txHash }));
    },
    async txExists(txHash) {
      const j = (await call('/wallet/gettransactionbyid', { value: txHash })) as { txID?: unknown } | null;
      return typeof j?.txID === 'string';
    },
    async listIncomingUsdt(address, sinceMs) {
      const q = new URLSearchParams({
        only_to: 'true',
        only_confirmed: 'true',
        contract_address: USDT_TRC20_CONTRACT,
        limit: '200',
        min_timestamp: String(Math.max(0, Math.floor(sinceMs))),
        order_by: 'block_timestamp,desc',
      });
      return parseIncomingUsdt(address, await call(`/v1/accounts/${address}/transactions/trc20?${q}`));
    },
  };
}

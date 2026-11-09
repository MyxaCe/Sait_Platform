import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { USDT_TRC20_CONTRACT } from '@broker/money';
import { ChainUnavailableError, createTronGridReader, parseIncomingUsdt, parseSolidTxInfo } from './trongrid';
import { verifyDeposit, verifyPayout } from './verify';

/** Адаптер и сверка — на фикстурах ответов TronGrid; сети нет. */

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const ADDR = fx('addresses.json') as { exchange: string; from: string; other: string };
const H = (c: string) => c.repeat(64);

describe('разбор walletsolidity/gettransactioninfobyid', () => {
  it('USDT Transfer: контракт, отправитель, получатель, сумма (hex → base58)', () => {
    const tx = parseSolidTxInfo(H('1'), fx('solid-deposit-ok.json'))!;
    expect(tx.success).toBe(true);
    expect(tx.blockTime?.toISOString()).toBe('2025-11-09T10:00:00.000Z');
    expect(tx.transfers).toEqual([
      { contract: USDT_TRC20_CONTRACT, from: ADDR.from, to: ADDR.exchange, amountRaw: 25_123_456n },
    ]);
  });

  it('`{}` — ещё не необратима / нет: null', () => {
    expect(parseSolidTxInfo(H('1'), fx('solid-empty.json'))).toBeNull();
  });

  it('неуспешная транзакция распознаётся', () => {
    expect(parseSolidTxInfo(H('4'), fx('solid-failed.json'))!.success).toBe(false);
  });
});

describe('сверка депозита', () => {
  const v = (name: string) => verifyDeposit(parseSolidTxInfo('x', fx(name))!, ADDR.exchange);

  it('всё сходится → ok, отправитель сохранён', () => {
    expect(v('solid-deposit-ok.json')).toMatchObject({ kind: 'ok', amountRaw: 25_123_456n, fromAddress: ADDR.from });
  });
  it('не тот получатель', () => {
    expect(v('solid-wrong-recipient.json')).toMatchObject({ kind: 'rejected', reason: 'wrong_recipient', toAddress: ADDR.other });
  });
  it('токен-подделка (не официальный контракт USDT)', () => {
    expect(v('solid-fake-token.json')).toMatchObject({ kind: 'rejected', reason: 'wrong_token' });
  });
  it('неуспешна', () => {
    expect(v('solid-failed.json')).toMatchObject({ kind: 'rejected', reason: 'failed' });
  });
});

describe('сверка выплаты', () => {
  const tx = () => parseSolidTxInfo('x', fx('solid-payout-ok.json'))!;
  it('получатель и сумма точно совпадают → ok', () => {
    expect(verifyPayout(tx(), { toAddress: ADDR.other, amountRaw: 50_000_000n })).toEqual({ kind: 'ok', fromAddress: ADDR.from });
  });
  it('сумма не та → mismatch', () => {
    expect(verifyPayout(tx(), { toAddress: ADDR.other, amountRaw: 50_000_001n }).kind).toBe('mismatch');
  });
  it('получатель не тот → mismatch', () => {
    expect(verifyPayout(tx(), { toAddress: ADDR.exchange, amountRaw: 50_000_000n }).kind).toBe('mismatch');
  });
});

describe('входящие USDT (v1 trc20)', () => {
  it('только Transfer официального USDT на наш адрес', () => {
    const list = parseIncomingUsdt(ADDR.exchange, fx('trc20-incoming.json'));
    expect(list.map((t) => t.txHash)).toEqual([H('7'), H('8')]);
    expect(list[0]).toMatchObject({ fromAddress: ADDR.from, amountRaw: 12_340_000n });
  });
});

describe('HTTP-адаптер (fetch подменён)', () => {
  it('ключ API в заголовке, POST на walletsolidity', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const reader = createTronGridReader({
      baseUrl: 'https://grid.test/',
      apiKey: 'k',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify(fx('solid-deposit-ok.json')));
      }) as unknown as typeof fetch,
    });
    const tx = await reader.getSolidTx(H('1'));
    expect(tx?.transfers).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://grid.test/walletsolidity/gettransactioninfobyid');
    expect((seen[0]!.init.headers as Record<string, string>)['TRON-PRO-API-KEY']).toBe('k');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ value: H('1') });
  });

  it('сбой сети и HTTP 5xx — ChainUnavailableError, а НЕ «транзакции нет»', async () => {
    const down = createTronGridReader({
      baseUrl: 'https://grid.test',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(down.getSolidTx(H('1'))).rejects.toBeInstanceOf(ChainUnavailableError);
    const busy = createTronGridReader({
      baseUrl: 'https://grid.test',
      fetchImpl: (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(busy.txExists(H('1'))).rejects.toBeInstanceOf(ChainUnavailableError);
  });
});

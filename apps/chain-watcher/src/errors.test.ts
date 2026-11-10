import { describe, expect, it } from 'vitest';
import { describeError, formatError, redact, secretsFromEnv } from './errors';
import { ChainUnavailableError } from './trongrid';

describe('причина ошибки прохода', () => {
  it('Error: тип, сообщение, код и причина из cause (fetch failed)', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), { code: 'ECONNREFUSED' });
    const e = new TypeError('fetch failed', { cause });
    const info = describeError(e);
    expect(info).toMatchObject({ type: 'TypeError', message: 'fetch failed' });
    expect(info.cause).toContain('ECONNREFUSED');
    expect(formatError(info)).toBe('TypeError: fetch failed (причина: Error: connect ECONNREFUSED 10.0.0.5:443)');
  });

  it('свой класс ошибки сохраняет имя', () => {
    expect(describeError(new ChainUnavailableError('HTTP 503 на /x')).type).toBe('ChainUnavailableError');
  });

  it('не-Error и пустое сообщение не превращаются в «undefined»', () => {
    expect(describeError('boom')).toEqual({ type: 'string', message: 'boom' });
    expect(describeError({ status: 500 })).toEqual({ type: 'object', message: '{"status":500}' });
    expect(describeError(new Error('')).message).toBe('(пустое сообщение)');
    expect(describeError(undefined).message).not.toBe('');
  });

  it('секреты вырезаются: env, Bearer, пароль в URL, ключ в query', () => {
    const env = {
      TRONGRID_API_KEY: 'tg-key-1234567890',
      INTERNAL_MONEY_TOKEN: 'internal-secret-token',
      DATABASE_URL: 'postgres://broker:S3cretPass@db:5432/broker',
    } as NodeJS.ProcessEnv;
    const secrets = secretsFromEnv(env);
    const raw =
      'tg-key-1234567890 / Bearer internal-secret-token / postgres://broker:S3cretPass@db:5432/broker / ?apikey=zzz&x=1 / S3cretPass';
    const out = redact(raw, secrets);
    for (const s of ['tg-key-1234567890', 'internal-secret-token', 'S3cretPass', 'zzz']) expect(out).not.toContain(s);
    const info = describeError(new Error(`терминал: Authorization: Bearer abc.def.ghi`), secrets);
    expect(info.message).not.toContain('abc.def.ghi');
  });
});

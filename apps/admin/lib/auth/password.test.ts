import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentArgonParams,
  DEFAULT_ARGON_PARAMS,
  hashPassword,
  needsRehash,
  parsePhc,
  verifyPassword,
} from './password';

/**
 * ADM-01 · argon2id (Р-451). Настоящий `@node-rs/argon2`, не мок: смысл
 * модуля — именно в хеше. Параметры снижены окружением, чтобы прогон был
 * быстрым, но алгоритм и формат PHC — настоящие.
 */

/** Дешёвые параметры: тест про корректность, не про стойкость. */
function setCheapParams() {
  process.env.ADMIN_ARGON_MEMORY_KIB = '1024';
  process.env.ADMIN_ARGON_TIME = '1';
  process.env.ADMIN_ARGON_PARALLELISM = '1';
}

function clearParams() {
  delete process.env.ADMIN_ARGON_MEMORY_KIB;
  delete process.env.ADMIN_ARGON_TIME;
  delete process.env.ADMIN_ARGON_PARALLELISM;
}

describe('argon2id · hash/verify', () => {
  beforeEach(setCheapParams);
  afterEach(clearParams);

  it('хеш — PHC-строка argon2id с параметрами конфига', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=1024,t=1,p=1\$/);
  });

  it('верный пароль сверяется, неверный — нет', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong pass', hash)).toBe(false);
  });

  it('битый хеш → false, не бросок', async () => {
    expect(await verifyPassword('whatever', 'not-a-phc-string')).toBe(false);
  });

  it('два хеша одного пароля различны (соль), но оба сверяются', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toEqual(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });
});

describe('argon2id · parsePhc', () => {
  it('вынимает алгоритм и параметры', async () => {
    setCheapParams();
    const hash = await hashPassword('x');
    clearParams();
    expect(parsePhc(hash)).toEqual({
      algorithm: 'argon2id',
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });
  });

  it('не PHC → null', () => {
    expect(parsePhc('$2a$12$notargon')).toBeNull();
    expect(parsePhc('garbage')).toBeNull();
  });
});

describe('argon2id · needsRehash (Р-451: параметры рядом с хешем)', () => {
  afterEach(clearParams);

  it('те же параметры, что в конфиге → перехеш не нужен', async () => {
    setCheapParams();
    const hash = await hashPassword('pw');
    expect(needsRehash(hash)).toBe(false);
  });

  it('параметры усилили (память выросла) → нужен перехеш', async () => {
    setCheapParams();
    const hash = await hashPassword('pw'); // m=1024
    // Конфиг теперь строже — старый хеш отстал.
    process.env.ADMIN_ARGON_MEMORY_KIB = String(DEFAULT_ARGON_PARAMS.memoryCost);
    expect(currentArgonParams().memoryCost).toBe(DEFAULT_ARGON_PARAMS.memoryCost);
    expect(needsRehash(hash)).toBe(true);
  });

  it('любой из t/p разошёлся → нужен перехеш', async () => {
    setCheapParams();
    const hash = await hashPassword('pw'); // t=1,p=1
    process.env.ADMIN_ARGON_TIME = '3';
    expect(needsRehash(hash)).toBe(true);
  });

  it('не argon2id (например, bcrypt-хеш) → нужен перехеш', () => {
    setCheapParams();
    expect(needsRehash('$2a$12$abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('нечитаемый хеш → нужен перехеш (заменить при первом входе)', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

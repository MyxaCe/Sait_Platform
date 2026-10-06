import { describe, expect, it } from 'vitest';
import {
  accessNotice,
  isAccessClosed,
  isSymbolAllowed,
  readAccess,
  type TenantAccess,
} from './access';

/**
 * Граница доступа — решения штаба Р-025 и Р-029.
 *
 * Это проверка ЕДИНИЦЫ: сама функция решения. Она не доказывает, что
 * границу кто-то вызывает, — это измерено отдельно и доказуемо только на
 * уровне связки (`config.test.ts`, мутация «срок не применяется»:
 * ноль красных модульных и два красных на связке).
 */

const ALL_STATES: TenantAccess[] = [
  { state: 'allowed', symbols: new Set(['BTCUSD']) },
  { state: 'empty' },
  { state: 'unavailable', reason: 'not-configured' },
  { state: 'unavailable', reason: 'http-error' },
  { state: 'unavailable', reason: 'network' },
  { state: 'unavailable', reason: 'malformed' },
  { state: 'unavailable', reason: 'expired' },
];

describe('разбор того, что сказал источник', () => {
  it('непустой список → allowed, разрешено ровно перечисленное', () => {
    const access = readAccess(['BTCUSD', 'ETHUSD']);

    expect(access.state).toBe('allowed');
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(true);
    expect(isSymbolAllowed(access, 'XAUUSD')).toBe(false);
  });

  it('пустой список → empty, и это НЕ «списка нет»', () => {
    expect(readAccess([])).toEqual({ state: 'empty' });
  });

  it.each([
    ['поля нет вовсе', undefined],
    ['поле не массив', 'BTCUSD'],
    ['поле null', null],
    ['поле — объект', { BTCUSD: true }],
  ])('%s → unavailable:malformed, а НЕ empty', (_name, raw) => {
    // Умолчание — утверждение о том, чего мы не знаем. «Поля нет» значит
    // «источник ничего не сказал», а не «разрешено ничего»: первое чинят
    // в контракте CMS, второе — выбором инструментов владельцем.
    expect(readAccess(raw)).toEqual({ state: 'unavailable', reason: 'malformed' });
  });
});

describe('растяжки на сам барьер', () => {
  it('РАСТЯЖКА: пустой список не разрешает ничего. Fail-open тут был дефектом', () => {
    const access = readAccess([]);

    // До Р-025 пустой список давал `null`, и витрина показывала ВСЁ.
    // Мутация «вернуть fail-open на пустом списке» красит этот тест.
    for (const symbol of ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'AAPL']) {
      expect(isSymbolAllowed(access, symbol)).toBe(false);
    }
  });

  it('РАСТЯЖКА: разрешает ТОЛЬКО state === allowed', () => {
    for (const access of ALL_STATES) {
      expect(isSymbolAllowed(access, 'BTCUSD')).toBe(access.state === 'allowed');
      expect(isAccessClosed(access)).toBe(access.state !== 'allowed');
    }
  });

  it('РАСТЯЖКА: «пусто» и «недоступно» различимы, хотя запрещают одинаково', () => {
    const empty = readAccess([]);
    const down = readAccess(undefined);

    expect(empty.state).not.toBe(down.state);
    expect(isSymbolAllowed(empty, 'BTCUSD')).toBe(isSymbolAllowed(down, 'BTCUSD'));
    expect(accessNotice(empty)?.titleKey).not.toBe(accessNotice(down)?.titleKey);
  });
});

describe('закрытая граница объясняет себя', () => {
  it('РАСТЯЖКА: у каждого закрытого состояния есть объяснение, у открытого — нет', () => {
    for (const access of ALL_STATES) {
      const notice = accessNotice(access);
      if (access.state === 'allowed') {
        expect(notice).toBeNull();
        continue;
      }
      // Исчезновение без объяснения запрещено: нет состояния, в котором
      // граница закрыта, а сказать нечего (Р-025, п. 3).
      expect(notice).not.toBeNull();
      expect(notice!.titleKey).toBeTruthy();
      expect(notice!.textKey).toBeTruthy();
      expect(notice!.stripKey).toBeTruthy();
      // Состояние едет в разметку как есть, а не выводится из наличия
      // причины: «причины нет → значит пусто» снова склеило бы два
      // состояния, теперь уже в вёрстке.
      expect(notice!.state).toBe(access.state);
    }
  });

  it('РАСТЯЖКА: у каждой причины недоступности свой машинный код на экране', () => {
    const reasons = ALL_STATES.filter((a) => a.state === 'unavailable').map(
      (a) => accessNotice(a)?.reason,
    );

    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons).not.toContain(undefined);
  });

  it('у `empty` причины нет: ничего не ломалось', () => {
    expect(accessNotice(readAccess([]))?.reason).toBeUndefined();
  });
});

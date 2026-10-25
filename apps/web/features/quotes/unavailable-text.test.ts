import { describe, expect, it } from 'vitest';
import { SYMBOL_UNAVAILABLE_REASONS } from '@broker/realtime';
import { explainUnavailable } from './unavailable-text';

/**
 * WEB-38 · молчащий инструмент называет себя.
 *
 * Довод владельца: витрина без цен на семнадцати инструментах
 * **выглядит сломанной, а не ограниченной**. Причина при этом уже
 * приезжает от источника машинным именем — мы её разбирали и
 * выбрасывали.
 */

describe('у каждой причины из контракта есть свой текст', () => {
  it.each(SYMBOL_UNAVAILABLE_REASONS)('%s объяснена', (reason) => {
    const e = explainUnavailable(reason);

    expect(e.key).toBeTruthy();
    // Общая заглушка здесь означала бы, что причину назвали, а мы её
    // пересказали как «что-то техническое».
    expect(e.key).not.toBe('technical');
  });

  it('перечень не разъехался: семь причин — семь разных текстов', () => {
    const keys = SYMBOL_UNAVAILABLE_REASONS.map((r) => explainUnavailable(r).key);

    expect(new Set(keys).size).toBe(SYMBOL_UNAVAILABLE_REASONS.length);
  });
});

describe('два семейства: «пока не даём» и «у нас неполадка»', () => {
  it.each(['source-disabled', 'no-source', 'not-in-catalog'])('%s — ограничение', (r) => {
    expect(explainUnavailable(r).family).toBe('limited');
  });

  it.each(['source-silent', 'stale', 'registry-unreadable', 'threshold-unset'])(
    '%s — неполадка',
    (r) => {
      expect(explainUnavailable(r).family).toBe('fault');
    },
  );

  it('различие не пустое: оба семейства встречаются', () => {
    const families = new Set(SYMBOL_UNAVAILABLE_REASONS.map((r) => explainUnavailable(r).family));

    // Иначе «отличать одно от другого» было бы словами без следствия.
    expect(families).toEqual(new Set(['limited', 'fault']));
  });
});

describe('края', () => {
  it('«источник не упомянул символ» — своя причина, не та же, что молчание', () => {
    expect(explainUnavailable('missing').key).toBe('notMentioned');
    expect(explainUnavailable('missing').key).not.toBe(explainUnavailable('source-silent').key);
  });

  it('незнакомое имя → общий текст, и отнесено к неполадке', () => {
    // Сосед мог завести причину раньше, чем мы узнали. Относить её к
    // ограничению нельзя: о том, что это «так задумано», нам никто не
    // говорил.
    const e = explainUnavailable('cosmic-rays');

    expect(e.key).toBe('technical');
    expect(e.family).toBe('fault');
  });

  it.each([[null], [undefined]])('причины нет вовсе (%s) → общий текст', (v) => {
    expect(explainUnavailable(v).key).toBe('technical');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ draftMode: () => ({ isEnabled: false }) }));

const { hexToRgbChannels, resolvePrimaryColor } = await import('./brand');

/**
 * Фирменный цвет — данные CMS, запасного цвета в коде нет (10.11).
 *
 * Прежде `null` от CMS давал `FALLBACK_PRIMARY_COLOR = '#d4a437'` —
 * значение бренда, зашитое в код. Теперь «не задан» значит «действует
 * дизайн по умолчанию» (токен `--accent`), и это видно по `source`.
 */

describe('цвет от источника', () => {
  it('строка из CMS берётся как есть', () => {
    expect(resolvePrimaryColor('#112233')).toEqual({ color: '#112233', source: 'cms' });
    expect(hexToRgbChannels('#112233')).toBe('17 34 51');
  });
});

describe('цвета от источника нет → токены, а не цвет из кода', () => {
  it.each([
    ['null — штатное значение v2', null],
    ['поля нет вовсе', undefined],
    ['пустая строка', ''],
  ])('%s', (_name, value) => {
    expect(resolvePrimaryColor(value)).toEqual({ color: null, source: 'tokens' });
  });
});

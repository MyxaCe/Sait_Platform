import { describe, expect, it } from 'vitest';
import { adminBrandFrom, DEFAULT_ADMIN_TITLE } from './brand';

describe('adminBrandFrom', () => {
  it('без бренда — нейтральный заголовок и метка 2FA', () => {
    for (const raw of [undefined, null, '', '   ']) {
      const b = adminBrandFrom(raw);
      expect(b.name).toBeNull();
      expect(b.title).toBe(DEFAULT_ADMIN_TITLE);
      expect(b.initial).toBe('Ц');
      expect(b.totpIssuer).toBe(DEFAULT_ADMIN_TITLE);
    }
  });

  it('бренд задан — название, буква и метка 2FA из него', () => {
    const b = adminBrandFrom('  ostrix   Markets ');
    expect(b.name).toBe('ostrix Markets');
    expect(b.title).toBe('ostrix Markets');
    expect(b.initial).toBe('O');
    expect(b.totpIssuer).toBe('ostrix Markets Admin');
  });

  it('обрезает слишком длинное название', () => {
    expect(adminBrandFrom('x'.repeat(100)).title).toHaveLength(40);
  });
});

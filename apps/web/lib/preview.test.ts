import { describe, expect, it } from 'vitest';
import { sanitizeRedirectPath } from './preview';

describe('sanitizeRedirectPath (защита от open redirect)', () => {
  it('пропускает внутренние пути', () => {
    expect(sanitizeRedirectPath('/promotions')).toBe('/promotions');
    expect(sanitizeRedirectPath('/en/legal/terms')).toBe('/en/legal/terms');
  });

  it('режет внешние и мусорные адреса в /', () => {
    expect(sanitizeRedirectPath('https://evil.example')).toBe('/');
    expect(sanitizeRedirectPath('//evil.example')).toBe('/');
    expect(sanitizeRedirectPath('/x/https://evil.example')).toBe('/');
    expect(sanitizeRedirectPath(null)).toBe('/');
    expect(sanitizeRedirectPath('relative')).toBe('/');
  });
});

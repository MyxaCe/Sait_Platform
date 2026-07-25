import { describe, expect, it } from 'vitest';
import { requestOrigin, sanitizeRedirectPath } from './preview';

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

describe('requestOrigin (B-015: origin глазами браузера, не сервера)', () => {
  it('берёт Host из запроса', () => {
    const headers = new Headers({ host: 'localhost:3000' });
    expect(requestOrigin(headers, 'http://0.0.0.0:3000')).toBe('http://localhost:3000');
  });

  it('за прокси доверяет X-Forwarded-*', () => {
    const headers = new Headers({
      host: 'web:3000',
      'x-forwarded-host': 'broker.example',
      'x-forwarded-proto': 'https',
    });
    expect(requestOrigin(headers, 'http://0.0.0.0:3000')).toBe('https://broker.example');
  });

  it('без Host падает в fallback', () => {
    expect(requestOrigin(new Headers(), 'http://fallback:3000')).toBe('http://fallback:3000');
  });
});

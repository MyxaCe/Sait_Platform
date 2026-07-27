import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './scrubbing.js';

describe('scrubSentryEvent', () => {
  it('вырезает чувствительные заголовки', () => {
    const e = scrubSentryEvent({
      request: { headers: { Authorization: 'Bearer x', Cookie: 'a=b', 'X-API-Key': 'k', Accept: 'json' } },
    });
    const h = (e.request as any).headers;
    expect(h.Authorization).toBeUndefined();
    expect(h.Cookie).toBeUndefined();
    expect(h['X-API-Key']).toBeUndefined();
    expect(h.Accept).toBe('json');
  });

  it('маскирует чувствительные query-параметры', () => {
    const e = scrubSentryEvent({
      request: { query_string: 'page=2&token=secret&email=a@b.com&site=apex-ru' },
    });
    const q = (e.request as any).query_string as string;
    expect(q).toContain('page=2');
    expect(q).toContain('site=apex-ru');
    expect(q).toContain('token=[scrubbed]');
    expect(q).toContain('email=[scrubbed]');
  });

  it('не прикладывает тела критичных путей (/api/leads)', () => {
    const e = scrubSentryEvent({
      request: { url: 'http://site/api/leads/register', data: { email: 'a@b.com', accountType: 'pro' } },
    });
    expect((e.request as any).data).toBeUndefined();
  });

  it('для прочих путей оставляет только allowlist-поля', () => {
    const e = scrubSentryEvent({
      request: { url: 'http://site/api/other', data: { accountType: 'pro', email: 'a@b.com', phone: '+700', locale: 'ru' } },
    });
    expect((e.request as any).data).toEqual({ accountType: 'pro', locale: 'ru' });
  });

  it('user-контекст сводит к idHash', () => {
    const e = scrubSentryEvent({ user: { id: '42', email: 'a@b.com', idHash: 'deadbeef' } });
    expect(e.user).toEqual({ idHash: 'deadbeef' });
  });

  it('regex-вычистка ловит email/телефон/карту в сообщениях', () => {
    const e = scrubSentryEvent({
      message: 'fail for ivan.petrov@example.com phone +7 900 123-45-67 card 4111 1111 1111 1111',
    });
    const m = e.message as string;
    expect(m).not.toContain('ivan.petrov@example.com');
    expect(m).not.toContain('4111 1111 1111 1111');
    expect(m).toContain('[scrubbed]');
  });
});

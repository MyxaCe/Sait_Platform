import { describe, expect, it } from 'vitest';
import { isNarrowRole, scopeViolation } from './role-scope';
import { navForRole } from '@/components/shell/nav-registry';

/**
 * support_operator: периметр — только «Поддержка». Клиенты, KYC, AML, деньги,
 * журнал, настройки — закрыты на входе (редирект / 403), а не только скрыты
 * из рельса. Прочие роли не затронуты.
 */
describe('узкий периметр роли поддержки', () => {
  it('страницы вне /support закрыты, /support и вложенные — открыты', () => {
    for (const p of ['/', '/clients', '/clients/x', '/kyc/u1', '/aml', '/money', '/journal', '/settings', '/operators', '/risk/leverage']) {
      expect(scopeViolation('support_operator', p)?.home).toBe('/support');
    }
    for (const p of ['/support', '/support/1042', '/support/templates', '/enroll', '/api/support/attachments/x']) {
      expect(scopeViolation('support_operator', p)).toBeNull();
    }
    // Похожий префикс — не обход.
    expect(scopeViolation('support_operator', '/supportx')).not.toBeNull();
  });

  it('прочие роли периметром не ограничены', () => {
    for (const r of ['admin', 'operator', 'finance_operator'] as const) {
      expect(scopeViolation(r, '/money')).toBeNull();
      expect(isNarrowRole(r)).toBe(false);
    }
    expect(isNarrowRole('support_operator')).toBe(true);
  });

  it('рельс support_operator — только «Поддержка»', () => {
    expect(navForRole('support_operator').map((i) => i.key)).toEqual(['support']);
  });
});

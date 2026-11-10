import { describe, expect, it } from 'vitest';
import {
  ALL_ROLES,
  SECTION_KEYS,
  SECTIONS,
  canAccessPath,
  canAccessSection,
  canViewKycDocuments,
  homeFor,
  sectionHome,
  sectionOfPath,
  type SectionKey,
} from '@/components/shell/sections';
import { NAV_ITEMS, navForRole } from '@/components/shell/nav-registry';
import type { OperatorRole } from './session';
import { scopeViolation } from './role-scope';
import { canOperateMoney } from '../crypto/runtime';
import { canViewPromo } from '../promo/runtime';

/**
 * Матрица «раздел → роли» (волна 3): КАЖДАЯ роль × КАЖДЫЙ раздел. Ожидание
 * записано здесь явно, а не выведено из SECTIONS, — иначе тест подтверждал бы
 * сам себя. Расширили матрицу — правьте обе таблицы осознанно.
 */
const EXPECTED: Record<OperatorRole, SectionKey[]> = {
  admin: ['dashboard', 'clients', 'kyc', 'aml', 'support', 'risk', 'journal', 'operators', 'money', 'promo', 'settings'],
  operator: ['dashboard', 'clients', 'kyc', 'aml', 'support', 'risk', 'journal'],
  finance_operator: ['dashboard', 'clients', 'support', 'journal', 'money', 'promo'],
  support_operator: ['support'],
};

/** Пример адреса страницы внутри раздела (вложенный — проверка префикса). */
const SAMPLE_PATH: Record<SectionKey, string[]> = {
  dashboard: ['/'],
  clients: ['/clients', '/clients/00000000-0000-4000-8000-0000000c0001'],
  kyc: ['/kyc', '/kyc/u1'],
  aml: ['/aml', '/aml/u1'],
  support: ['/support', '/support/1042', '/support/settings', '/api/support/attachments/x'],
  risk: ['/risk/leverage', '/risk/portfolios'],
  journal: ['/journal'],
  operators: ['/operators'],
  money: ['/money'],
  promo: ['/promo', '/promo/queue', '/promo/new'],
  settings: ['/settings'],
};

describe('матрица доступа: роль × раздел', () => {
  for (const role of ALL_ROLES) {
    for (const key of SECTION_KEYS) {
      const allowed = EXPECTED[role].includes(key);
      it(`${role} → ${key}: ${allowed ? 'открыт' : 'закрыт'}`, () => {
        expect(canAccessSection(role, key)).toBe(allowed);
        for (const p of SAMPLE_PATH[key]) {
          expect(sectionOfPath(p)).toBe(key);
          expect(canAccessPath(role, p)).toBe(allowed);
          // Middleware: закрытый путь → редирект на домашнюю роли, открытый → null.
          const v = scopeViolation(role, p);
          if (allowed) expect(v).toBeNull();
          else expect(v?.home).toBe(homeFor(role));
        }
        // Рельс = та же матрица: пункт есть ⇔ раздел открыт.
        expect(navForRole(role).some((i) => i.key === key)).toBe(allowed);
      });
    }
  }

  it('у каждого раздела есть пункт рельса, и его роли — ровно из матрицы', () => {
    expect(NAV_ITEMS.map((i) => i.key).sort()).toEqual([...SECTION_KEYS].sort());
    for (const item of NAV_ITEMS) {
      expect(item.roles).toBe(SECTIONS[item.key].roles);
      expect(item.href).toBe(sectionHome(item.key));
      expect(sectionOfPath(item.href)).toBe(item.key);
    }
  });

  it('меню finance_operator: дашборд, клиенты, поддержка (назначенные), журнал, деньги, акции', () => {
    expect(navForRole('finance_operator').map((i) => i.key)).toEqual([
      'dashboard',
      'clients',
      'support',
      'journal',
      'money',
      'promo',
    ]);
  });

  it('рельс support_operator — только «Поддержка»; домашняя — /support', () => {
    expect(navForRole('support_operator').map((i) => i.key)).toEqual(['support']);
    expect(homeFor('support_operator')).toBe('/support');
  });

  it('домашняя каждой роли ей открыта (нет петли редиректа)', () => {
    for (const role of ALL_ROLES) {
      expect(canAccessPath(role, homeFor(role))).toBe(true);
    }
  });

  it('неизвестный путь закрыт для всех, кроме admin (fail-closed)', () => {
    for (const p of ['/brand-new-section', '/api/whatever', '/clientsx', '/supportx']) {
      expect(sectionOfPath(p)).toBeNull();
      expect(canAccessPath('admin', p)).toBe(true);
      for (const r of ['operator', 'finance_operator', 'support_operator'] as const) {
        expect(canAccessPath(r, p)).toBe(false);
      }
    }
  });

  it('общие пути (2FA, health) открыты всем ролям', () => {
    for (const r of ALL_ROLES) {
      expect(canAccessPath(r, '/enroll')).toBe(true);
      expect(canAccessPath(r, '/api/health')).toBe(true);
    }
  });

  it('KYC-документы: только admin и operator; без роли — нет', () => {
    expect(ALL_ROLES.filter((r) => canViewKycDocuments(r))).toEqual(['admin', 'operator']);
    expect(canViewKycDocuments(null)).toBe(false);
    expect(canViewKycDocuments(undefined)).toBe(false);
  });

  it('гейты денег и акций совпадают с матрицей', () => {
    for (const r of ALL_ROLES) {
      expect(canOperateMoney(r)).toBe(canAccessSection(r, 'money'));
      expect(canViewPromo(r)).toBe(canAccessSection(r, 'promo'));
    }
  });
});

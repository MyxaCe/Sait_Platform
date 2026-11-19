import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, navForRole } from '@/components/shell/nav-registry';
import { attentionBadgeText } from './attention-badge';

describe('кружок «Поддержка» в меню', () => {
  it('0 и мусор — кружка нет; до 99 — число; больше — 99+', () => {
    expect(attentionBadgeText(0)).toBeNull();
    expect(attentionBadgeText(null)).toBeNull();
    expect(attentionBadgeText(Number.NaN)).toBeNull();
    expect(attentionBadgeText(-3)).toBeNull();
    expect(attentionBadgeText(1)).toBe('1');
    expect(attentionBadgeText(99)).toBe('99');
    expect(attentionBadgeText(100)).toBe('99+');
  });

  it('пункт со счётчиком есть только у ролей с доступом к поддержке', () => {
    const support = NAV_ITEMS.find((i) => i.key === 'support')!;
    for (const role of ['admin', 'operator', 'finance_operator', 'support_operator'] as const) {
      expect(navForRole(role).some((i) => i.key === 'support')).toBe(support.roles.includes(role));
    }
  });
});

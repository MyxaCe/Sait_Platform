import { describe, expect, it } from 'vitest';
import { TRANSFER_ACTIONS } from '@broker/transfer';
import { ACTION_LABELS, actionGroup } from '../journal/labels';
import { canAccessPath } from '@/components/shell/sections';
import { API_PUBLIC_PATHS } from '../auth/constants';
import { transferErrorText } from './labels';

describe('переводы между платформами: подписи и доступ', () => {
  it('у каждого кода журнала перевода есть подпись в группе «transfers»', () => {
    for (const code of [...Object.values(TRANSFER_ACTIONS), 'platform.group_registry.upserted']) {
      expect(ACTION_LABELS[code], code).toBeDefined();
      expect(actionGroup(code)).toBe('transfers');
    }
  });

  it('страницы переводов — в разделе «Клиенты»; приёмник канала — явный публичный /api', () => {
    expect(canAccessPath('operator', '/clients/transfers')).toBe(true);
    expect(canAccessPath('support_operator', '/clients/transfers')).toBe(false);
    expect(API_PUBLIC_PATHS).toContain('/api/platform-transfer/v1/messages');
  });

  it('отказ направления раскрывается по кодам', () => {
    expect(transferErrorText('directionForbidden', 'countryForbidden')).toContain('страна клиента запрещена');
    expect(transferErrorText('ticketOpenedByOperator')).toContain('открыт оператором');
  });
});

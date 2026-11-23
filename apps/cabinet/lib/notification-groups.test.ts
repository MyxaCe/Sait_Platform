import { describe, expect, it } from 'vitest';
import { countByGroup, notificationGroup, parseGroupFilter } from './notification-groups';

describe('группы уведомлений', () => {
  it('раскладывает известные типы по группам, неизвестные — в «Прочее»', () => {
    expect(notificationGroup('tradeExecuted')).toBe('trading');
    expect(notificationGroup('marginCalled')).toBe('trading');
    expect(notificationGroup('welcome')).toBe('account');
    expect(notificationGroup('documentUploaded')).toBe('account');
    expect(notificationGroup('supportReply')).toBe('support');
    expect(notificationGroup('somethingNew')).toBe('other');
  });

  it('фильтр из адреса: только известные значения, иначе «Все»', () => {
    expect(parseGroupFilter('trading')).toBe('trading');
    expect(parseGroupFilter('other')).toBe('other');
    expect(parseGroupFilter(undefined)).toBe('all');
    expect(parseGroupFilter('<script>')).toBe('all');
  });

  it('считает по группам', () => {
    expect(countByGroup(['welcome', 'tradeExecuted', 'tradeExecuted', 'x'])).toEqual({
      trading: 2,
      account: 1,
      support: 0,
      other: 1,
    });
  });
});

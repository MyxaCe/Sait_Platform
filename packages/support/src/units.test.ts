import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, isWithinHours } from './hours';
import { buildAttachmentKey, buildRawMailKey } from './keys';
import { DEFAULT_SUPPORT_SETTINGS, describeHours, parseSupportSettings, validateSettings, type SupportSettings } from './settings';
import {
  normalizeMessageId,
  renderTemplate,
  replySubject,
  stripQuotedReply,
  subjectWithTag,
  threadTokenFromAddress,
  ticketNumberFromSubject,
} from './text';

const UTC: SupportSettings = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, timezone: 'UTC' } };

describe('рабочие часы и SLA', () => {
  it('в часы / вне часов / выходной / праздник', () => {
    expect(isWithinHours(UTC, new Date('2026-11-10T10:00:00Z'))).toBe(true); // вт
    expect(isWithinHours(UTC, new Date('2026-11-10T21:00:00Z'))).toBe(false); // закрытие
    expect(isWithinHours(UTC, new Date('2026-11-14T12:00:00Z'))).toBe(false); // сб
    const hol = { ...UTC, hours: { ...UTC.hours, holidays: ['2026-11-10'] } };
    expect(isWithinHours(hol, new Date('2026-11-10T10:00:00Z'))).toBe(false);
  });

  it('SLA считает только рабочие минуты: пятница 20:50 + 15 мин → понедельник 09:05', () => {
    const due = addBusinessMinutes(UTC, new Date('2026-11-13T20:50:00Z'), 15);
    expect(due.toISOString()).toBe('2026-11-16T09:05:00.000Z');
  });

  it('часовой пояс учитывается: Москва 09:00 = 06:00 UTC', () => {
    const msk = DEFAULT_SUPPORT_SETTINGS; // Europe/Moscow
    const due = addBusinessMinutes(msk, new Date('2026-11-10T03:00:00Z'), 30); // 06:00 МСК, до открытия
    expect(due.toISOString()).toBe('2026-11-10T06:30:00.000Z');
  });

  it('круглосуточно — просто плюс минуты', () => {
    const always = { ...UTC, hours: { ...UTC.hours, alwaysOpen: true } };
    expect(addBusinessMinutes(always, new Date('2026-11-14T12:00:00Z'), 15).toISOString()).toBe('2026-11-14T12:15:00.000Z');
  });

  it('подпись часов для текстов', () => {
    expect(describeHours(DEFAULT_SUPPORT_SETTINGS, 'ru')).toBe('пн–пт 09:00–21:00 (Europe/Moscow)');
    expect(describeHours({ ...UTC, hours: { ...UTC.hours, alwaysOpen: true } }, 'en')).toBe('24/7');
  });
});

describe('настройки: мягкое чтение, строгая запись', () => {
  it('мусор и неизвестные ключи → умолчания; верные значения сохраняются', () => {
    const s = parseSupportSettings({
      channels: { chat: false, email: 'yes' },
      hours: { timezone: 'Mars/Olympus', week: { mon: { open: '10:00', close: '09:00' }, sat: { open: '10:00', close: '14:00' } } },
      sla: { chatFirstResponseMinutes: 5 },
      unknown: 1,
    });
    expect(s.channels).toEqual({ chat: false, webForm: true, email: true });
    expect(s.hours.timezone).toBe('Europe/Moscow');
    expect(s.hours.week.mon).toEqual({ open: '09:00', close: '21:00' });
    expect(s.hours.week.sat).toEqual({ open: '10:00', close: '14:00' });
    expect(s.sla.chatFirstResponseMinutes).toBe(5);
    expect(s).not.toHaveProperty('unknown');
    expect(parseSupportSettings(null)).toEqual(DEFAULT_SUPPORT_SETTINGS);
  });

  it('то, что прошло строгую проверку, читается обратно без подмен', () => {
    const s = { ...DEFAULT_SUPPORT_SETTINGS, autoCloseDays: 3, mail: { fromName: 'Wholesalefy Support' } };
    expect(validateSettings(s)).toEqual([]);
    expect(parseSupportSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('строгая проверка: кривой пояс, нет рабочих дней, пустой текст', () => {
    const bad: SupportSettings = {
      ...DEFAULT_SUPPORT_SETTINGS,
      hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, timezone: 'Nope/Zone', week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      texts: { ...DEFAULT_SUPPORT_SETTINGS.texts, ru: { ...DEFAULT_SUPPORT_SETTINGS.texts.ru, greeting: ' ' } },
    };
    expect(validateSettings(bad).map((e) => e.code)).toEqual(expect.arrayContaining(['invalidTimezone', 'noWorkingDays', 'required']));
  });
});

describe('текст и почтовые заголовки', () => {
  it('шаблон: переменные подставляются, неизвестная остаётся видимой', () => {
    expect(renderTemplate('Здравствуйте, {{client.firstName}}! #{{ticket.number}} {{x.y}}', { client: { firstName: 'Анна' }, ticket: { number: 1042 } })).toBe(
      'Здравствуйте, Анна! #1042 {{x.y}}',
    );
  });

  it('тема: метка номера без накопления Re: и меток', () => {
    expect(subjectWithTag('Вопрос', 1042)).toBe('Вопрос [#1042]');
    expect(replySubject('Re: RE: Вопрос [#1042]', 1042)).toBe('Re: Вопрос [#1042]');
    expect(ticketNumberFromSubject('Re: Вопрос [#1042]')).toBe(1042);
    expect(ticketNumberFromSubject('без метки')).toBeNull();
  });

  it('Message-ID нормализуется, plus-адрес разбирается', () => {
    expect(normalizeMessageId(' abc@x ')).toBe('<abc@x>');
    expect(normalizeMessageId('<abc@x>')).toBe('<abc@x>');
    expect(normalizeMessageId('')).toBeNull();
    expect(threadTokenFromAddress(['Support+abcdef0123456789abcdef01@Wholesalefy.com'], 'support@wholesalefy.com')).toBe(
      'abcdef0123456789abcdef01',
    );
    expect(threadTokenFromAddress(['support@wholesalefy.com'], 'support@wholesalefy.com')).toBeNull();
  });

  it('цитата отрезается (en/ru/Outlook), пустой результат — исходный текст', () => {
    expect(stripQuotedReply('Да, спасибо\n\nOn Mon, 9 Nov 2026, Support <s@x> wrote:\n> старое')).toBe('Да, спасибо');
    expect(stripQuotedReply('Готово\n\n10.11.2026, 12:00, Поддержка пишет:\n> старое')).toBe('Готово');
    expect(stripQuotedReply('Ок\n-----Original Message-----\nFrom: s@x')).toBe('Ок');
    expect(stripQuotedReply('> только цитата')).toBe('> только цитата');
  });

  it('ключи объектов: сегменты проверяются (fail-closed)', () => {
    expect(buildAttachmentKey('apex-ru', 't1', 'u1')).toBe('support/apex-ru/t1/u1');
    expect(buildRawMailKey('apex-ru', new Date('2026-11-10T00:00:00Z'), 'u1')).toBe('support-raw/apex-ru/2026-11/u1.eml');
    expect(() => buildAttachmentKey('../x', 't', 'u')).toThrow();
    expect(() => buildAttachmentKey('a', '', 'u')).toThrow();
  });
});

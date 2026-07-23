import { describe, expect, it } from 'vitest';
import { registerLeadSchema } from './schema';

const validLead = {
  firstName: 'Иван',
  lastName: 'Петров',
  email: 'ivan@example.com',
  phone: '+7 900 123-45-67',
  country: 'RU',
  accountType: 'pro',
  agreeTerms: true,
};

describe('registerLeadSchema', () => {
  it('принимает корректную заявку', () => {
    expect(registerLeadSchema.safeParse(validLead).success).toBe(true);
  });

  it('отклоняет некорректный email с ключом перевода', () => {
    const result = registerLeadSchema.safeParse({ ...validLead, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Сообщение — ключ из namespace validation, перевод происходит в UI
      expect(result.error.issues[0]?.message).toBe('invalidEmail');
    }
  });

  it('требует согласия с условиями', () => {
    const result = registerLeadSchema.safeParse({ ...validLead, agreeTerms: false });
    expect(result.success).toBe(false);
  });

  it('отклоняет слишком короткий телефон', () => {
    expect(registerLeadSchema.safeParse({ ...validLead, phone: '123' }).success).toBe(false);
  });

  it('отклоняет неизвестный тип счёта', () => {
    expect(registerLeadSchema.safeParse({ ...validLead, accountType: 'vip' }).success).toBe(false);
  });

  it('обрезает пробелы в имени', () => {
    const result = registerLeadSchema.safeParse({ ...validLead, firstName: '  Иван  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.firstName).toBe('Иван');
  });
});

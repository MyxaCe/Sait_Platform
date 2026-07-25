import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema, registerSchema } from './schemas';

const validRegister = {
  firstName: 'Иван',
  lastName: 'Петров',
  email: 'ivan@example.com',
  phone: '+35725000000',
  country: 'Кипр',
  accountType: 'standard',
  password: 'secret1234',
  locale: 'ru',
  website: '',
};

describe('registerSchema', () => {
  it('пропускает корректную заявку', () => {
    expect(registerSchema.safeParse(validRegister).success).toBe(true);
  });

  it('honeypot: заполненное поле website — отказ', () => {
    expect(registerSchema.safeParse({ ...validRegister, website: 'http://spam' }).success).toBe(false);
  });

  it('короткий пароль — ключ passwordTooShort', () => {
    const r = registerSchema.safeParse({ ...validRegister, password: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('passwordTooShort');
    }
  });
});

describe('loginSchema', () => {
  it('требует email и пароль', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x', website: '' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'not-email', password: 'x' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('несовпадение паролей — passwordsMismatch на confirmPassword', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'newpassword1',
      confirmPassword: 'different1',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path[0]).toBe('confirmPassword');
      expect(r.error.issues[0]?.message).toBe('passwordsMismatch');
    }
  });
});

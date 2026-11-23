import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Регрессия 23.11: поле «Пароль» шага 1 и поле «Код подтверждения» шага 2 стояли
// на одной позиции дерева, React переиспользовал DOM-input, и введённый пароль
// показывался открытым текстом в поле кода. Шаги обязаны быть разными ветками (key),
// а поле кода — открываться пустым.
const src = readFileSync(join(__dirname, 'LoginForm.tsx'), 'utf8');

describe('LoginForm: шаги не делят одно поле ввода', () => {
  it('у веток шага пароля и шага кода разные key', () => {
    expect(src).toMatch(/<Fragment key="totp">/);
    expect(src).toMatch(/<Fragment key="password">/);
  });

  it('поле кода открывается пустым и ждёт одноразовый код', () => {
    const code = src.slice(src.indexOf('id="code"'), src.indexOf('/>', src.indexOf('id="code"')));
    expect(code).toContain('defaultValue=""');
    expect(code).toContain('autoComplete="one-time-code"');
    expect(code).toContain('maxLength={6}');
  });
});

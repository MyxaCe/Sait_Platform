/**
 * Человекочитаемые подписи машинных причин отказа провижининга (ADM-04).
 * Один словарь на все три действия — причины у `lib/operators` машинные,
 * человеку их смысл показывает UI.
 */
export const OPERATOR_ERRORS: Record<string, string> = {
  forbidden: 'Недостаточно прав: экран операторов — только для роли admin.',
  invalidSubject: 'Оператор не указан.',
  invalidRole: 'Недопустимая роль.',
  missingFields: 'Заполните логин и имя.',
  missingReason: 'Укажите основание — оно уходит в журнал.',
  weakPassword: 'Пароль слишком короткий (минимум 12 символов).',
  loginTaken: 'Логин уже занят другим оператором.',
  selfDisable: 'Нельзя отключить самого себя (иначе запрёте собственный вход).',
  notActive: 'Оператор уже отключён.',
  selfRoleChange: 'Нельзя менять собственную роль.',
  notFound: 'Оператор не найден.',
  noChange: 'Роль не изменилась — менять нечего.',
};

export function operatorErrorText(code: string | undefined): string {
  if (!code) return '';
  return OPERATOR_ERRORS[code] ?? 'Действие не применено.';
}

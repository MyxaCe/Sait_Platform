import type { OperatorRole } from '@/lib/auth/session';

export const ROLES: OperatorRole[] = ['operator', 'finance_operator', 'support_operator', 'admin'];

export const ROLE_LABEL: Record<OperatorRole, string> = {
  admin: 'Администратор',
  operator: 'Оператор',
  finance_operator: 'Финансовый оператор',
  support_operator: 'Оператор поддержки',
};

export const ROLE_SCOPE: Record<OperatorRole, string> = {
  operator: 'Клиенты, верификация, AML, журнал; риск — только просмотр.',
  finance_operator: 'Деньги: пополнения, неопознанные поступления, выводы.',
  support_operator: 'Поддержка: очередь обращений и переписка; контекст клиента без сумм, адресов и KYC-документов.',
  admin: 'Всё, включая операторов, настройки платформы, плечо и блокировки.',
};

export const MANAGER_SCOPE =
  'Флаг поверх роли оператора, финансиста или администратора: за ним закрепляют клиентов, у него «Мои клиенты» в реестре и на дашборде. Доступ к разделам не расширяет.';

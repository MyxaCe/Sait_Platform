import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { TopBar } from '@/components/shell/TopBar';
import { NavRail } from '@/components/shell/NavRail';
import { navForRole } from '@/components/shell/nav-registry';

/**
 * Защищённая зона. Авторитетный гейт — middleware (Р-395): он уже не пустил
 * бы сюда запрос без валидной операторской сессии. Эта проверка — defence-in-
 * depth и источник имени оператора для шапки. Если сессии нет (например,
 * middleware обошли) — редирект на вход, fail-closed (Р-394).
 *
 * **Обязательный второй фактор (ADM-13, Р-454 III-3).** Оператор без включённой
 * 2FA (в т.ч. суперадмин, вошедший по паролю «с первого дня») заворачивается на
 * `/enroll` и не видит ни одного рабочего модуля, пока не включит TOTP. Петли
 * нет: `/enroll` живёт ВНЕ этого layout. Источник истины — база (а не claim в
 * JWT): включил 2FA в этой же сессии — следующий переход уже проходит.
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (!(await isOperatorEnrolled(operator.operatorId))) redirect('/enroll');

  // Роль-гейт рельса — на сервере (fail-closed, Р-394): клиент не получает
  // пунктов, скрытых для роли.
  const navItems = navForRole(operator.role);

  return (
    <div className="flex min-h-svh flex-col">
      <TopBar operator={operator} />
      <div className="flex flex-1 overflow-hidden">
        <NavRail items={navItems} />
        <main className="flex-1 overflow-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

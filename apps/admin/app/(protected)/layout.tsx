import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { TopBar } from '@/components/shell/TopBar';
import { NavRail } from '@/components/shell/NavRail';
import { navForRole } from '@/components/shell/nav-registry';
import { enrollmentGate } from '@/lib/auth/enrollment-gate';
import { ServiceUnavailable } from '@/components/shell/ServiceUnavailable';

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
  // База не ответила на проверку 2FA — fail-closed: внутрь не пускаем, но
  // отказываем страницей «временно недоступен», а не необработанной ошибкой.
  const gate = await enrollmentGate(operator.operatorId, isOperatorEnrolled);
  if (gate === 'unavailable') return <ServiceUnavailable />;
  if (gate === 'enroll') redirect('/enroll');

  // Роль-гейт рельса — на сервере (fail-closed, Р-394): клиент не получает
  // пунктов, скрытых для роли.
  const navItems = navForRole(operator.role);

  return (
    <div className="flex min-h-svh">
      <NavRail items={navItems} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar operator={operator} />
        <main className="flex-1 px-6 py-6 xl:px-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

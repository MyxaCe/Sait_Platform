import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';

/**
 * Защищённая зона. Авторитетный гейт — middleware (Р-395): он уже не пустил
 * бы сюда запрос без валидной операторской сессии. Эта проверка — defence-in-
 * depth и источник имени оператора для шапки. Если сессии нет (например,
 * middleware обошли) — редирект на вход, fail-closed (Р-394).
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-elevated px-6">
        <span className="font-semibold">Центр управления</span>
        <span className="text-sm text-secondary">
          {operator.displayName}
          <span className="ml-2 rounded bg-accent/20 px-2 py-0.5 text-xs uppercase text-accent">
            {operator.role}
          </span>
        </span>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

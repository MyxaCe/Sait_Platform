import { LoginForm } from './LoginForm';

/**
 * Публичная страница входа оператора (ADM-01, пакет C). Заглушку сменила
 * настоящая форма: проверка логина и пароля по таблице `operators` (argon2id),
 * `disabled_at IS NULL`, выпуск операторской сессии — в `loginAction`.
 *
 * Поверхность закрыта по умолчанию (Р-394): без выпущенной сессии внутрь не
 * пускают, и единственный вход сюда — через эту форму.
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Центр управления</h1>
          <p className="text-sm text-secondary">Доступ только для операторов.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

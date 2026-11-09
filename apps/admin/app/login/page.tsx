import { AuthShell } from './AuthShell';
import { LoginForm } from './LoginForm';

/**
 * Публичная страница входа оператора (ADM-01, пакет C). Проверка логина и
 * пароля по таблице `operators` (argon2id), `disabled_at IS NULL`, выпуск
 * операторской сессии — в `loginAction`.
 *
 * Поверхность закрыта по умолчанию (Р-394): без выпущенной сессии внутрь не
 * пускают, и единственный вход сюда — через эту форму.
 */
export default function LoginPage() {
  return (
    <AuthShell
      title="Вход в центр управления"
      description="Только для операторов платформы."
    >
      <LoginForm />
    </AuthShell>
  );
}

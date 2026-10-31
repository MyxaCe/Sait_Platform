import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { EnrollForm } from './EnrollForm';

/**
 * Обязательная регистрация второго фактора (ADM-13, Р-454 III-3).
 *
 * Страница ВНЕ группы `(protected)` намеренно: её layout заворачивает всех
 * незарегистрированных сюда, и будь `/enroll` под ним — вышла бы петля
 * редиректов. Но гейт не ослаблен: middleware требует валидную сессию для
 * `/enroll` так же, как для любой закрытой страницы (в PUBLIC_PATHS её нет).
 *
 * Суперадмин «с первого дня» (Р-454): он вошёл по паролю без 2FA и попал сюда
 * принудительно — работать в центре управления нельзя, пока второй фактор не
 * включён. Это не тихий обход, а обязательный enroll.
 */
export default async function EnrollPage() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  // Уже включена — здесь делать нечего, внутрь.
  if (await isOperatorEnrolled(operator.operatorId)) redirect('/');

  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Настройка двухфакторной аутентификации</h1>
          <p className="text-sm text-secondary">
            Вход в центр управления требует второй фактор. Добавьте аккаунт в
            приложение-аутентификатор (Google Authenticator, 1Password, Aegis и т.п.) и
            подтвердите кодом.
          </p>
        </div>
        <EnrollForm />
      </div>
    </div>
  );
}

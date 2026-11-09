import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { enrollmentGate } from '@/lib/auth/enrollment-gate';
import { ServiceUnavailable } from '@/components/shell/ServiceUnavailable';
import { AuthShell } from '../login/AuthShell';
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
  const gate = await enrollmentGate(operator.operatorId, isOperatorEnrolled);
  if (gate === 'unavailable') return <ServiceUnavailable />;
  if (gate === 'ok') redirect('/');

  return (
    <AuthShell
      step={`Обязательная настройка · ${operator.displayName} (${operator.login})`}
      title="Включите второй фактор"
      description="Без кода из приложения-аутентификатора работать в центре управления нельзя. Это займёт минуту."
    >
      <EnrollForm />
    </AuthShell>
  );
}

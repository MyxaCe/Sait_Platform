import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { enrollmentGate } from '@/lib/auth/enrollment-gate';
import { ServiceUnavailable } from '@/components/shell/ServiceUnavailable';
import { AuthShell } from '../login/AuthShell';
import { EnrollForm } from './EnrollForm';

export default async function EnrollPage() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
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

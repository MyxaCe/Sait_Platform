import { AuthShell } from './AuthShell';
import { LoginForm } from './LoginForm';

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

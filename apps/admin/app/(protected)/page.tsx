import Link from 'next/link';
import { getOperatorSession } from '@/lib/auth/current';

/**
 * Защищённая домашняя страница. Доказывает, что гейт работает (без валидной
 * сессии сюда не попасть), и даёт вход в рабочие модули — пока KYC-проверка
 * клиентов (ADM-08).
 */
export default async function ControlCenterHome() {
  // Сессия здесь гарантирована layout-ом; читаем ради имени.
  const operator = await getOperatorSession();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Центр управления</h1>
      <p className="text-secondary">
        Вы вошли как <strong className="text-primary">{operator?.displayName}</strong>. Поверхность
        управления (ADM-01). Рабочие модули:
      </p>
      <ul className="space-y-2">
        <li>
          <Link
            href="/kyc"
            className="flex items-center justify-between rounded border border-border bg-elevated px-4 py-3 hover:bg-accent/5"
          >
            <span className="font-medium text-primary">Проверка клиентов (KYC)</span>
            <span className="text-sm text-secondary">очередь ожидающих решения →</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

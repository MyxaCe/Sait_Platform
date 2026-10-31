import { getOperatorSession } from '@/lib/auth/current';

/**
 * Защищённая страница-заглушка. Доказывает, что гейт работает: без валидной
 * операторской сессии сюда не попасть (middleware уводит на `/login`), с
 * сессией — видно имя вошедшего оператора. Функций (KYC, журнал, клиенты)
 * здесь нет — это пакеты C/D.
 */
export default async function ControlCenterHome() {
  // Сессия здесь гарантирована layout-ом; читаем ради имени.
  const operator = await getOperatorSession();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Центр управления</h1>
      <p className="text-secondary">
        Вы вошли как <strong className="text-primary">{operator?.displayName}</strong>. Это каркас
        поверхности управления (ADM-01). Рабочие модули появятся отдельными задачами.
      </p>
    </div>
  );
}

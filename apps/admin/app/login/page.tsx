/**
 * Публичная страница входа — ЗАГЛУШКА. Формы логина оператора в каркасе нет
 * (её несёт пакет C: проверка пароля по таблице `operators` и выпуск сессии).
 * Здесь сказано честно: поверхность закрыта по умолчанию, и без выпущенной
 * операторской сессии внутрь не пускают (Р-394).
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Центр управления</h1>
        <p className="text-sm text-secondary">
          Доступ только для операторов. Вход закрыт по умолчанию — форма входа появится в
          следующей задаче (пакет C).
        </p>
      </div>
    </div>
  );
}

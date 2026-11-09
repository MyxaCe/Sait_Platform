/**
 * Отказ каркаса при сбое источника (база не ответила на проверку оператора).
 * Fail-closed: разделы НЕ отрисованы; показываем спокойное объяснение без
 * технических деталей и путь «повторить». Без рельса и шапки — данных для них
 * (роль, 2FA) мы честно не подтвердили.
 */
export function ServiceUnavailable() {
  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="border-border bg-card w-full max-w-md space-y-4 rounded-lg border p-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="bg-accent text-on-accent flex size-7 items-center justify-center rounded-md text-[13px] font-bold"
          >
            W
          </span>
          <span className="text-muted text-xs">Центр управления</span>
        </div>
        <div role="alert" className="space-y-1.5">
          <h1 className="text-primary text-lg font-semibold">Сервис временно недоступен</h1>
          <p className="text-secondary text-sm">
            Не удалось проверить ваш доступ: хранилище данных не ответило. Ничего не изменено.
            Повторите через минуту; если не проходит — сообщите администратору платформы.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href=""
            className="bg-accent text-on-accent hover:bg-accent-hover inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium"
          >
            Повторить
          </a>
          <a
            href="/login"
            className="border-border-strong text-primary hover:bg-primary/[0.04] inline-flex h-9 items-center rounded-md border px-3.5 text-sm"
          >
            Ко входу
          </a>
        </div>
      </div>
    </div>
  );
}

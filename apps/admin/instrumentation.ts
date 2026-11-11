/**
 * Next instrumentation админки: фоновый такт канала переводов между
 * платформами группы (`@broker/transfer`, ветка client-transfer).
 *
 * Такт: наблюдения цели (письмо-приглашение ушло, KYC пройден, срок истёк),
 * терминал (заморозка/разморозка повтором) и доставка outbox с повтором.
 * Выключается `PLATFORM_TRANSFER_WORKER=off` (напр. на второй реплике — хотя
 * `SKIP LOCKED` и так не даст двум репликам взять одно сообщение).
 * Модуль с `pg` подключается только в node-рантайме (урок кабинета 25.10).
 */
export async function register() {
  // Условие — ПРЯМО вокруг import: так сборщик выкидывает модуль с `pg` из
  // edge-пакета (ранний `return` он не распознаёт — урок этой ветки).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    if (process.env.PLATFORM_TRANSFER_WORKER === 'off' || !process.env.DATABASE_URL) return;
    const { startTransferWorker } = await import('./lib/transfer/worker');
    startTransferWorker();
  }
}

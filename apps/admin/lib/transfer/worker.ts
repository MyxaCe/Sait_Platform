import { runTransferTick } from '@broker/transfer';
import { selfSlug, signingKey, transferPool, transferTerminal } from './runtime';

const store = globalThis as unknown as { __transferWorker?: ReturnType<typeof setInterval> };

/** Фоновый такт канала переводов (см. instrumentation.ts). Один на процесс. */
export function startTransferWorker(): void {
  if (store.__transferWorker) return;
  const slug = selfSlug();
  if (!slug) {
    console.warn('[transfer] SITE_SLUG не задан — канал переводов не запущен');
    return;
  }
  const every = Math.max(2_000, Number(process.env.PLATFORM_TRANSFER_TICK_MS ?? 10_000) || 10_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runTransferTick(transferPool(), {
        selfSlug: slug,
        signingKey: signingKey(),
        fetch: fetch as never,
        terminal: process.env.TERMINAL_INTERNAL_URL ? transferTerminal() : null,
        log: (m) => console.warn(m),
      });
      const moved = Object.entries(r).filter(([, v]) => v !== 0);
      if (moved.length) console.info('[transfer] такт', Object.fromEntries(moved));
    } catch (e) {
      console.error('[transfer] такт упал', (e as Error).message);
    } finally {
      running = false;
    }
  };
  store.__transferWorker = setInterval(tick, every);
  console.info(`[transfer] канал переводов: ${slug}, такт ${every} мс, ключ подписи ${signingKey() ? 'задан' : 'НЕ задан'}`);
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    if (process.env.PLATFORM_TRANSFER_WORKER === 'off' || !process.env.DATABASE_URL) return;
    const { startTransferWorker } = await import('./lib/transfer/worker');
    startTransferWorker();
  }
}

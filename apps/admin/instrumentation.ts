export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    if (process.env.PLATFORM_TRANSFER_WORKER === 'off' || !process.env.DATABASE_URL) return;
    const { startTransferWorker } = await import('./lib/transfer/worker');
    startTransferWorker();
    if (process.env.ACCOUNT_TIER_WORKER !== 'off') {
      const [{ startAccountTierWorker }, { getPool }, { terminalMoney }] = await Promise.all([
        import('./lib/leverage/tier-worker'),
        import('./lib/db'),
        import('./lib/crypto/runtime'),
      ]);
      startAccountTierWorker(() => ({ db: getPool(), pool: getPool(), terminal: terminalMoney(), log: (m) => console.info(m) }));
    }
  }
}

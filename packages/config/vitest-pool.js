import os from 'node:os';

function maxThreads() {
  const override = Number(process.env.VITEST_MAX_THREADS);
  if (Number.isInteger(override) && override > 0) return override;

  const cores =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

  return Math.max(1, Math.floor(cores / 4));
}

export const poolOptions = {
  threads: {
    maxThreads: maxThreads(),
    minThreads: 1,
  },
};

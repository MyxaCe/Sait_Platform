import { test } from '@playwright/test';

export function requireOrSkip(options: {
  gated: boolean;
  required: string;
  what: string;
  missing: string;
}): void {
  const mustRun = process.env[options.required] === '1';

  test.beforeAll(() => {
    if (options.gated && mustRun) {
      throw new Error(
        `${options.required}=1, но ${options.missing}: ${options.what} НЕ ПРОВЕРЕН. ` +
          'Пропуск здесь неотличим от успеха, поэтому это отказ, а не skip.',
      );
    }
  });

  test.skip(options.gated && !mustRun, `${options.missing} — сценарий не идёт`);
}

export function skipAsOtherScenario(when: boolean, why: string): void {
  test.skip(when, `другой сценарий: ${why}`);
}

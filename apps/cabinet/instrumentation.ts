import * as Sentry from '@sentry/nextjs';
import { assertTenantSlugAtStartup } from '@broker/tenant';

/** Next instrumentation hook кабинета: серверный/edge Sentry по рантайму. */
/**
 * Гейт личности: процесс, не знающий своего тенанта, не обслуживает
 * (PKG-05).
 *
 * **Почему на старте, а не в разборе страницы.** Отказ при старте виден
 * сразу и целиком — в логе контейнера, до первого посетителя. Отказ на
 * странице виден по одной странице и только тому, кто её открыл, а
 * остальные продолжают получать ответы от приложения, которое не знает,
 * чьё оно.
 *
 * **Почему не на сборке.** Образ один на много тенантов: публичные
 * адреса приходят build-arg'ами, `SITE_SLUG` — из `environment` при
 * запуске. Требовать слаг на сборке значило бы завести гейт, который
 * невозможно удовлетворить одним образом на две страны, а гейт, который
 * невозможно удовлетворить, отключают. На сборке страницы, которым
 * нужен тенант, получают закрытую границу — тот же fail-closed, что при
 * недоступной CMS.
 *
 * Фаза сборки опознаётся по `NEXT_PHASE`; `next start` её не выставляет.
 */
function assertTenantKnown(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const slug = assertTenantSlugAtStartup('старт cabinet');
    console.info(`[cabinet] тенант: ${slug}`);
  } catch (error) {
    console.error(`[cabinet] ${(error as Error).message}`);
    // Отказ целиком: иначе процесс продолжит отвечать, не зная, чей он.
    process.exit(1);
  }
}

export async function register() {
  assertTenantKnown();

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;

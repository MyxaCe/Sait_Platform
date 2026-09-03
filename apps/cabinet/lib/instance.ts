import os from 'node:os';

/**
 * Кто именно отвечает на health-пробу (баг B-019, найден на витрине).
 *
 * `service: "cabinet"` называет ПРИЛОЖЕНИЕ, а не экземпляр: локальный кабинет
 * и контурный `broker-local-cabinet-1` отвечают одинаково при разной
 * конфигурации. Признаки подобраны так, чтобы экземпляр не выбирал их себе
 * сам — самоназвание и есть то, что подводит.
 *
 * Дублирует `apps/web/lib/instance.ts` намеренно: общий пакет под это —
 * изменение в зоне надзора штаба, а список переменных у приложений разный
 * (`SSO_PRIVATE_KEY_B64` есть только здесь).
 */
export interface InstanceIdentity {
  /** Контейнер → его id, хост → имя машины. Назначается снаружи процесса. */
  host: string;
  /** Различает два процесса одного приложения на одной машине. */
  pid: number;
  /** Считается из process.uptime() на каждый запрос: значение, вычисленное
   *  на сборке, замерзает в образе и начинает врать (урок B-010). */
  startedAt: string;
}

export function instanceIdentity(): InstanceIdentity {
  return {
    host: os.hostname(),
    pid: process.pid,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };
}

const TRACKED_ENV = [
  'DATABASE_URL',
  'CMS_API_URL',
  'CMS_API_KEY',
  'MDS_HTTP_URL',
  'NEXT_PUBLIC_WS_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_TERMINAL_URL',
  'SITE_SLUG',
  'SSO_PRIVATE_KEY_B64',
  'UPLOAD_DIR',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
] as const;

/**
 * Отпечаток конфигурации: КАКИЕ переменные заданы, но НЕ что в них лежит.
 * Только булевы значения. Здесь это критичнее, чем на витрине:
 * `SSO_PRIVATE_KEY_B64` — приватный ключ подписи токенов доступа, и его
 * значению нельзя оказаться рядом с публичной ручкой ни при каких правках.
 */
export function configFingerprint(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of TRACKED_ENV) {
    const value = process.env[name];
    out[name] = typeof value === 'string' && value.length > 0;
  }
  return out;
}

import { readTerminalLeverage, type Queryable } from '@broker/money';
import { getPool } from './db';

/**
 * Плечо счёта для SSO-токена (claim `leverage`, Р-446). Только серверный модуль.
 *
 * Закон тот же, что у админки (`resolveLeverage` в `@broker/money`): override
 * клиента › крипто-планка портфеля › база портфеля; терминал торгует только
 * криптой. `null` — конфигурация плеча клиенту ничего не задаёт (нет строки
 * и нет портфеля по умолчанию): claim не кладём, терминал держит своё.
 *
 * Сбой чтения — исключение: выпускать токен с «каким-нибудь» плечом нельзя,
 * решает вызывающий (ручка токена отвечает 503).
 */
export async function terminalLeverageFor(userId: string): Promise<number | null> {
  const m = await readTerminalLeverage(getPool() as unknown as Queryable, [userId]);
  return m.get(userId) ?? null;
}

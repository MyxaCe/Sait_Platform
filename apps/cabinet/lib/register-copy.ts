import { formatCurrency } from '@broker/utils';
import type { TenantStartBalance } from '@/lib/tenant';

/**
 * Какую подпись показать под заголовком регистрации (CAB-06, Р-040).
 *
 * Вынесено из страницы отдельной функцией затем, чтобы умолчание можно
 * было **покрасить тестом**. Пока выбор жил внутри разметки, мутация
 * «подставить $10 000, когда сумма не назначена» не красила ничего:
 * проверять было нечего, кроме глаз.
 *
 * Правило одно и повторяет Р-040 слово в слово: **сумма называется
 * только тогда, когда её назначил тенант.** Нет назначенной суммы —
 * подпись о сумме молчит. Подставить своё число значит пообещать
 * депозит, которого никто не обещал, и пообещать его ровно там, где
 * `registerAccount()` на этом же основании ОТКАЖЕТ открыть счёт.
 */

export type RegisterSubtitle =
  /** Сумма назначена — называем её, подставляя в подпись. */
  | { readonly key: 'registerSubtitleWithAmount'; readonly amount: string }
  /** Суммы нет. Подпись без суммы — не «сумма ноль» и не «$10 000». */
  | { readonly key: 'registerSubtitle' };

/**
 * Валюта — всё ещё допущение, и это названо вслух.
 *
 * `demoStartBalanceCents` в контракте тенанта валюты не несёт, а схема
 * `demo_accounts` держит `DEFAULT 'USD'`. То есть сумма теперь из
 * источника, а валюта нет. Пункт открытый, не закрытый: вынесен в отчёт
 * штабу, а не спрятан в умолчание параметра.
 */
const ASSUMED_CURRENCY = 'USD';

export function registerSubtitle(
  startBalance: TenantStartBalance,
  locale: string,
): RegisterSubtitle {
  if (startBalance.state !== 'set') return { key: 'registerSubtitle' };

  return {
    key: 'registerSubtitleWithAmount',
    amount: formatCurrency(
      startBalance.cents / 100,
      ASSUMED_CURRENCY,
      locale === 'en' ? 'en-US' : 'ru-RU',
    ),
  };
}

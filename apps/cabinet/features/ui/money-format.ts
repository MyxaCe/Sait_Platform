import { formatMinor, formatMoney } from '@broker/ui';
import { intlTag } from '@broker/utils/locales';

export function moneyFormat(locale: string) {
  const tag = intlTag(locale);
  return {
    money: (minor: number, currency: string, signed = false) => formatMoney(minor, currency, signed, tag),
    minor: (minor: number) => formatMinor(minor, tag),
  };
}

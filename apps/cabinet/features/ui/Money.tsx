'use client';

import { useLocale } from 'next-intl';
import { Money as UiMoney, type MoneyProps } from '@broker/ui';
import { intlTag } from '@broker/utils/locales';

export function Money(props: Omit<MoneyProps, 'intlLocale'>) {
  const locale = useLocale();
  return <UiMoney {...props} intlLocale={intlTag(locale)} />;
}

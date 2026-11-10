import { DescriptionList, Money, type DescriptionItem } from '@broker/ui';
import type { ParsedRules } from '@broker/promo';
import { bpsText } from '@/lib/promo/labels';

const yes = (v: boolean) => (v ? 'да' : 'нет');
const usdt = (m: number) => <Money minor={m} currency="USDT" />;

/** Правила акции человеческими словами (числа — из базы, не из кода). */
export function rulesItems(p: ParsedRules): DescriptionItem[] {
  switch (p.type) {
    case 'deposit_bonus': {
      const r = p.rules;
      return [
        { term: 'Бонус', value: `${bpsText(r.percentBps)} от депозита`, numeric: true },
        { term: 'Не больше', value: usdt(r.capMinor), hint: 'на клиента' },
        { term: 'Депозит от', value: usdt(r.minDepositMinor), hint: r.firstDepositOnly ? 'только первый' : 'любой в окне' },
        { term: 'Оборот', value: r.turnoverMultiplier > 0 ? `${r.turnoverMultiplier}× бонуса` : 'не нужен', hint: 'нотионал сделок' },
        { term: 'Удержание сделки', value: `от ${r.minHoldSeconds} с` },
        { term: 'Срок', value: `${r.windowDays} дн`, hint: 'со дня вступления' },
        { term: 'KYC', value: yes(r.kycRequired) },
        { term: 'Вывод до выплаты', value: r.forfeitOnWithdrawal ? 'аннулирует' : 'не влияет' },
      ];
    }
    case 'referral': {
      const r = p.rules;
      return [
        { term: 'Пригласившему', value: usdt(r.referrerRewardMinor) },
        { term: 'Другу', value: usdt(r.refereeRewardMinor) },
        { term: 'Депозит друга от', value: usdt(r.minDepositMinor) },
        { term: 'Оборот друга от', value: usdt(r.turnoverNotionalMinor), hint: `сделки от ${r.minHoldSeconds} с` },
        { term: 'Срок', value: `${r.windowDays} дн`, hint: 'с регистрации друга' },
        { term: 'KYC друга', value: yes(r.kycRequired) },
        { term: 'Лимит в месяц', value: r.maxPaidReferralsPerMonth > 0 ? `${r.maxPaidReferralsPerMonth} друзей` : 'без лимита' },
        { term: 'Вывод до выплаты', value: r.forfeitOnWithdrawal ? 'аннулирует' : 'не влияет' },
      ];
    }
    case 'cashback': {
      const r = p.rules;
      return [
        { term: 'Кешбэк', value: `${bpsText(r.percentBps)}`, hint: 'от уплаченных наценки и комиссии' },
        { term: 'Период', value: 'календарный месяц (UTC)' },
        { term: 'Не начислять меньше', value: usdt(r.minPayoutMinor) },
        { term: 'Потолок в месяц', value: r.capPerPeriodMinor > 0 ? usdt(r.capPerPeriodMinor) : 'без потолка' },
        { term: 'KYC', value: yes(r.kycRequired) },
      ];
    }
    case 'contest': {
      const r = p.rules;
      const total = r.prizes.reduce((s, x) => s + x.amountMinor, 0);
      return [
        { term: 'Старт демо', value: <Money minor={r.startBalanceMinor} currency="USD" />, hint: 'одинаковый у всех (сброс демо)' },
        { term: 'Мин. сделок', value: String(r.minTrades), hint: 'закрытых, в окне конкурса' },
        {
          term: 'Призы',
          value: (
            <span className="tabular-nums">
              {[...r.prizes]
                .sort((a, b) => a.place - b.place)
                .map((x) => `${x.place}-е ${(x.amountMinor / 100).toLocaleString('ru-RU')}`)
                .join(' · ')}
            </span>
          ),
          hint: <>всего {usdt(total)}</>,
          wide: true,
        },
        { term: 'Приз только с KYC', value: yes(r.prizeRequiresKyc) },
        { term: 'Повторный сброс', value: r.disqualifyOnReset ? 'дисквалификация' : 'разрешён' },
      ];
    }
  }
}

export function RulesList({ parsed }: { parsed: ParsedRules }) {
  return <DescriptionList columns={2} items={rulesItems(parsed)} />;
}

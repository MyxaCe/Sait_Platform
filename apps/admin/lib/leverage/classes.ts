import type { TerminalLeverage } from '@broker/money';
import { LEVERAGE_CLASSES, type LeverageClass } from '@broker/money/leverage-classes';

export { LEVERAGE_CLASSES, type LeverageClass };

export const LEVERAGE_CLASS_LABELS: Readonly<Record<LeverageClass, string>> = {
  forex: 'Форекс',
  metals: 'Металлы',
  crypto: 'Криптовалюты',
  stocks: 'Акции',
  energy: 'Энергоносители',
  indices: 'Индексы',
};

export function classLabel(cls: string): string {
  return (LEVERAGE_CLASS_LABELS as Record<string, string>)[cls] ?? cls;
}

export function describeTerminalLeverage(t: TerminalLeverage): string {
  const parts = [`база 1:${t.base}`];
  for (const cls of LEVERAGE_CLASSES) {
    const lev = t.classes[cls];
    if (lev !== undefined) parts.push(`${classLabel(cls)} 1:${lev}`);
  }
  return parts.join(' · ');
}

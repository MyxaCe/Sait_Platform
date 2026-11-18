const CENTS_MINOR_UNITS = 2;

export class MoneyDisagreementError extends Error {
  constructor(
    readonly field: string,
    readonly cents: number,
    readonly minor: number,
  ) {
    super(
      `${field}: старое поле ${cents} и новое ${minor} называют одну сумму по-разному. ` +
        'Пока валюта одна, они обязаны совпадать; расхождение означает, что одно из ' +
        'них посчитано не так, и выбрать правильное молча нельзя.',
    );
    this.name = 'MoneyDisagreementError';
  }
}

export class UnrepresentableMoneyError extends Error {
  constructor(
    readonly field: string,
    readonly minorUnits: number,
    readonly currency: string | undefined,
  ) {
    super(
      `${field}: валюта ${currency ?? 'не названа'} имеет ${minorUnits} младших единиц, ` +
        'а хранилище считает в центах (2). Пересчёт здесь был бы выдуманной точностью.',
    );
    this.name = 'UnrepresentableMoneyError';
  }
}

export interface EventMoney {
  minor: number;
  currency: string | null;
  minorUnits: number | null;
}

export interface EventMoneyInput {
  field: string;
  cents: number | undefined;
  minor: number | undefined;
  currency: string | undefined;
  currencyMinorUnits: number | undefined;
}

export function moneyFromEvent({
  field,
  cents,
  minor,
  currency,
  currencyMinorUnits,
}: EventMoneyInput): EventMoney | null {
  if (minor === undefined) {
    if (cents === undefined) return null;
    return { minor: cents, currency: currency ?? null, minorUnits: null };
  }

  const units = currencyMinorUnits ?? null;
  if (cents !== undefined && (units === null || units === CENTS_MINOR_UNITS) && cents !== minor) {
    throw new MoneyDisagreementError(field, cents, minor);
  }

  if (units !== null && units !== CENTS_MINOR_UNITS) {
    throw new UnrepresentableMoneyError(field, units, currency);
  }

  return { minor, currency: currency ?? null, minorUnits: units };
}

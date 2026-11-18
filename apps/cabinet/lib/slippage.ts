export type SlippageKind =
  | 'unknown'
  | 'none'
  | 'against'
  | 'favour';

export interface SlippageVerdict {
  kind: SlippageKind;
  amount: number;
}

export interface SlippageInput {
  execution: number;
  level: number | null | undefined;
  side: 'buy' | 'sell';
  digits: number;
}

export function describeSlippage({
  execution,
  level,
  side,
  digits,
}: SlippageInput): SlippageVerdict {
  if (level === null || level === undefined) return { kind: 'unknown', amount: 0 };

  const factor = 10 ** digits;
  const shown = (value: number) => Math.round(value * factor) / factor;

  const exec = shown(execution);
  const target = shown(level);

  if (exec === target) return { kind: 'none', amount: 0 };

  const worse = side === 'buy' ? exec < target : exec > target;

  return {
    kind: worse ? 'against' : 'favour',
    amount: shown(Math.abs(exec - target)),
  };
}

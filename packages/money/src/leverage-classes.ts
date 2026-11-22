export const LEVERAGE_CLASSES = ['forex', 'metals', 'crypto', 'stocks', 'energy', 'indices'] as const;
export type LeverageClass = (typeof LEVERAGE_CLASSES)[number];

export function isLeverageClass(value: string): value is LeverageClass {
  return (LEVERAGE_CLASSES as readonly string[]).includes(value);
}

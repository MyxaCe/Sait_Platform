export type VisibilityReason =
  | 'jurisdiction-unknown'
  | 'jurisdiction-not-listed';

export interface VisibilityVerdict {
  readonly visible: boolean;
  readonly reason: VisibilityReason | null;
  readonly explanation: string | null;
}

export function readJurisdictions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim() !== '') return [entry.trim()];

    if (entry !== null && typeof entry === 'object' && 'code' in entry) {
      const code = (entry as { code: unknown }).code;
      return typeof code === 'string' && code.trim() !== '' ? [code.trim()] : [];
    }

    return [];
  });
}

export function visibilityIn(
  restrictions: unknown,
  jurisdiction: string | null,
): VisibilityVerdict {
  const list = readJurisdictions(restrictions);

  if (list.length === 0) return { visible: true, reason: null, explanation: null };

  if (jurisdiction === null || jurisdiction === '') {
    return {
      visible: false,
      reason: 'jurisdiction-unknown',
      explanation: `Ограничено юрисдикциями (${list.join(', ')}), а юрисдикция не задана: неизвестность не разрешение.`,
    };
  }

  if (list.includes(jurisdiction)) return { visible: true, reason: null, explanation: null };

  return {
    visible: false,
    reason: 'jurisdiction-not-listed',
    explanation: `Ограничено юрисдикциями (${list.join(', ')}) — в «${jurisdiction}» не показывается.`,
  };
}

export interface NavVisibilityNode {
  readonly jurisdictions?: unknown;
  readonly children?: unknown;
}

export interface NavFilterResult<TItem> {
  readonly items: TItem[];
  readonly hidden: number;
}

export function filterNavByJurisdiction<TItem extends NavVisibilityNode>(
  items: readonly TItem[],
  jurisdiction: string | null,
): NavFilterResult<TItem> {
  if (!Array.isArray(items)) return { items: [], hidden: 0 };

  const kept: TItem[] = [];
  let hidden = 0;

  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;

    if (!visibilityIn(item.jurisdictions, jurisdiction).visible) {
      hidden += 1;
      continue;
    }

    const below = filterNavByJurisdiction((item.children ?? []) as readonly TItem[], jurisdiction);
    hidden += below.hidden;

    kept.push({ ...item, children: below.items });
  }

  return { items: kept, hidden };
}

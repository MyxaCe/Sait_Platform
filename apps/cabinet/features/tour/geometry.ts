export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const HIGHLIGHT_PAD = 6;
export const CARD_GAP = 12;
export const CARD_WIDTH = 340;
export const MOBILE_MAX = 640;

/** Рамка подсветки: элемент с отступом, не выходит за экран. */
export function highlightBox(target: Box, vp: Viewport): Box {
  const top = Math.max(0, target.top - HIGHLIGHT_PAD);
  const left = Math.max(0, target.left - HIGHLIGHT_PAD);
  const right = Math.min(vp.width, target.left + target.width + HIGHLIGHT_PAD);
  const bottom = Math.min(vp.height, target.top + target.height + HIGHLIGHT_PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type CardPlacement =
  | { mode: 'sheet' }
  | { mode: 'float'; top: number; left: number; side: 'below' | 'above' };

/**
 * Где показать карточку. Телефон — нижняя панель во всю ширину. Компьютер —
 * под элементом, если снизу хватает места, иначе над ним; по горизонтали
 * выравнивание по элементу с прижатием к краям экрана.
 */
export function placeCard(target: Box, vp: Viewport, cardHeight: number): CardPlacement {
  if (vp.width <= MOBILE_MAX) return { mode: 'sheet' };
  const width = Math.min(CARD_WIDTH, vp.width - 2 * CARD_GAP);
  const left = Math.min(Math.max(CARD_GAP, target.left), vp.width - width - CARD_GAP);
  const below = target.top + target.height + HIGHLIGHT_PAD + CARD_GAP;
  if (below + cardHeight <= vp.height - CARD_GAP) return { mode: 'float', top: below, left, side: 'below' };
  const above = target.top - HIGHLIGHT_PAD - CARD_GAP - cardHeight;
  if (above >= CARD_GAP) return { mode: 'float', top: above, left, side: 'above' };
  return { mode: 'float', top: Math.max(CARD_GAP, vp.height - cardHeight - CARD_GAP), left, side: 'below' };
}

/** Видим ли элемент (есть на экране, не скрыт через display:none / hidden). */
export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[hidden],[aria-hidden="true"]')) return false;
  const rects = el.getClientRects();
  if (rects.length === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Первый видимый элемент из списка селекторов. */
export function firstVisible(selectors: readonly string[], root: ParentNode = document): HTMLElement | null {
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = root.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const node of Array.from(nodes)) {
      if (isVisible(node)) return node as HTMLElement;
    }
  }
  return null;
}

/** Следующий шаг с найденным элементом в направлении `dir`; −1, если таких нет. */
export function nextAvailable(from: number, dir: 1 | -1, count: number, has: (index: number) => boolean): number {
  for (let i = from; i >= 0 && i < count; i += dir) {
    if (has(i)) return i;
  }
  return -1;
}

export function stepLabel(template: string, current: number, total: number): string {
  return template.replace('{current}', String(current)).replace('{total}', String(total));
}

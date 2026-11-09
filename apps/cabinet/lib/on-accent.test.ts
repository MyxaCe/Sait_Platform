import { describe, expect, it } from 'vitest';
import { contrastRatio, onAccentChannels } from './on-accent';

describe('текст на акценте бренда', () => {
  it('на нашем золоте — тёмный, ≥ 4.5:1', () => {
    expect(onAccentChannels('212 164 55')).toBe('22 17 6');
    expect(contrastRatio('22 17 6', '212 164 55')).toBeGreaterThanOrEqual(4.5);
  });

  it('на тёмном акценте бренда — белый, ≥ 4.5:1', () => {
    expect(onAccentChannels('31 58 109')).toBe('255 255 255');
    expect(contrastRatio('255 255 255', '31 58 109')).toBeGreaterThanOrEqual(4.5);
  });

  it('старая пара (белый на золоте) — не AA: ради этого и правка', () => {
    expect(contrastRatio('245 246 248', '212 164 55')).toBeLessThan(4.5);
  });
});

import type { ConnStatus } from '@broker/realtime';

export type HeroBackgroundSetting = 'quotes' | 'off';

export const DEFAULT_HERO_BACKGROUND: HeroBackgroundSetting = 'quotes';

export function readHeroBackground(brand: unknown): HeroBackgroundSetting {
  if (typeof brand !== 'object' || brand === null) return DEFAULT_HERO_BACKGROUND;
  const value = (brand as { heroBackground?: unknown }).heroBackground;
  return value === 'off' || value === 'quotes' ? value : DEFAULT_HERO_BACKGROUND;
}

export type BackdropMode = 'off' | 'grid' | 'still' | 'flow';

export interface BackdropInput {
  setting: HeroBackgroundSetting;
  feedStatus: ConnStatus;
  symbols: readonly string[];
  reducedMotion: boolean;
}

const LIVE_STATUSES: ReadonlySet<ConnStatus> = new Set(['connected', 'reconnecting']);

export function isLiveFeed(status: ConnStatus): boolean {
  return LIVE_STATUSES.has(status);
}

export function backdropMode({
  setting,
  feedStatus,
  symbols,
  reducedMotion,
}: BackdropInput): BackdropMode {
  if (setting === 'off') return 'off';
  if (symbols.length === 0 || !isLiveFeed(feedStatus)) return 'grid';
  return reducedMotion ? 'still' : 'flow';
}

export interface BackdropProfile {
  maxLines: number;
  fps: number;
  windowMs: number;
}

export const DESKTOP_PROFILE: BackdropProfile = { maxLines: 4, fps: 30, windowMs: 120_000 };
export const MOBILE_PROFILE: BackdropProfile = { maxLines: 2, fps: 15, windowMs: 90_000 };

export function backdropProfile(compact: boolean): BackdropProfile {
  return compact ? MOBILE_PROFILE : DESKTOP_PROFILE;
}

import { safeLaunchNext } from '@/lib/sso/launch';
import { safeTerminalNext } from './public-paths';

export function safeNext(raw: unknown): string | null {
  return safeLaunchNext(raw) ?? safeTerminalNext(raw);
}

export function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ next }).toString()}` : path;
}

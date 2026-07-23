import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Локале-зависимые обёртки навигации: Link автоматически сохраняет
 * текущий язык (/en/instruments вместо /instruments), usePathname
 * возвращает путь без префикса локали.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

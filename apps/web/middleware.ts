import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Исключаем API, служебные пути Next и файлы с расширением (sw.js, иконки и т.п.)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

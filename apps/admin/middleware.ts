import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, LOGIN_PATH, PUBLIC_PATHS } from './lib/auth/constants';
import { verifyOperatorSession } from './lib/auth/session';

/**
 * ЕДИНЫЙ ГЕЙТ входа в центр управления (Р-395, Р-394).
 *
 * Вопрос «пускают ли сюда вообще» задаётся ОДИН раз — здесь, на входе, а не
 * «закрыта ли каждая страница». Поверхность закрыта по умолчанию: нет валидной
 * операторской сессии → редирект на `/login`. Молчание = «нельзя».
 *
 * Проверка сессии идёт полностью (подпись + срок + issuer/aud) прямо в
 * middleware: `verifyOperatorSession` edge-совместим (jose поверх Web Crypto,
 * без `node:*` и без БД). Поэтому гейт самодостаточен и не отдаёт решение
 * «наверное пустить» вниз по стеку. Защищённый layout перепроверяет сессию
 * как defence-in-depth и ради имени оператора, но авторитет — этот гейт.
 */
export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = (PUBLIC_PATHS as readonly string[]).some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const operator = await verifyOperatorSession(token);

  // Закрытая зона без валидной сессии → на вход (fail-closed, Р-394).
  if (!operator && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Уже вошедшего оператора со страницы входа уводим внутрь.
  if (operator && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Гейт не трогает служебные пути и статику; health остаётся публичным.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

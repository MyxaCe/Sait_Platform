import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  API_PUBLIC_PATHS,
  LOGIN_PATH,
  PUBLIC_PATHS,
} from './lib/auth/constants';
import { verifyOperatorSession } from './lib/auth/session';

/**
 * ЕДИНЫЙ ГЕЙТ входа в центр управления (Р-395, Р-394, Р-451).
 *
 * Вопрос «пускают ли сюда вообще» задаётся ОДИН раз — здесь, на входе. Две
 * поверхности, одно правило — закрыто по умолчанию:
 *
 *  - СТРАНИЦЫ: нет валидной операторской сессии → редирект на `/login`.
 *  - `/api`: DEFAULT-DENY (Р-451). Нет сессии → 401. Прежний каркас ИСКЛЮЧАЛ
 *    `/api` из matcher — это была дыра: ручка появлялась публичной, пока кто-то
 *    не вспомнит её закрыть. Теперь наоборот — `/api` закрыт, а публичность
 *    даётся ЯВНО через `API_PUBLIC_PATHS`, каждому исключению со своей
 *    причиной. Молчание = «нельзя» на обеих поверхностях.
 *
 * Проверка сессии идёт полностью (подпись + срок + issuer/aud) прямо в
 * middleware: `verifyOperatorSession` edge-совместим (jose поверх Web Crypto,
 * без `node:*` и без БД). Гейт самодостаточен и не отдаёт решение «наверное
 * пустить» вниз по стеку; чувствительные роуты перепроверяют сессию сами
 * (defense in depth, Р-451) — «и-и», не «или-или».
 */

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function unauthorized(): NextResponse {
  // Денежный control plane: отказ — машиночитаемый 401, без намёка на то,
  // существует ли роут и что он делает.
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const operator = await verifyOperatorSession(token);

  const isApi = pathname === '/api' || pathname.startsWith('/api/');

  if (isApi) {
    // Default-deny: публично только то, что в явном allowlist (Р-451).
    if (matchesPrefix(pathname, API_PUBLIC_PATHS)) {
      return NextResponse.next();
    }
    if (!operator) return unauthorized();
    return NextResponse.next();
  }

  const isPublicPage = matchesPrefix(pathname, PUBLIC_PATHS);

  // Закрытая страница без валидной сессии → на вход (fail-closed, Р-394).
  if (!operator && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Уже вошедшего оператора со страницы входа уводим внутрь.
  if (operator && isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // `/api` ТЕПЕРЬ проходит через гейт (Р-451) — его больше нет в исключениях.
  // Не трогаем только служебку Next и статику (файлы с расширением).
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};

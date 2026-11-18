import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  API_PUBLIC_PATHS,
  LOGIN_PATH,
  PUBLIC_PATHS,
} from './lib/auth/constants';
import { verifyOperatorSession } from './lib/auth/session';
import { scopeViolation } from './lib/auth/role-scope';

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const operator = await verifyOperatorSession(token);

  const isApi = pathname === '/api' || pathname.startsWith('/api/');

  if (isApi) {
    if (matchesPrefix(pathname, API_PUBLIC_PATHS)) {
      return NextResponse.next();
    }
    if (!operator) return unauthorized();
    if (scopeViolation(operator.role, pathname)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  const isPublicPage = matchesPrefix(pathname, PUBLIC_PATHS);

  if (!operator && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (operator && isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (operator) {
    const scope = scopeViolation(operator.role, pathname);
    if (scope) {
      const url = request.nextUrl.clone();
      url.pathname = scope.home;
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};

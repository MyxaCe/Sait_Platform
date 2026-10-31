import { readdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import middleware from '../../middleware';
import { API_PUBLIC_PATHS } from '../../lib/auth/constants';

/**
 * ADM-01 · `/api` DEFAULT-DENY (Р-451, критерий готовности).
 *
 * Тест ходит по ВСЕМ реально существующим `/api`-роутам (сканируя
 * `app/api/**​/route.ts`) и требует: без сессии — 401, КРОМЕ явного allowlist
 * (`API_PUBLIC_PATHS`). Роут, добавленный мимо allowlist, попадает сюда
 * автоматически — и обязан отвечать 401 без сессии; забыли закрыть новую
 * ручку → этот тест краснеет. Плюс проверяем, что default-deny держит и
 * ещё-не-существующий чувствительный путь.
 */

const API_DIR = path.resolve(__dirname);

/** Все пути `/api/...`, у которых на диске есть `route.ts`. */
function discoverApiRoutes(): string[] {
  const routes: string[] = [];
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
        routes.push(prefix);
      }
    }
  }
  walk(API_DIR, '/api');
  return routes;
}

function isAllowlisted(pathname: string): boolean {
  return (API_PUBLIC_PATHS as readonly string[]).some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

async function hit(pathname: string): Promise<number> {
  // Без куки сессии вовсе — именно «без сессии».
  const req = new NextRequest(new URL(`http://admin.local${pathname}`));
  const res = await middleware(req);
  return res.status;
}

describe('/api default-deny (Р-451)', () => {
  const routes = discoverApiRoutes();

  it('скан дошёл до роутов, а не зелен из-за пустого каталога', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('каждый НЕ-allowlist роут без сессии → 401', async () => {
    const denied = routes.filter((r) => !isAllowlisted(r));
    for (const route of denied) {
      expect(await hit(route), `${route} должен быть закрыт`).toBe(401);
    }
  });

  it('allowlist-роут без сессии проходит (не 401)', async () => {
    const allowed = routes.filter(isAllowlisted);
    expect(allowed, 'хотя бы один allowlist-роут существует').not.toHaveLength(0);
    for (const route of allowed) {
      expect(await hit(route), `${route} публичный`).not.toBe(401);
    }
  });

  it('ещё-не-существующий чувствительный путь тоже закрыт по умолчанию', async () => {
    // Default-deny держит не только то, что уже написано: любой /api вне
    // allowlist без сессии — 401.
    expect(await hit('/api/operators')).toBe(401);
    expect(await hit('/api/money/transfer')).toBe(401);
    expect(await hit('/api')).toBe(401);
  });

  it('allowlist минимален: health и только то, что названо явно', () => {
    // Растяжка на сам список: разрастётся молча — заметим здесь.
    expect([...API_PUBLIC_PATHS]).toEqual(['/api/health']);
  });
});

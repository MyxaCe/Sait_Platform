import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN = ['apps/web', 'apps/cabinet', 'apps/relay', 'apps/consumer', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx', '.mjs']);

const ENV_NULLISH = /process\.env\.[A-Za-z_][A-Za-z0-9_]*\s*\?\?\s*/;

export function ENV_NULLISH_DEFAULT_test(line: string): boolean {
  const m = ENV_NULLISH.exec(line);
  if (!m) return false;
  const rest = line.slice(m.index + m[0].length);
  return !(rest.startsWith("''") || rest.startsWith('""'));
}

const ENV_NULLISH_DEFAULT = { test: ENV_NULLISH_DEFAULT_test };

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (CODE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

describe('WEB-21 · пустая строка не проходит за незаданное', () => {
  it('скан доходит до файлов, а не зелен из-за пустого обхода', () => {
    const scanned = SCAN.flatMap((d) => sourceFiles(path.join(ROOT, d)));

    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((f) => f.includes('SiteHeader'))).toBe(true);
  });

  it('ни одного `process.env.X ??` ни в одной из областей', () => {
    const offenders: string[] = [];

    for (const dir of SCAN) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        if (path.basename(file) === 'env-defaults.test.ts') continue;

        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (isComment(line)) return;
            if (ENV_NULLISH_DEFAULT.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть — иначе она зелёная просто так', () => {
    const caught = (line: string) => !isComment(line) && ENV_NULLISH_DEFAULT.test(line);

    expect(caught("const u = process.env.NEXT_PUBLIC_CABINET_URL ?? 'http://localhost:3002';")).toBe(
      true,
    );
    expect(caught('  environment: process.env.SENTRY_ENV ?? "test",')).toBe(true);

    expect(caught("const u = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://x');")).toBe(false);
    expect(caught("const raw = (process.env.FRAME_ANCESTORS ?? '').trim();")).toBe(false);
    expect(caught('const raw = (process.env.X ?? "").trim();')).toBe(false);
    expect(caught('const key = process.env.CMS_API_KEY || undefined;')).toBe(false);
    expect(caught("if (!process.env.MDS_HTTP_URL) return 'not-configured';")).toBe(false);
    expect(caught("    // было process.env.X ?? '…' — так нельзя")).toBe(false);
  });
});

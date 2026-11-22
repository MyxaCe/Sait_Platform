import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sentryEnvironment, UNKNOWN_ENVIRONMENT } from './env';

describe('WEB-32 · окружение трекера', () => {
  it('задано — проходит как есть', () => {
    expect(sentryEnvironment('production')).toBe('production');
  });

  it.each([[undefined], [null], [''], ['   ']])('не задано (%s) → «неизвестно»', (raw) => {
    expect(sentryEnvironment(raw)).toBe(UNKNOWN_ENVIRONMENT);
  });

  it('«неизвестно» — не «тест»: в этом вся задача', () => {
    expect(UNKNOWN_ENVIRONMENT).not.toBe('test');
  });

  it('пробельное значение не становится именем окружения', () => {
    expect(sentryEnvironment(' production ')).toBe('production');
  });
});

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);

function sentryConfigs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sentryConfigs(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

export function assignsEnvironment(line: string): boolean {
  return /environment:\s*/.test(line) && /SENTRY_ENV/.test(line);
}

describe('WEB-32 · умолчание не возвращается', () => {
  const files = sentryConfigs(path.join(ROOT, 'apps'));

  it('скан дошёл до файлов, а не зелен из-за пустого обхода', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('каждое назначение окружения идёт через общий разбор', () => {
    const offenders: string[] = [];

    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
          if (!assignsEnvironment(line)) return;
          if (!line.includes('sentryEnvironment')) {
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });

  it('мест нашлось не ноль — иначе проверка не смотрит никуда', () => {
    const found = files.filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((l) => assignsEnvironment(l)),
    );

    expect(found.length).toBeGreaterThan(4);
  });

  it('проверка умеет краснеть и молчать', () => {
    expect(assignsEnvironment("  environment: envOr(process.env.SENTRY_ENV, 'test'),")).toBe(true);
    expect(assignsEnvironment('  environment: sentryEnvironment(process.env.SENTRY_ENV),')).toBe(
      true,
    );

    expect(assignsEnvironment("    environment: 'node',")).toBe(false);
  });
});

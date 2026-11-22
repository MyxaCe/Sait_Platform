import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

const BURNED = [
  'broker_dev_password',
  'dev-cms-api-key',
  'local-dev-secret',
  'preview-dev-secret',
  'dev-payload-secret',
];

const WATCHED = ['.env.example', '.md'];

const ALLOWED = ['docker-compose.yml'];

const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '.git', 'coverage']);

function watchedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...watchedFiles(full));
    else if (WATCHED.some((w) => entry.endsWith(w))) out.push(full);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('>');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function offeredAsValue(line: string, burned: string): boolean {
  const re = new RegExp(`(=|:\\s|\\s--?[A-Za-z0-9-]+[=\\s])\\s*['"\`]?[^\\s'"\`]*${escapeRe(burned)}`);
  return re.test(line);
}

export function burnedIn(text: string, strict = true): string[] {
  return text
    .split('\n')
    .filter((line) => {
      if (isCommentLine(line)) return false;
      const hit = BURNED.find((b) => line.includes(b));
      if (!hit) return false;
      return strict || offeredAsValue(line, hit);
    })
    .map((l) => l.trim());
}

describe('сожжённые секреты не предлагаются к использованию', () => {
  it('скан находит примеры и документацию', () => {
    const files = watchedFiles(ROOT);

    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('.env.example'))).toBe(true);
  });

  it('ни в одном примере и ни в одном документе', () => {
    const offenders: string[] = [];

    for (const file of watchedFiles(ROOT)) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED.some((a) => relative.endsWith(a))) continue;

      const strict = !relative.endsWith('.md');
      for (const line of burnedIn(readFileSync(file, 'utf8'), strict)) {
        offenders.push(`${relative}: ${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть', () => {
    expect(
      burnedIn('# DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x'),
    ).toEqual([]);
    expect(burnedIn('DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x')).toHaveLength(
      1,
    );
    expect(burnedIn('CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
  });

  describe('в Markdown различается называние и предложение', () => {
    const md = (line: string) => burnedIn(line, false);

    it('названное в прозе имя — не нарушение', () => {
      expect(md('`dev-cms-api-key`, `local-dev-secret`, `preview-dev-secret`,')).toEqual([]);
      expect(md('Значение `broker_dev_password` сожжено и годным не считается.')).toEqual([]);
      expect(md('Секреты dev-payload-secret-… лежат в истории с августа.')).toEqual([]);
    });

    it('предложенное как значение — нарушение, в любой огранке', () => {
      expect(md('CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
      expect(md('    CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
      expect(md('CMS_API_KEY: dev-cms-api-key')).toHaveLength(1);
      expect(md('CMS_API_KEY: `dev-cms-api-key`')).toHaveLength(1);
      expect(md('export CMS_API_KEY="dev-cms-api-key"')).toHaveLength(1);
      expect(md('psql --password broker_dev_password')).toHaveLength(1);
      expect(md('docker run -e CMS_API_KEY=dev-cms-api-key image')).toHaveLength(1);
      expect(
        md('DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x'),
      ).toHaveLength(1);
    });

    it('строгий разбор примеров окружения послаблением не задет', () => {
      expect(burnedIn('`dev-cms-api-key`', true)).toHaveLength(1);
    });
  });
});

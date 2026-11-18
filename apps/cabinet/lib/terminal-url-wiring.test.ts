import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const DOCKERFILE = 'docker/cabinet.Dockerfile';
const VAR = 'NEXT_PUBLIC_TERMINAL_URL';
const PLACEHOLDER = 'runtime-terminal-url.invalid';

const COMPOSE_FILES = ['docker-compose.yml', 'deploy/vps/docker-compose.yml'];

const withoutComments = (text: string, marker: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith(marker))
    .join('\n');

describe('адрес терминала: плейсхолдер в сборке, значение в окружении', () => {
  it('Dockerfile кладёт в сборку ПЛЕЙСХОЛДЕР, а не адрес', () => {
    const code = withoutComments(read(DOCKERFILE), '#');

    expect(code).toContain(`ENV ${VAR}=https://${PLACEHOLDER}`);
  });

  it('Dockerfile НЕ объявляет адрес аргументом сборки (Р-220)', () => {
    const code = withoutComments(read(DOCKERFILE), '#');

    expect(code).not.toMatch(new RegExp(`ARG ${VAR}`));
  });

  it.each(COMPOSE_FILES)('%s задаёт адрес в environment', (file) => {
    const compose = withoutComments(read(file), '#');
    const cabinet = compose.slice(compose.indexOf('\n  cabinet:'));
    const env = cabinet.slice(cabinet.indexOf('environment:'));

    expect(env).toContain(VAR);
  });

  it.each(COMPOSE_FILES)('%s НЕ задаёт адрес в build.args', (file) => {
    const compose = withoutComments(read(file), '#');
    const cabinet = compose.slice(compose.indexOf('\n  cabinet:'));
    const argsStart = cabinet.indexOf('args:');
    if (argsStart === -1) return;

    const args = cabinet.slice(argsStart, cabinet.indexOf('environment:'));
    expect(args).not.toContain(VAR);
  });
});

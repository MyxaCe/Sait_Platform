import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Адрес терминала доезжает до кабинета — и правило сменилось дважды.
 *
 * **WEB-19.** Переменной не было ни в аргументах сборки, ни в окружении
 * компоуза контура: кабинет не встраивал терминал вовсе, страница
 * торговли показывала «скоро будет». Тогда проверка требовала
 * **аргумент сборки** — Next впекает `NEXT_PUBLIC_*` в бандл.
 *
 * **WEB-22 (Р-220) это требование отменил.** Аргумент сборки означал,
 * что образ знает домен, и тег по хешу коммита переставал означать
 * ревизию кода. Теперь в сборку идёт **плейсхолдер**, а настоящий адрес
 * подставляется при запуске из окружения.
 *
 * Правило поэтому обратное прежнему: адреса в `build.args` быть **не
 * должно**, в `environment` — должен.
 *
 * ## Почему смена правила не обнаружилась сразу
 *
 * Когда WEB-22 переносил адрес, прежняя проверка обязана была
 * покраснеть — и не покраснела. У задачи `test` в turbo входами
 * считаются файлы **своего пакета**; `docker/` и компоузы в них не
 * входили, и кеш отдал старый зелёный результат: проверка не
 * исполнилась вовсе.
 *
 * Закрыто `globalDependencies` в `turbo.json`. Для проверок, читающих
 * весь репозиторий (они живут в `@broker/utils`), дыра шире и вынесена
 * штабу: там правка в `apps/**` не сбрасывает кеш пакета.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const DOCKERFILE = 'docker/cabinet.Dockerfile';
const VAR = 'NEXT_PUBLIC_TERMINAL_URL';
const PLACEHOLDER = 'runtime-terminal-url.invalid';

/**
 * Компоузов, собирающих кабинет, два, и это не формальность: однажды я
 * починила только корневой и решила, что закрыла задачу, — контур же
 * поднимается из `deploy/vps`.
 */
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
    // Прежнее требование, отменённое: аргумент означал бы, что образ
    // знает домен, и смена домена требовала бы пересборки.
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
    if (argsStart === -1) return; // блока args нет вовсе — тем более нечего проверять

    const args = cabinet.slice(argsStart, cabinet.indexOf('environment:'));
    expect(args).not.toContain(VAR);
  });
});

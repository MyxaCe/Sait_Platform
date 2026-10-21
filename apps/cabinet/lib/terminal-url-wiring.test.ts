import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-19 · адрес терминала впекается на СБОРКЕ, и это проверяется (B-030).
 *
 * **Что было.** `NEXT_PUBLIC_TERMINAL_URL` стоял в компоузе только в
 * `environment`. Страница торговли читает его в серверном компоненте,
 * который рендерится на сборке, — переменная окружения контейнера до него
 * не доезжает. Образ собирался без адреса, страница уходила в ветку
 * «скоро будет», и терминал **не встраивался вообще**: ни фрейма, ни
 * запроса за токеном. Первый живой вход был невозможен, и выглядело это
 * не как поломка, а как «ещё не сделали».
 *
 * **Почему проверка по тексту.** Поведением это не ловится ни одним
 * тестом зоны: код страницы исправен, ветка выбрана по пустому значению
 * ровно так, как написано. Дефект живёт в сборке, а не в коде, —
 * тот же класс, что B-030, где отпечаток врал про значение, вшитое при
 * сборке.
 *
 * **Чего эта проверка НЕ утверждает.** Кабинет читает ещё
 * `NEXT_PUBLIC_SITE_URL` и `NEXT_PUBLIC_SENTRY_ENV`, и они аргументами
 * сборки не объявлены. Законно это или такой же тихий дефект — я не
 * проверяла, и писать сюда утверждение, которого не проверяла, нельзя:
 * сторож, красящий законное, отключают первым. Вопрос вынесен штабу.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const DOCKERFILE = 'docker/cabinet.Dockerfile';
const VAR = 'NEXT_PUBLIC_TERMINAL_URL';

/**
 * Компоузов, собирающих кабинет, в зоне ДВА, и это не формальность: я
 * починила сначала только корневой и решила, что закрыла задачу. Контур
 * же поднимается из `deploy/vps`, то есть правка не меняла ничего там,
 * где дефект и жил. Проверка перечисляет оба — иначе «починено» снова
 * будет означать «починено в одном из двух».
 */
const COMPOSE_FILES = ['docker-compose.yml', 'deploy/vps/docker-compose.yml'];

/** Текст без комментариев — иначе проверку зеленит объяснение рядом с ней. */
const withoutComments = (text: string, marker: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith(marker))
    .join('\n');

describe('WEB-19 · адрес терминала объявлен аргументом сборки', () => {
  it('Dockerfile объявляет ARG и прокидывает его в ENV до сборки', () => {
    const code = withoutComments(read(DOCKERFILE), '#');

    expect(code).toMatch(new RegExp(`ARG ${VAR}`));
    expect(code).toMatch(new RegExp(`ENV ${VAR}=\\$${VAR}`));
  });

  it('ARG объявлен ДО шага сборки, иначе он в неё не попадёт', () => {
    // Порядок здесь — не стиль: `ARG` после `RUN ... build` не повлиял бы
    // ни на что, а выглядел бы точно так же правильно.
    const code = withoutComments(read(DOCKERFILE), '#');
    const arg = code.indexOf(`ARG ${VAR}`);
    const build = code.indexOf('pnpm --filter @broker/cabinet build');

    expect(arg).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(arg).toBeLessThan(build);
  });

  it.each(COMPOSE_FILES)('%s передаёт адрес в build.args, а не только в environment', (file) => {
    // Именно этим дефект и был в корневом компоузе: значение
    // присутствовало в файле, глазами читалось как настроенное, и до
    // сборки не доезжало. В компоузе контура его не было вовсе.
    const compose = withoutComments(read(file), '#');
    const cabinet = compose.slice(compose.indexOf('\n  cabinet:'));
    const args = cabinet.slice(cabinet.indexOf('args:'), cabinet.indexOf('environment:'));

    expect(args).toContain(VAR);
  });
});

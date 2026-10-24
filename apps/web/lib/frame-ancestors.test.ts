import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-23 · кому разрешено встраивать витрину — решается в рантайме, а
 * умолчание самое строгое (Р-224).
 *
 * **Отличие от остальных адресов, и оно задаёт всё.** У обычного адреса
 * промах даёт нерабочую ссылку. Здесь промах даёт **разрешение
 * встраивать** — то есть снимает защиту от кликджекинга. Поэтому не
 * задан значит «никому», а не «всем» и не пустая строка, от которой
 * заголовок стал бы недействительным.
 *
 * Проверяется по тексту: поведением это не ловится, пока никто не
 * запустил образ без переменной — а именно тогда дефект и сработал бы.
 */

const WEB = path.resolve(__dirname, '..');
const ROOT = path.resolve(WEB, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const withoutComments = (text: string) =>
  text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('#');
    })
    .join('\n');

describe('WEB-23 · умолчание списка встраивающих — «никому»', () => {
  it('в коде умолчание `none`, а не разрешающий список', () => {
    const code = withoutComments(readFileSync(path.join(WEB, 'next.config.mjs'), 'utf8'));

    expect(code).toContain("\"'none'\"");
    // Прежнее разрешающее умолчание не должно вернуться.
    expect(code).not.toMatch(/\?\?\s*"'self'/);
  });

  it('пустая строка считается отсутствием, а не значением', () => {
    // `??` пропустил бы пустую строку, и заголовок стал бы
    // «frame-ancestors » — недействительным, то есть снятым.
    const code = withoutComments(readFileSync(path.join(WEB, 'next.config.mjs'), 'utf8'));

    expect(code).toMatch(/\.trim\(\)/);
    expect(code).toMatch(/length > 0/);
  });

  it('в образ идёт плейсхолдер, а не адрес', () => {
    const dockerfile = withoutComments(read('docker/web.Dockerfile'));

    expect(dockerfile).toContain('ENV FRAME_ANCESTORS=https://runtime-frame-ancestors.invalid');
    expect(dockerfile).not.toMatch(/ARG FRAME_ANCESTORS/);
  });

  it('плейсхолдер безопасен сам по себе: промах подстановки никого не пускает', () => {
    // Домен `.invalid` зарезервирован и не разрешается никогда. Если
    // подстановка не сработает, заголовок останется синтаксически целым
    // и не впустит никого — отказ, а не дыра.
    expect('https://runtime-frame-ancestors.invalid').toMatch(/\.invalid$/);
  });

  it('подстановщик знает про безопасное умолчание', () => {
    const script = read('docker/runtime-config.sh');

    expect(script).toContain("FRAME_ANCESTORS|fallback:'none'");
  });

  it('значение со списком не склеивается: берём printenv, а не eval', () => {
    // `eval` переразбирал строку и склеивал слова: «'self' https://cms»
    // превращалось в один негодный токен. Заголовок оставался целым и
    // просто никого не пускал — отказ, выглядящий как настройка.
    const script = withoutComments(read('docker/runtime-config.sh'));

    expect(script).toContain('printenv');
    expect(script).not.toMatch(/eval printf/);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Образ приложения содержит ВСЕ его рабочие зависимости (B-OPS-029).
 *
 * **Что было.** `apps/consumer/package.json` объявлял `@broker/tenant`,
 * `index.ts` первым делом звал оттуда гейт личности, а
 * `docker/consumer.Dockerfile` этот пакет не копировал — ни манифест, ни
 * исходники. Пакет завели 06.10, файл сборки за ним не пошёл. На сервере
 * образ встал в бесконечный перезапуск: «Cannot find module».
 *
 * **Почему это не ловилось.** Прогон публикации собирает образ, ставит
 * метку ревизии, публикует, скачивает обратно на чистом раннере и
 * сверяет метку — и **ни один гейт не запускает контейнер**. «Образ
 * скачивается» и «образ работает» — разные утверждения.
 *
 * Здесь закрыта та половина, которую видно по тексту. Вторая — запуск
 * образа с требованием НАЗВАННОГО отказа — заведена как `WEB-27`.
 *
 * **Две сборки устроены по-разному, и это учтено.** Витрина и кабинет
 * копируют дерево целиком (`COPY . .`): поштучная проверка там была бы
 * ложной, а сторож, красящий законное, отключают первым. Релей и
 * консюмер копируют пакеты поимённо — и пропустить там можно именно
 * поимённо.
 */

const ROOT = path.resolve(__dirname, '../../..');
const APPS = ['consumer', 'relay', 'web', 'cabinet'];

/** Копирует ли сборка дерево целиком. */
export function copiesWholeTree(dockerfile: string): boolean {
  return dockerfile.split('\n').some((line) => line.trim() === 'COPY . .');
}

export function missingCopies(dockerfile: string, deps: string[]): string[] {
  if (copiesWholeTree(dockerfile)) return [];

  const lines = dockerfile.split('\n').map((l) => l.trim());
  const missing: string[] = [];

  for (const dep of deps) {
    if (!dep.startsWith('@broker/')) continue;
    const pkg = dep.slice('@broker/'.length);

    // Манифест: без него установка не узнает о зависимости.
    if (!lines.includes(`COPY packages/${pkg}/package.json packages/${pkg}/`)) {
      missing.push(`манифест ${pkg}`);
    }
    // Исходники: без них нечего импортировать.
    if (!lines.includes(`COPY packages/${pkg} packages/${pkg}`)) {
      missing.push(`исходники ${pkg}`);
    }
  }
  return missing;
}

function appDeps(app: string): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'apps', app, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {});
}

function dockerfileOf(app: string): string | null {
  const p = path.join(ROOT, 'docker', `${app}.Dockerfile`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('B-OPS-029 · объявленная зависимость попадает в образ', () => {
  it.each(APPS)('%s копирует все свои рабочие пакеты', (app) => {
    const dockerfile = dockerfileOf(app);
    expect(dockerfile, `нет docker/${app}.Dockerfile`).not.toBeNull();

    expect(missingCopies(dockerfile as string, appDeps(app))).toEqual([]);
  });

  it('проверка умеет краснеть — на том самом пропуске', () => {
    // Берём настоящий Dockerfile консюмера и убираем ровно те две
    // строки, которых не хватало.
    const real = dockerfileOf('consumer') as string;
    const broken = real
      .split('\n')
      .filter((l) => l.trim() !== 'COPY packages/tenant/package.json packages/tenant/')
      .filter((l) => l.trim() !== 'COPY packages/tenant packages/tenant')
      .join('\n');

    expect(missingCopies(broken, ['@broker/tenant'])).toEqual([
      'манифест tenant',
      'исходники tenant',
    ]);
  });

  it('сборку, копирующую дерево целиком, не трогает', () => {
    expect(copiesWholeTree('FROM node\nCOPY . .\nRUN build')).toBe(true);
    expect(missingCopies('FROM node\nCOPY . .', ['@broker/tenant'])).toEqual([]);
  });
});

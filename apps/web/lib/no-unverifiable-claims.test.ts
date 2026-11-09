import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Витрина не делает заявлений, которые нечем подтвердить.
 *
 * **Что было.** Шаблонная витрина говорила «Регулируемый брокер · на рынке
 * с 2009 года», показывала «1.2 млн трейдеров» и «87 млрд $ оборота»,
 * перечисляла CySEC/FSCA/FSA с номерами-заглушками, офисы в трёх странах и
 * квартальный отчёт с выдуманными цифрами. Ни лицензии, ни истории оборота
 * у площадки нет. Для разработчика это «тексты-рыба», для комплаенса и
 * инвестора на показе — ложное заявление от имени компании.
 *
 * **Почему проверкой по тексту.** Такие строки ничего не ломают: типы
 * сходятся, страницы рендерятся. Вернуть их может любой копирайт-патч или
 * перенос из старого макета — тест ловит это до выкатки.
 *
 * **Что запрещено.** Слова о лицензиях и регуляторах, масштаб клиентской
 * базы и оборота, год основания. Когда лицензия появится, этот тест
 * меняют вместе с текстом — осознанно, с документом на руках.
 */

const WEB = path.resolve(__dirname, '..');
const FILES = [
  'messages/ru.json',
  'messages/en.json',
  'features/blog/posts-data.ts',
  'features/education/faq-data.ts',
  'features/accounts/plans.ts',
  'components/seo/OrganizationJsonLd.tsx',
  'lib/site.ts',
  'app/manifest.ts',
];

const BANNED: RegExp[] = [
  /лиценз/i,
  /licen[cs]e/i,
  /регулируем/i,
  /regulated (broker|in)/i,
  /\b(CySEC|FSCA|FCA|ASIC)\b/,
  /млн трейдер|миллион(а|ов)? трейдер|million traders/i,
  /млрд \$|\bbn \$|\$\d+ ?(млрд|bn)/i,
  /с 2009|since 2009|foundingDate/i,
  /сегрегированн|segregated/i,
];

/** Строки-комментарии объясняют, ЧТО убрали, — их не проверяем. */
function offending(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (BANNED.some((re) => re.test(line))) out.push(`${i + 1}: ${trimmed}`);
  });
  return out;
}

describe('витрина без неподтверждаемых заявлений', () => {
  it('детектор ловит регуляторные и масштабные заявления', () => {
    expect(offending('"badge": "Регулируемый брокер · на рынке с 2009 года"')).toHaveLength(1);
    expect(offending('"title": "Лицензии ведущих регуляторов"')).toHaveLength(1);
    expect(offending('"registerSubtitle": "Join 1.2 million traders"')).toHaveLength(1);
    expect(offending('"statsVolumeSuffix": " млрд $"')).toHaveLength(1);
    expect(offending('// foundingDate убран')).toHaveLength(0);
  });

  it.each(FILES)('%s', (file) => {
    const text = readFileSync(path.join(WEB, file), 'utf8');
    expect(offending(text)).toEqual([]);
  });
});

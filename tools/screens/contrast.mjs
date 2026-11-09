// Проверка контраста WCAG 2.x для палитр центра управления.
// Читает packages/ui/src/tokens/tokens.css, для каждой палитры админки считает
// контраст текста и статусных цветов на фонах, на которых они реально живут
// (в т.ч. текст бейджа на подложке «цвет/12%» поверх card).
//
//   node tools/screens/contrast.mjs            → markdown-таблица
//   node tools/screens/contrast.mjs --strict   → exit 1, если что-то < порога
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dirname, '../../packages/ui/src/tokens/tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorRe) {
  const m = css.match(new RegExp(selectorRe + '[^{]*\\{([^}]*)\\}'));
  if (!m) throw new Error('нет блока ' + selectorRe);
  const vars = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[k] = v.trim();
  return vars;
}

const PALETTES = {
  graphite: block("\\[data-surface='admin'\\],"),
  gold: block("\\[data-surface='admin'\\]\\[data-palette='gold'\\]"),
  paper: block("\\[data-surface='admin'\\]\\[data-palette='paper'\\]"),
};

const rgb = (v) => v.split(/\s+/).map(Number);
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const strict = process.argv.includes('--strict');
let failed = 0;
const out = [];
for (const [name, p] of Object.entries(PALETTES)) {
  const c = (k) => rgb(p[k]);
  const rows = [];
  const check = (what, fg, bg, min) => {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    rows.push(`| ${what} | ${r.toFixed(2)} | ${min} | ${ok ? 'да' : '**НЕТ**'} |`);
  };
  for (const bg of ['bg-base', 'bg-card', 'bg-elevated']) {
    check(`text-primary на ${bg}`, c('text-primary'), c(bg), 4.5);
    check(`text-secondary на ${bg}`, c('text-secondary'), c(bg), 4.5);
  }
  check('text-muted на bg-card', c('text-muted'), c('bg-card'), 4.5);
  check('text-muted на bg-base', c('text-muted'), c('bg-base'), 4.5);
  check('text-on-accent на accent (кнопка)', c('text-on-accent'), c('accent'), 4.5);
  check('accent (ссылка) на bg-card', c('accent'), c('bg-card'), 4.5);
  for (const s of ['positive', 'negative', 'warning', 'info', 'accent']) {
    check(`${s} текст на bg-card`, c(s), c('bg-card'), 4.5);
    check(`${s} текст бейджа на ${s}/12% поверх card`, c(s), mix(c(s), c('bg-card'), 0.12), 4.5);
  }
  check('text-on-negative на negative (danger-кнопка)', c('text-on-negative'), c('negative'), 4.5);
  out.push(`### ${name}\n\n| пара | контраст | порог | AA |\n|---|---|---|---|\n${rows.join('\n')}\n`);
}
console.log(out.join('\n'));
if (strict && failed) {
  console.error(`не прошло: ${failed}`);
  process.exit(1);
}

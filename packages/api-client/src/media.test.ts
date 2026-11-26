import { describe, expect, it } from 'vitest';
import { absoluteMediaUrl, rewriteMediaUrls, safeMediaName, toProxiedMediaUrl } from './media';

describe('safeMediaName', () => {
  it('принимает обычные имена файлов, в том числе с пробелами и кириллицей', () => {
    expect(safeMediaName('OSTRIXS.png')).toBe('OSTRIXS.png');
    expect(safeMediaName('logo-300x200.webp')).toBe('logo-300x200.webp');
    expect(safeMediaName('%D0%BB%D0%BE%D0%B3%D0%BE.png')).toBe('лого.png');
    expect(safeMediaName('my%20logo.png')).toBe('my logo.png');
  });

  it('отклоняет обход каталогов, разделители, управляющие символы и скрытые файлы', () => {
    for (const bad of ['..', '../etc/passwd', '..%2Fsecret', 'a%2Fb.png', 'a%5Cb.png', '.env', 'a%00.png', 'x%3Fy=1', '', '%E0%A4%A', 'a'.repeat(256)]) {
      expect(safeMediaName(bad)).toBeNull();
    }
  });
});

describe('toProxiedMediaUrl', () => {
  it('ссылку CMS на медиа превращает в /media/<имя>', () => {
    expect(toProxiedMediaUrl('https://cms.example.test/api/media/file/OSTRIXS.png')).toBe('/media/OSTRIXS.png');
    expect(toProxiedMediaUrl('http://localhost:3001/api/media/file/brand-logo-1.png?v=2')).toBe('/media/brand-logo-1.png');
    expect(toProxiedMediaUrl('https://cms.example.test/api/media/file/my%20logo.png')).toBe('/media/my%20logo.png');
  });

  it('прочие ссылки не трогает', () => {
    for (const keep of [
      'https://t.me/example',
      'https://cms.example.test/api/media/other/x.png',
      'https://cms.example.test/api/media/file/a/b.png',
      '/icons/BTC.svg',
      'not a url',
    ]) {
      expect(toProxiedMediaUrl(keep)).toBe(keep);
    }
  });
});

describe('rewriteMediaUrls', () => {
  it('переписывает вложенные ссылки (бренд, юрлицо, Lexical) и не трогает остальное', () => {
    const input = {
      name: 'Brand',
      logo: { url: 'https://cms.example.test/api/media/file/logo.png', width: 10, height: 10 },
      legalEntity: { licenses: [{ document: { url: 'https://cms.example.test/api/media/file/license.pdf' } }] },
      body: { root: { children: [{ type: 'upload', value: { url: 'https://cms.example.test/api/media/file/cover.jpg' } }] } },
      socials: [{ name: 'telegram', url: 'https://t.me/example' }],
      count: 3,
      empty: null,
    };
    const out = rewriteMediaUrls(input);
    expect(out.logo.url).toBe('/media/logo.png');
    expect(out.legalEntity.licenses[0]!.document.url).toBe('/media/license.pdf');
    expect(out.body.root.children[0]!.value.url).toBe('/media/cover.jpg');
    expect(out.socials).toBe(input.socials);
    expect(out.count).toBe(3);
    expect(out.empty).toBeNull();
    expect(input.logo.url).toBe('https://cms.example.test/api/media/file/logo.png');
  });

  it('без медиа возвращает тот же объект', () => {
    const input = { a: { b: ['x', 'https://example.test/'] } };
    expect(rewriteMediaUrls(input)).toBe(input);
  });
});

describe('absoluteMediaUrl', () => {
  it('прокси-путь делает абсолютным, остальное не трогает', () => {
    expect(absoluteMediaUrl('/media/logo.png', 'https://cabinet.example.test')).toBe('https://cabinet.example.test/media/logo.png');
    expect(absoluteMediaUrl('https://x.test/a.png', 'https://cabinet.example.test')).toBe('https://x.test/a.png');
    expect(absoluteMediaUrl('/media/logo.png', null)).toBe('/media/logo.png');
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark, brandMarkParts } from './BrandMark';

const logo = { url: 'https://cdn.example.test/logo.svg', width: 120, height: 32, alt: '' };

describe('brandMarkParts', () => {
  it('logo-name (и без режима): логотип и название; без логотипа — буква и название', () => {
    expect(brandMarkParts(undefined, true)).toEqual({ image: true, initial: false, name: true });
    expect(brandMarkParts('logo-name', false)).toEqual({ image: false, initial: true, name: true });
  });
  it('logo: только логотип; без логотипа — название, а не пустое место', () => {
    expect(brandMarkParts('logo', true)).toEqual({ image: true, initial: false, name: false });
    expect(brandMarkParts('logo', false)).toEqual({ image: false, initial: false, name: true });
  });
  it('name: только текст, даже если логотип загружен', () => {
    expect(brandMarkParts('name', true)).toEqual({ image: false, initial: false, name: true });
  });
});

describe('BrandMark', () => {
  it('wordmark не дублирует название текстом, alt — название бренда', () => {
    const { container } = render(<BrandMark name="Ostrix" logo={logo} mode="logo" />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Ostrix');
    expect(container.textContent).toBe('');
  });
  it('по умолчанию — логотип и название', () => {
    const { container } = render(<BrandMark name="Ostrix" logo={logo} />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).toBe('Ostrix');
  });
});

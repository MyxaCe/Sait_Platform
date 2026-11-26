import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chrome', () => ({ getChromeBrand: vi.fn() }));

import { getChromeBrand } from '@/lib/chrome';
import { GET, OPTIONS } from './route';

afterEach(() => vi.mocked(getChromeBrand).mockReset());

describe('/api/public/brand — бренд для терминала', () => {
  it('отдаёт название, логотип, цвет и режим показа; CORS для терминала', async () => {
    vi.mocked(getChromeBrand).mockResolvedValue({
      name: 'Brand',
      primaryColor: '#112233',
      logo: { url: 'https://cdn.example.test/l.svg', width: 1, height: 1, alt: '' },
      logoMode: 'logo',
      socials: [],
      legalEntity: null,
    });
    const res = await GET(new Request('https://cabinet.example.test/api/public/brand?locale=en'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({
      name: 'Brand',
      logo: { url: 'https://cdn.example.test/l.svg', width: 1, height: 1, alt: '' },
      favicon: null,
      primaryColor: '#112233',
      logoMode: 'logo',
    });
    expect(vi.mocked(getChromeBrand)).toHaveBeenCalledWith('en');
  });

  it('CMS недоступна → 503 без кеша; незнакомая локаль → ru', async () => {
    vi.mocked(getChromeBrand).mockResolvedValue(null);
    const res = await GET(new Request('https://cabinet.example.test/api/public/brand?locale=xx'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(vi.mocked(getChromeBrand)).toHaveBeenCalledWith('ru');
  });

  it('preflight отвечает 204', () => {
    expect(OPTIONS().status).toBe(204);
  });
});

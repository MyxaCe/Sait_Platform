import { NextResponse } from 'next/server';
import { buildArticleDetail, CMS_MOCK } from '@/lib/cms-mock';

/**
 * Mock-CRM: единая точка контракта GET /api/cms/*.
 * При подключении реальной CRM превращается в тонкий ACL-адаптер
 * (маппинг ответов Mica Gateway → контракт) — поверхность для сайта
 * не меняется (ADR-015).
 */
export async function GET(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  const url = new URL(request.url);
  const rawLocale = url.searchParams.get('locale');
  const locale = rawLocale === 'en' ? 'en' : 'ru';
  const key = params.path.join('/');

  // Детальная статья: articles/{slug}
  if (params.path.length === 2 && params.path[0] === 'articles') {
    const article = buildArticleDetail(params.path[1]!, locale);
    if (!article) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(article);
  }

  const builder = CMS_MOCK[key];
  if (!builder) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(builder(locale, url.searchParams));
}

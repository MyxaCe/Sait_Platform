import { breadcrumbJsonLd, jsonLdHtml, type Crumb } from '@/lib/seo/json-ld';

export function BreadcrumbJsonLd({ crumbs }: { crumbs: Crumb[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd(crumbs)) }} />;
}

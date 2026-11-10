import { setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { loadClientPromotions } from '@/lib/promo';
import { PromotionsScreen } from '@/features/promo/PromotionsScreen';

/** «Акции» (дизайн §3.6): участвую / доступные / начисления — всё из `@broker/promo`. */
export const dynamic = 'force-dynamic';

export default async function PromotionsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const loaded = await loadClientPromotions(user.id, params.locale);
  return <PromotionsScreen view={loaded.state === 'ok' ? loaded.data : null} />;
}

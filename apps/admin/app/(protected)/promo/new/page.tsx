import { notFound } from 'next/navigation';
import { Panel } from '@broker/ui';
import { isPromotionType } from '@broker/promo';
import { getOperatorSession } from '@/lib/auth/current';
import { canManagePromo } from '@/lib/promo/runtime';
import { getPromoSettings } from '@/lib/promo/queries';
import { PromoHeader } from '../_components/PromoHeader';
import { PromotionForm } from '../_components/PromotionForm';

/** Новая акция — черновик (только admin). Запуск — отдельным действием в карточке. */
export const dynamic = 'force-dynamic';

export default async function NewPromotionPage({ searchParams }: { searchParams: { type?: string } }) {
  const operator = await getOperatorSession();
  if (!canManagePromo(operator?.role)) notFound();
  const settings = await getPromoSettings();
  return (
    <div className="space-y-6">
      <PromoHeader
        active={null}
        settings={settings}
        title="Новая акция"
        description="Создаётся черновиком: клиенты её не видят, пока вы не запустите её в карточке."
        breadcrumbs={[{ label: 'Акции и партнёры', href: '/promo' }, { label: 'Новая акция' }]}
      />
      <Panel title="Условия и тексты" description="Создание — с основанием, пишется в журнал.">
        <PromotionForm
          initial={{
            type: isPromotionType(searchParams.type) ? searchParams.type : 'deposit_bonus',
            slug: '',
            title: '',
            cmsPromoId: '',
            startsAt: '',
            endsAt: '',
            budget: '',
            countriesAllow: '',
            countriesDeny: '',
            texts: {},
            rules: {},
          }}
        />
      </Panel>
    </div>
  );
}

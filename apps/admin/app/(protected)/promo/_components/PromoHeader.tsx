import Link from 'next/link';
import { Callout, PageHeader, Tabs } from '@broker/ui';
import type { PlatformPromoSettings } from '@broker/promo';

export type PromoTab = 'promotions' | 'queue' | 'contests' | 'referrals' | 'partners';

/**
 * Шапка раздела «Акции и партнёры»: заголовок, вкладки-ссылки, состояние
 * платформенного флага. Роль-гейт решают страницы.
 */
export function PromoHeader({
  active,
  settings,
  queueCount,
  title = 'Акции и партнёры',
  description = 'Бонусы, кешбэк, конкурсы, рефералы и IB. Все числа и тексты условий — здесь, не в коде. Деньги клиенту — только через очередь начислений с решением человека.',
  actions,
  breadcrumbs,
}: {
  active: PromoTab | null;
  settings: PlatformPromoSettings | null;
  queueCount?: number;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} breadcrumbs={breadcrumbs} />
      {active ? (
        <Tabs
          linkComponent={Link}
          active={active}
          aria-label="Разделы акций"
          items={[
            { key: 'promotions', label: 'Акции', href: '/promo' },
            {
              key: 'queue',
              label: 'К начислению',
              href: '/promo/queue',
              ...(queueCount ? { count: queueCount, countTone: 'warning' as const } : {}),
            },
            { key: 'contests', label: 'Конкурсы', href: '/promo/contests' },
            { key: 'referrals', label: 'Рефералы', href: '/promo/referrals' },
            { key: 'partners', label: 'IB-партнёры', href: '/promo/partners' },
          ]}
        />
      ) : null}
      {!settings ? (
        <Callout tone="warning" title="Настройки акций не найдены">
          Миграция акций на этой базе не применена — акции считаются выключенными.
        </Callout>
      ) : !settings.promotionsEnabled ? (
        <Callout tone="warning" title="Акции выключены на платформе">
          Клиенты не видят акций, новые участия и постановка в очередь закрыты (профиль юрисдикции).
          Уже стоящие в очереди начисления можно рассмотреть. Включить —{' '}
          <Link href="/settings" className="text-accent hover:underline">
            «Настройки платформы»
          </Link>
          .
        </Callout>
      ) : null}
    </div>
  );
}

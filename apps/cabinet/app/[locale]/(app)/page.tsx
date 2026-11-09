import { setRequestLocale } from 'next-intl/server';
import type { CabinetHomeModule } from '@broker/api-client';
import { BalanceModule } from '@/features/home/BalanceModule';
import { MarketsModule } from '@/features/home/MarketsModule';
import { OnboardingModule } from '@/features/home/OnboardingModule';
import { ProfileModule } from '@/features/home/ProfileModule';
import { PromotionsModule } from '@/features/home/PromotionsModule';
import { requireSessionUser } from '@/lib/auth/require';
import { getDemoAccount } from '@/lib/data';
import {
  getHomeModules,
  getMarketInstruments,
  getPromotions,
  getVerificationStatus,
} from '@/lib/home';
import { getTenantStartBalance } from '@/lib/tenant';
import type { RealAccountBlock } from '@/features/home/BalanceModule';
import { getMoneyPolicy, getRealAccount, terminalReader } from '@/lib/money';

async function loadRealBlock(userId: string, locale: string): Promise<RealAccountBlock> {
  const [account, policy, live] = await Promise.all([
    getRealAccount(userId),
    getMoneyPolicy(userId),
    terminalReader()
      .accounts(userId)
      .catch(() => ({ state: 'unavailable' as const })),
  ]);
  const acc = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'real') : undefined;
  return {
    account,
    policy,
    live: acc ? { equityMinor: acc.equityMinor, freeMarginMinor: acc.freeMarginMinor } : null,
    locale,
  };
}

/**
 * Главная кабинета (ADR-026): модули из per-site конфига CMS —
 * порядок, включённость и подпункты решает редактор.
 * Реестр «тип → компонент»; неизвестный тип пропущен ещё парсером.
 */
export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const modules = await getHomeModules(params.locale);

  // Данные тянем только для включённых модулей
  const needs = (type: CabinetHomeModule['type']) =>
    modules.some((m) => m.type === type && m.enabled);

  const [demo, verification, markets, promos, startBalance] = await Promise.all([
    needs('balance') ? getDemoAccount(user.id) : null,
    needs('onboarding') ? getVerificationStatus(user.id) : ('none' as const),
    needs('markets') ? getMarketInstruments() : null,
    needs('promotions') ? getPromotions(params.locale) : [],
    // Состояние стартовой суммы нужно самому модулю: кнопка сброса
    // обязана объяснить, почему не работает, а не исчезнуть.
    getTenantStartBalance(),
  ]);

  // Реальный счёт (09.11): проекция + политика + живые цифры терминала.
  // Терминал недоступен — главная всё равно рисуется (свой failure domain).
  const real: RealAccountBlock | undefined = needs('balance')
    ? await loadRealBlock(user.id, params.locale)
    : undefined;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {modules.map((module, i) => {
        if (!module.enabled) return null;
        switch (module.type) {
          case 'profile':
            return <ProfileModule key={i} user={user} />;
          case 'onboarding':
            return <OnboardingModule key={i} config={module} verification={verification} />;
          case 'balance':
            return (
              <BalanceModule
                key={i}
                config={module}
                demo={demo}
                startBalance={startBalance}
                real={real}
              />
            );
          case 'markets':
            // `markets === null` только когда модуль выключен, а выключенные
            // отсеяны строкой выше — ветка недостижима и существует ради
            // типа. Модуль НЕ исчезает ни в одном состоянии данных: о том,
            // почему он пуст, он рассказывает сам (Р-025, п. 3).
            return markets ? <MarketsModule key={i} config={module} data={markets} /> : null;
          case 'promotions':
            return <PromotionsModule key={i} items={promos} locale={params.locale} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

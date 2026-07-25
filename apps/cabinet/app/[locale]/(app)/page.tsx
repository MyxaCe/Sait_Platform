import { setRequestLocale } from 'next-intl/server';
import type { CabinetHomeModule } from '@broker/api-client';
import { BalanceModule } from '@/features/home/BalanceModule';
import { MarketsModule } from '@/features/home/MarketsModule';
import { OnboardingModule } from '@/features/home/OnboardingModule';
import { ProfileModule } from '@/features/home/ProfileModule';
import { PromotionsModule } from '@/features/home/PromotionsModule';
import { getSessionUser } from '@/lib/auth/session';
import { getDemoAccount } from '@/lib/data';
import {
  getHomeModules,
  getMarketInstruments,
  getPromotions,
  getVerificationStatus,
} from '@/lib/home';

/**
 * Главная кабинета (ADR-026): модули из per-site конфига CMS —
 * порядок, включённость и подпункты решает редактор.
 * Реестр «тип → компонент»; неизвестный тип пропущен ещё парсером.
 */
export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const modules = await getHomeModules(params.locale);

  // Данные тянем только для включённых модулей
  const needs = (type: CabinetHomeModule['type']) =>
    modules.some((m) => m.type === type && m.enabled);

  const [demo, verification, instruments, promos] = await Promise.all([
    needs('balance') ? getDemoAccount(user.id) : null,
    needs('onboarding') ? getVerificationStatus(user.id) : ('none' as const),
    needs('markets') ? getMarketInstruments() : [],
    needs('promotions') ? getPromotions(params.locale) : [],
  ]);

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
            return <BalanceModule key={i} config={module} demo={demo} />;
          case 'markets':
            return <MarketsModule key={i} config={module} instruments={instruments} />;
          case 'promotions':
            return <PromotionsModule key={i} items={promos} locale={params.locale} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

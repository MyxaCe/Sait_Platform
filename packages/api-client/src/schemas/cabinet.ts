import { z } from 'zod';

/**
 * Конфиг главной страницы кабинета (ADR-026): per-site набор МОДУЛЕЙ
 * с порядком, выключателями и настройками подпунктов. Это НЕ page-builder
 * (TD-001): реестр известных типизированных модулей по модели ADR-010 —
 * кабинет рендерит `type → компонент`, неизвестный тип пропускает.
 * Ресурс контракта: GET /v1/cms/cabinet-home?site=&locale=
 */

export const cabinetProfileModuleSchema = z.object({
  type: z.literal('profile'),
  enabled: z.boolean(),
});

export const cabinetOnboardingModuleSchema = z.object({
  type: z.literal('onboarding'),
  enabled: z.boolean(),
  steps: z.object({
    verification: z.boolean(),
    deposit: z.boolean(),
    firstTrade: z.boolean(),
  }),
});

export const cabinetBalanceModuleSchema = z.object({
  type: z.literal('balance'),
  enabled: z.boolean(),
  buttons: z.object({
    deposit: z.boolean(),
    withdraw: z.boolean(),
    buyFiat: z.boolean(),
  }),
});

export const cabinetMarketsModuleSchema = z.object({
  type: z.literal('markets'),
  enabled: z.boolean(),
  tabs: z.object({
    assets: z.boolean(),
    popular: z.boolean(),
    newListing: z.boolean(),
    favorites: z.boolean(),
    gainers: z.boolean(),
    volume: z.boolean(),
  }),
  /** Канонические символы для таба «Новый листинг» (редактируется в CMS) */
  newListingSymbols: z.array(z.string()),
});

export const cabinetPromotionsModuleSchema = z.object({
  type: z.literal('promotions'),
  enabled: z.boolean(),
});

/** Строгая схема модуля — ею CMS валидирует свои ответы */
export const cabinetHomeModuleSchema = z.discriminatedUnion('type', [
  cabinetProfileModuleSchema,
  cabinetOnboardingModuleSchema,
  cabinetBalanceModuleSchema,
  cabinetMarketsModuleSchema,
  cabinetPromotionsModuleSchema,
]);
export type CabinetHomeModule = z.infer<typeof cabinetHomeModuleSchema>;

/** Строгий ответ (валидация на стороне CMS) */
export const cabinetHomeResponseSchema = z.object({
  modules: z.array(cabinetHomeModuleSchema),
});
export type CabinetHomeResponse = z.infer<typeof cabinetHomeResponseSchema>;

/**
 * Мягкий парс для ПОТРЕБИТЕЛЯ (кабинета): каждый модуль парсится отдельно,
 * невалидные/неизвестные типы отбрасываются с сохранением остальных —
 * новые модули в CMS не ломают старые версии кабинета (ADR-010).
 */
export function parseCabinetHomeModules(data: unknown): CabinetHomeModule[] {
  const raw = (data as { modules?: unknown[] })?.modules;
  if (!Array.isArray(raw)) return [];
  const modules: CabinetHomeModule[] = [];
  for (const item of raw) {
    const parsed = cabinetHomeModuleSchema.safeParse(item);
    if (parsed.success) modules.push(parsed.data);
  }
  return modules;
}

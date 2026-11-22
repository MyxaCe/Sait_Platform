import { z } from 'zod';

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
  newListingSymbols: z.array(z.string()),
});

export const cabinetPromotionsModuleSchema = z.object({
  type: z.literal('promotions'),
  enabled: z.boolean(),
});

export const cabinetHomeModuleSchema = z.discriminatedUnion('type', [
  cabinetProfileModuleSchema,
  cabinetOnboardingModuleSchema,
  cabinetBalanceModuleSchema,
  cabinetMarketsModuleSchema,
  cabinetPromotionsModuleSchema,
]);
export type CabinetHomeModule = z.infer<typeof cabinetHomeModuleSchema>;

export const cabinetHomeResponseSchema = z.object({
  modules: z.array(cabinetHomeModuleSchema),
});
export type CabinetHomeResponse = z.infer<typeof cabinetHomeResponseSchema>;

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

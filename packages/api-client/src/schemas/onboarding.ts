import { z } from 'zod';

/** Части экскурсии по платформе. */
export const ONBOARDING_PARTS = ['registration', 'cabinet', 'terminal'] as const;
export type OnboardingPart = (typeof ONBOARDING_PARTS)[number];

export const onboardingStepSchema = z.object({
  anchor: z.string().min(1),
  title: z.string(),
  body: z.string(),
});
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingPartSchema = z.object({
  part: z.enum(ONBOARDING_PARTS),
  version: z.number().int().min(1),
  steps: z.array(onboardingStepSchema),
});
export type OnboardingPartConfig = z.infer<typeof onboardingPartSchema>;

export const onboardingLabelsSchema = z.object({
  back: z.string(),
  next: z.string(),
  skip: z.string(),
  done: z.string(),
  help: z.string(),
  stepOf: z.string(),
});
export type OnboardingLabels = z.infer<typeof onboardingLabelsSchema>;

/** Ответ CMS `GET /v1/cms/onboarding` — только включённые части. */
export const onboardingResponseSchema = z.object({
  parts: z.array(onboardingPartSchema),
  labels: onboardingLabelsSchema,
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

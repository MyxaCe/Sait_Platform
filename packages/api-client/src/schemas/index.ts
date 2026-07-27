import type { z } from 'zod';
import {
  academyResponseSchema,
  accountsResponseSchema,
  articlesResponseSchema,
  articleSchema,
  brandSchema,
  careersResponseSchema,
  contactsResponseSchema,
  faqResponseSchema,
  instrumentsResponseSchema,
  legalResponseSchema,
  navigationSchema,
  partnersResponseSchema,
  promotionsResponseSchema,
  streamsResponseSchema,
  systemStatusResponseSchema,
} from './cms';
import { cabinetHomeResponseSchema } from './cabinet';
import { eventEnvelopeSchema, leadSubmittedDataSchema } from './events';
import {
  incomingEnvelopeSchema,
  terminalAccountOpenedSchema,
  terminalBalanceChangedSchema,
  terminalTradeExecutedSchema,
} from './terminal-events';
import {
  accountOpeningLeadResponseSchema,
  accountOpeningLeadSchema,
  contactLeadResponseSchema,
  contactLeadSchema,
  leadErrorResponseSchema,
} from './leads';

export * from './common';
export * from './cms';
export * from './cabinet';
export * from './events';
export * from './terminal-events';
export * from './leads';

/**
 * Реестр «эндпоинт контракта → схема ответа».
 * Используется генератором JSON Schema (артефакт для команды CRM)
 * и контрактными тестами mock-CRM.
 */
export const CMS_RESPONSE_SCHEMAS = {
  brand: brandSchema,
  navigation: navigationSchema,
  instruments: instrumentsResponseSchema,
  accounts: accountsResponseSchema,
  faq: faqResponseSchema,
  promotions: promotionsResponseSchema,
  partners: partnersResponseSchema,
  academy: academyResponseSchema,
  streams: streamsResponseSchema,
  articles: articlesResponseSchema,
  article: articleSchema,
  contacts: contactsResponseSchema,
  careers: careersResponseSchema,
  legal: legalResponseSchema,
  'system-status': systemStatusResponseSchema,
  'cabinet-home': cabinetHomeResponseSchema,
} satisfies Record<string, z.ZodTypeAny>;

export const EVENT_SCHEMAS = {
  'envelope.v1': eventEnvelopeSchema,
  'incoming-envelope.v1': incomingEnvelopeSchema,
  'lead.submitted.v1': leadSubmittedDataSchema,
  'terminal.account.opened.v1': terminalAccountOpenedSchema,
  'terminal.balance.changed.v1': terminalBalanceChangedSchema,
  'terminal.trade.executed.v1': terminalTradeExecutedSchema,
} satisfies Record<string, z.ZodTypeAny>;

export const LEAD_SCHEMAS = {
  'account-opening.request': accountOpeningLeadSchema,
  'account-opening.response': accountOpeningLeadResponseSchema,
  'contact.request': contactLeadSchema,
  'contact.response': contactLeadResponseSchema,
  'error.response': leadErrorResponseSchema,
} satisfies Record<string, z.ZodTypeAny>;

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import policy from '../scrubbing-policy.v1.json';

/** Политика скраббинга — контрактный артефакт: проверяем её структуру. */
const policySchema = z.object({
  version: z.number().int().positive(),
  sendDefaultPii: z.literal(false),
  removeHeaders: z.array(z.string().toLowerCase()),
  maskQueryParams: z.array(z.string()),
  requestBodies: z.object({
    mode: z.literal('allowlist'),
    neverAttachPathPrefixes: z.array(z.string().startsWith('/')),
    allowedFields: z.array(z.string()),
  }),
  valueScrubRegexes: z.array(z.object({ name: z.string(), pattern: z.string() })),
  userContext: z.object({
    allowedKeys: z.array(z.string()),
    hashAlgorithm: z.literal('sha256'),
  }),
  replacement: z.string(),
});

describe('scrubbing-policy.v1.json', () => {
  it('соответствует схеме политики', () => {
    expect(() => policySchema.parse(policy)).not.toThrow();
  });

  it('все regex компилируются и ловят эталонные значения', () => {
    const samples: Record<string, string> = {
      email: 'ivan.petrov@example.com',
      phone: '+7 900 123-45-67',
      card_pan: '4111 1111 1111 1111',
      iban: 'DE89370400440532013000',
    };
    for (const { name, pattern } of policy.valueScrubRegexes) {
      const re = new RegExp(pattern);
      expect(re.test(samples[name] ?? ''), `${name} должен ловить пример`).toBe(true);
    }
  });

  it('критичные пути никогда не прикладывают тела', () => {
    const prefixes = policy.requestBodies.neverAttachPathPrefixes;
    expect(prefixes).toContain('/api/leads');
    expect(prefixes).toContain('/api/v1/auth');
  });
});

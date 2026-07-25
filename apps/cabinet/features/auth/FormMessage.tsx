'use client';

import { useTranslations } from 'next-intl';

/** Общая ошибка формы: ключ из ActionState.error → перевод (ADR-011). */
export function FormMessage({ error }: { error?: string }) {
  const t = useTranslations('validation');
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
      {t.has(error) ? t(error) : error}
    </p>
  );
}

/** Перевод ошибки поля (ключ или как есть). */
export function useFieldError() {
  const t = useTranslations('validation');
  return (key?: string) => (key ? (t.has(key) ? t(key) : key) : undefined);
}

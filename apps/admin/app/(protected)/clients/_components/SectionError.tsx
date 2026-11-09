'use client';

import { Button, Callout } from '@broker/ui';

/**
 * Сбой источника на странице раздела (концепция §1 п.8, §6.8): не «белый
 * экран», а Callout — что случилось и что делать. Используется в `error.tsx`
 * разделов «Верификация» и «AML». Кандидат в @broker/ui (вместе с error-границей).
 */
export function SectionError({ title, reset, digest }: { title: string; reset: () => void; digest?: string }) {
  return (
    <div className="space-y-5">
      <Callout
        tone="negative"
        title={title}
        actions={
          <Button type="button" size="xs" variant="secondary" onClick={reset}>
            Повторить
          </Button>
        }
      >
        Источник данных не ответил — страница не показана, чтобы не принимать решение по
        неполным данным. Ничего не изменено и в журнал не записано.
        {digest ? <span className="mt-1 block text-xs text-muted">Код ошибки: {digest}</span> : null}
      </Callout>
    </div>
  );
}

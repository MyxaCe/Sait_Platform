'use client';

import { Button, Callout } from '@broker/ui';

export default function ProtectedError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Callout
        tone="warning"
        title="Раздел временно недоступен"
        actions={
          <Button type="button" size="xs" variant="secondary" onClick={reset}>
            Повторить
          </Button>
        }
      >
        Данные не удалось получить. Ничего не изменено — повторите через минуту; если ошибка
        повторяется, сообщите администратору платформы.
      </Callout>
    </div>
  );
}

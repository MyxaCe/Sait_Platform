'use client';

import type { ReactNode } from 'react';
import { Select } from '@broker/ui';

/**
 * Селект фильтра, который сам отправляет свою GET-форму при выборе
 * (прогрессивное улучшение: без JS работает кнопка «Применить»).
 */
export function AutoSubmitSelect({
  name,
  defaultValue,
  className,
  children,
}: {
  name: string;
  defaultValue: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Select
      name={name}
      defaultValue={defaultValue}
      controlSize="compact"
      className={className}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {children}
    </Select>
  );
}

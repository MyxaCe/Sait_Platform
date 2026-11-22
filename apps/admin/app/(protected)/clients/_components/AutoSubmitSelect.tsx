'use client';

import type { ReactNode } from 'react';
import { Select } from '@broker/ui';

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

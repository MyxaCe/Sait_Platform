import type { ElementType, HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

export function Container({ as: Tag = 'div', className, ...props }: ContainerProps) {
  return (
    <Tag
      className={cn('mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8', className)}
      {...props}
    />
  );
}

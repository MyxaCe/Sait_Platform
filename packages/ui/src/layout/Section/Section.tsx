import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Вертикальный ритм секций: mobile-first отступы, расширяются на десктопе. */
export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('py-16 md:py-24', className)} {...props} />;
}

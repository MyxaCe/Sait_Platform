import { Skeleton } from '@broker/ui';

/**
 * Загрузка раздела кабинета: каркас вместо пустоты (концепция §1.8 — «пусто ≠
 * сломалось ≠ грузится»). Форма повторяет главную: шапка профиля, две карточки
 * счетов, ряд шагов — на остальных разделах читается как «грузится контент».
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:gap-5 xl:max-w-[1600px]" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border bg-elevated p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-3 w-48" />
            <div className="grid grid-cols-3 gap-2 pt-4">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

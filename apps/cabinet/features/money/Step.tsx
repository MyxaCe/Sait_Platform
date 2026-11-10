/** Пронумерованный шаг денежного сценария (ввод: адрес → хэш → история). */
export function Step({
  n,
  title,
  children,
  muted = false,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  /** Шаг недоступен сейчас — номер серый. */
  muted?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-elevated p-4 sm:p-5" aria-label={title}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={
            muted
              ? 'grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-muted'
              : 'grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent'
          }
        >
          {n}
        </span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

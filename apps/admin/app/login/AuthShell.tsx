import type { ReactNode } from 'react';

/**
 * Каркас страниц входа и настройки 2FA — первое, что видит человек у двери
 * центра управления. Строго: слева марка и три факта о периметре (на узком
 * экране — только марка сверху), справа форма. Без градиентов и иллюстраций —
 * только токены (концепция §1).
 */

function Fact({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="border-border bg-card text-secondary flex size-9 shrink-0 items-center justify-center rounded-md border">
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="text-primary block text-sm font-medium">{title}</span>
        <span className="text-secondary block text-[13px]">{text}</span>
      </span>
    </li>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="bg-accent text-on-accent flex size-8 items-center justify-center rounded-md text-sm font-bold"
      >
        W
      </span>
      <span className="leading-tight">
        <span className="text-primary block text-sm font-semibold">Wholesalefy</span>
        <span className="text-muted block text-[11px]">Центр управления</span>
      </span>
    </div>
  );
}

export function AuthShell({
  step,
  title,
  description,
  children,
}: {
  /** «Шаг 1 из 2 · пароль» — над заголовком. */
  step?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh">
      <aside className="border-border bg-elevated hidden w-[42%] max-w-[560px] shrink-0 flex-col justify-between border-r px-10 py-10 lg:flex">
        <Brand />
        <div className="space-y-8">
          <div className="space-y-2">
            <h2 className="text-primary text-2xl font-semibold tracking-tight">
              Операторский периметр брокерской платформы
            </h2>
            <p className="text-secondary max-w-md text-sm">
              Клиенты и комплаенс, деньги, плечо и журнал — в одном месте, под ролью и с
              основанием для каждого действия.
            </p>
          </div>
          <ul className="space-y-5">
            <Fact
              icon="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2"
              title="Пароль и второй фактор"
              text="Вход только с кодом из приложения-аутентификатора."
            />
            <Fact
              icon="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"
              title="Неизменяемый журнал"
              text="Каждое изменение записывается с именем оператора и основанием."
            />
            <Fact
              icon="M12 3l7 3v5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6zM9 12l2 2 4-4"
              title="Доступ по ролям"
              text="Оператор видит только разделы своей роли."
            />
          </ul>
        </div>
        <p className="text-muted text-xs">Закрытая зона для сотрудников платформы.</p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px] space-y-8">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="space-y-1.5">
            {step ? <p className="text-muted text-xs font-medium">{step}</p> : null}
            <h1 className="text-primary text-xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-secondary text-sm">{description}</p> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

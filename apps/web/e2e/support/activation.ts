import { expect, type Page } from '@playwright/test';
import pg from 'pg';

/**
 * Регистрация в кабинете требует подтверждения почты (решение владельца 26.11): после
 * формы — экран «Проверьте почту», сессии нет. В сквозных сценариях письмо никто не
 * читает, поэтому ссылка берётся из очереди исходящих писем в базе кабинета
 * (`outbound_mail`), а дальше — как у клиента: открыть ссылку и нажать кнопку.
 *
 * Нужен `CABINET_DATABASE_URL` (та же база, что у кабинета). Без него сценарий с
 * регистрацией не может дойти до кабинета — это отказ с объяснением, а не тихий пропуск.
 */
export async function confirmRegistration(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId('check-email'), 'после регистрации нет экрана «Проверьте почту»').toBeVisible({
    timeout: 15_000,
  });
  const url = process.env.CABINET_DATABASE_URL;
  if (!url) {
    throw new Error(
      'CABINET_DATABASE_URL не задан: ссылку подтверждения почты негде взять, регистрация в кабинете не завершится',
    );
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let link: string | null = null;
  try {
    for (let i = 0; i < 20 && !link; i++) {
      const r = await client.query(
        `SELECT body_text FROM outbound_mail WHERE purpose = 'email_verify' AND lower(to_address) = lower($1)
          ORDER BY created_at DESC LIMIT 1`,
        [email],
      );
      const body = r.rows[0]?.body_text as string | undefined;
      link = body ? (/(https?:\/\/\S+token=[A-Za-z0-9_-]+)/.exec(body)?.[1] ?? null) : null;
      if (!link) await new Promise((res) => setTimeout(res, 250));
    }
  } finally {
    await client.end();
  }
  expect(link, `в outbound_mail нет письма подтверждения для ${email}`).toBeTruthy();
  const target = new URL(link!);
  const cabinet = process.env.CABINET_URL;
  await page.goto(cabinet ? `${cabinet.replace(/\/+$/, '')}${target.pathname}${target.search}` : link!);
  await page.getByTestId('confirm-email').getByRole('button').click();
  await expect(page, 'ссылка подтверждения не впустила в кабинет').not.toHaveURL(/verify-email|check-email|\/login/, {
    timeout: 15_000,
  });
}

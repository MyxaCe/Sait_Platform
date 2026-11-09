import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './session';

/**
 * Пользователь страницы зоны `(app)` или редирект на вход.
 *
 * Раньше страницы писали `(await getSessionUser())!`, полагаясь на то, что
 * layout уже отсёк гостя. Но layout и страница рендерятся параллельно и
 * каждая читает сессию сама: сессия, протухшая (или погашенная оператором,
 * или клиент заблокирован) между двумя чтениями, давала `null`, и `!` превращал
 * его в TypeError на `user.id` — белая страница ошибки вместо входа.
 */
export async function requireSessionUser(locale: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(locale === 'en' ? '/en/login' : '/login');
  return user;
}

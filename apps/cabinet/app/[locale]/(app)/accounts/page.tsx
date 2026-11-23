import { redirect } from '@/i18n/redirect';

// «Условия счетов» переехали в Обзор (блок #account-terms); старый адрес ведёт туда, чтобы ссылки не давали 404.
export default async function AccountsPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/#account-terms', locale: params.locale });
}

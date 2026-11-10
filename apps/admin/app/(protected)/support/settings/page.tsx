import { notFound, redirect } from 'next/navigation';
import { DescriptionList, Mono, PageHeader, StatusBadge } from '@broker/ui';
import {
  WEEKDAYS,
  loadSupportSettings,
  readMailChannelState,
  settingsMeta,
  supportAccess,
  type SupportTexts,
} from '@broker/support';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getPool } from '@/lib/db';
import { saveSettingsAction } from '@/lib/support/actions';
import { supportActor } from '@/lib/support/runtime';
import { fmtDateTime } from '@/lib/ui/format';
import { MailStatusCallout } from '../_components/MailStatus';
import { SupportSettingsForm } from '../_components/SettingsForms';
import { SupportNav } from '../_components/SupportNav';

/**
 * Настройки поддержки (только admin): каналы, часы, SLA, автоответы, лимиты,
 * тексты RU/EN — ничего не хардкодим. Изменение — с основанием, в журнал
 * «до/после». Секреты ящика здесь не живут (env ячейки).
 */
export const dynamic = 'force-dynamic';

const DAY_LABEL: Record<string, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
const TEXT_LABEL: { key: keyof SupportTexts; label: string; rows: number }[] = [
  { key: 'greeting', label: 'Приветствие в чате', rows: 2 },
  { key: 'offHours', label: 'Вне рабочих часов', rows: 2 },
  { key: 'autoReply', label: 'Автоответ: обращение получено', rows: 2 },
  { key: 'signature', label: 'Подпись в письмах', rows: 2 },
  { key: 'formIntro', label: 'Подзаголовок формы на сайте', rows: 2 },
  { key: 'csatPrompt', label: 'Просьба оценить', rows: 2 },
  { key: 'passwordResetSubject', label: 'Сброс пароля: тема', rows: 1 },
  { key: 'passwordResetBody', label: 'Сброс пароля: письмо', rows: 5 },
  { key: 'emailVerifySubject', label: 'Подтверждение email: тема', rows: 1 },
  { key: 'emailVerifyBody', label: 'Подтверждение email: письмо', rows: 5 },
];

export default async function SupportSettingsPage() {
  const actor = await supportActor();
  if (!actor) redirect(LOGIN_PATH);
  if (!supportAccess.managesSettings(actor.role)) notFound();
  const db = getPool();
  const [s, mail, meta] = await Promise.all([loadSupportSettings(db), readMailChannelState(db), settingsMeta(db)]);

  const mailInfo = (
    <div className="space-y-3">
      <MailStatusCallout state={mail} emailEnabled={s.channels.email} isAdmin compact={false} />
      <DescriptionList
        columns={2}
        items={[
          {
            term: 'Ящик поддержки',
            value: mail.state === 'ok' && mail.mailbox ? <Mono value={mail.mailbox} /> : <span className="text-muted">не задан</span>,
            hint: 'SUPPORT_MAIL_ADDRESS',
          },
          {
            term: 'Состояние',
            value: <StatusBadge status={mail.state === 'ok' ? 'mail_sent' : mail.state === 'notConfigured' ? 'mail_cancelled' : 'mail_failed'} label={mail.state === 'ok' ? 'Подключена' : mail.state === 'notConfigured' ? 'Не настроена' : 'Воркер не отвечает'} />,
          },
          { term: 'Приём (IMAP)', value: mail.state === 'ok' ? (mail.imap ? (mail.lastInboundOkAt ? `ок, ${fmtDateTime(mail.lastInboundOkAt)}` : 'подключён') : 'не настроен') : '—' },
          { term: 'Отправка (SMTP)', value: mail.state === 'ok' ? (mail.lastOutboundOkAt ? `ок, ${fmtDateTime(mail.lastOutboundOkAt)}` : 'писем ещё не было') : '—' },
          { term: 'В очереди', value: String(mail.queue.queued), numeric: true },
          { term: 'Не доставлено', value: String(mail.queue.failed), numeric: true, tone: mail.queue.failed ? 'negative' : 'default' },
        ]}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Поддержка"
        description="Настройки модуля поддержки этой ячейки: каналы, часы работы, SLA, автоответы и тексты для клиентов."
        meta={meta.updatedAt ? `Изменено ${fmtDateTime(meta.updatedAt)} · ${meta.updatedByName}` : 'Действуют значения по умолчанию — ещё не сохранялись'}
      />
      <SupportNav active="settings" isAdmin />
      <SupportSettingsForm
        action={saveSettingsAction}
        mailInfo={mailInfo}
        initial={{
          channels: s.channels,
          timezone: s.hours.timezone,
          alwaysOpen: s.hours.alwaysOpen,
          week: WEEKDAYS.map((d) => ({
            key: d,
            label: DAY_LABEL[d]!,
            on: s.hours.week[d] !== null,
            open: s.hours.week[d]?.open ?? '09:00',
            close: s.hours.week[d]?.close ?? '18:00',
          })),
          holidays: s.hours.holidays.join(' '),
          sla: { chat: s.sla.chatFirstResponseMinutes, email: s.sla.emailFirstResponseMinutes, webForm: s.sla.webFormFirstResponseMinutes },
          autoReply: s.autoReply.enabled,
          autoCloseDays: s.autoCloseDays,
          maxMb: String(Math.round((s.attachments.maxBytes / 1024 / 1024) * 10) / 10).replace('.', ','),
          limits: { chat: s.limits.chatMessagesPerMinute, email: s.limits.emailsPerSenderPerHour },
          fromName: s.mail.fromName,
          categories: s.categories.map((c) => `${c.key} | ${c.label.ru} | ${c.label.en}`).join('\n'),
          texts: TEXT_LABEL.map((t) => ({ ...t, ru: s.texts.ru[t.key], en: s.texts.en[t.key] })),
        }}
      />
    </div>
  );
}

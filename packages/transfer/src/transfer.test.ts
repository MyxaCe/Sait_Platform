import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postClientChatMessage, DEFAULT_SUPPORT_SETTINGS, markMailSent, type SupportSettings } from '@broker/support';
import { createTestDb, seedOperator, seedUser, type TestDb } from '@broker/support/testing';
import {
  bindInviteWithinTx,
  checkDirection,
  closeSourceAccount,
  createTransfer,
  deliverDue,
  handleIncoming,
  inspectInvite,
  listTicketsForTransfer,
  managerAlert,
  mentionsOtherPlatform,
  parseRegistryJson,
  publicKeyPemOf,
  revokeTransfer,
  runTransferTick,
  setMoneyFlagsWithinTx,
  signEnvelope,
  upsertGroupPlatformWithinTx,
  verifyEnvelope,
  type Envelope,
  type FetchLike,
  type GroupPlatformInput,
  type TransferTerminalPort,
} from './index';

/**
 * Две платформы в одном тесте: две независимые базы (PGlite со всеми
 * миграциями), свои ключи, «сеть» — fetch, который вызывает приёмник другой
 * базы. Проверяется весь путь: тикет клиента → перевод менеджером → пакет →
 * приглашение → регистрация → статусы назад → возврат admin на двух стадиях;
 * и запреты: без доказательства, тикет оператора, запрещённое направление,
 * неверная подпись, повтор.
 */

const ALWAYS: SupportSettings = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true } };

interface Cell {
  slug: string;
  db: TestDb;
  key: KeyObject;
}

let apex: Cell;
let nordex: Cell;
let fetchLog: { url: string; status: number }[];
let tamper: ((body: string) => string) | null;

const keyPair = () => generateKeyPairSync('ed25519').privateKey;

function profile(c: Cell, extra: Partial<GroupPlatformInput> = {}): GroupPlatformInput {
  return {
    slug: c.slug,
    name: c.slug === 'apex-ru' ? 'Apex Markets' : 'Nordex Markets',
    legalEntity: c.slug === 'apex-ru' ? 'Apex Ltd' : 'Nordex EU Ltd',
    regulator: null,
    cabinetUrl: `https://cabinet.${c.slug}.test`,
    apiUrl: `http://${c.slug}.internal:3005`,
    publicKeyPem: publicKeyPemOf(c.key),
    euLicense: c.slug === 'nordex-eu',
    servedCountries: [],
    forbiddenCountries: c.slug === 'nordex-eu' ? ['US', 'KP'] : [],
    maxRetailLeverage: c.slug === 'nordex-eu' ? 30 : 100,
    bonusesAllowed: false,
    acceptsTransfers: true,
    ...extra,
  };
}

const fetchFor =
  (cells: Cell[]): FetchLike =>
  async (url, init) => {
    const target = cells.find((c) => url.startsWith(`http://${c.slug}.internal:3005`));
    if (!target) throw new Error('ECONNREFUSED');
    const res = await handleIncoming(target.db, tamper ? tamper(init.body) : init.body, { selfSlug: target.slug });
    fetchLog.push({ url, status: res.status });
    return { status: res.status, text: async () => JSON.stringify(res.body) };
  };

const nullTerminal: TransferTerminalPort = {
  setTradingFrozen: async () => 'ok',
  realAccountState: async () => ({ balanceMinor: 0, equityMinor: 0, openPositions: 0 }),
};

async function tick(c: Cell) {
  return runTransferTick(c.db, { selfSlug: c.slug, signingKey: c.key, fetch: fetchFor([apex, nordex]), terminal: nullTerminal });
}

async function seedRegistry(cell: Cell, admin: string, overrides: Record<string, Partial<GroupPlatformInput>> = {}) {
  for (const c of [apex, nordex]) {
    const r = await upsertGroupPlatformWithinTx(cell.db, { operatorId: admin, basis: 'реестр группы', platform: profile(c, overrides[c.slug]) });
    expect(r.ok).toBe(true);
  }
}

let manager: string;
let admin: string;
let otherOperator: string;
let client: string;

async function makeManager(db: TestDb, userId: string) {
  const id = await seedOperator(db, 'operator', 'mgr');
  await db.query(`UPDATE operators SET is_client_manager = true WHERE id = $1`, [id]);
  await db.query(
    `INSERT INTO client_managers (user_id, manager_id, assigned_by, reason) VALUES ($1, $2, $2, 'закреплён')`,
    [userId, id],
  );
  return id;
}

async function clientTicket(text = 'Прошу перевести мой счёт на Nordex Markets, согласен на передачу моих данных.') {
  const r = await postClientChatMessage(apex.db, ALWAYS, { userId: client, body: text });
  if (!r.ok) throw new Error('тикет не создан');
  const m = await apex.db.query(`SELECT id FROM support_messages WHERE ticket_id = $1 ORDER BY created_at LIMIT 1`, [r.ticketId]);
  return { ticketId: r.ticketId, messageId: String(m.rows[0]!.id) };
}

async function sendTransfer(extra: Partial<Parameters<typeof createTransfer>[1]> = {}) {
  const t = await clientTicket();
  return createTransfer(apex.db, {
    operatorId: manager,
    userId: client,
    targetSlug: 'nordex-eu',
    ticketId: t.ticketId,
    consentMessageId: t.messageId,
    consentConfirmed: true,
    basis: 'Заявление клиента в тикете поддержки',
    selfSlug: 'apex-ru',
    ...extra,
  });
}

beforeEach(async () => {
  apex = { slug: 'apex-ru', db: await createTestDb(), key: keyPair() };
  nordex = { slug: 'nordex-eu', db: await createTestDb(), key: keyPair() };
  fetchLog = [];
  tamper = null;
  admin = await seedOperator(apex.db, 'admin', 'adm');
  otherOperator = await seedOperator(apex.db, 'operator', 'other');
  client = await seedUser(apex.db, { email: 'anna@client.test', name: 'Анна Клиентова' });
  await apex.db.query(`UPDATE users SET country = 'DE' WHERE id = $1`, [client]);
  manager = await makeManager(apex.db, client);
  await seedRegistry(apex, admin);
  const nordexAdmin = await seedOperator(nordex.db, 'admin', 'nadm');
  await seedRegistry(nordex, nordexAdmin);
});
afterEach(async () => {
  await apex.db.close();
  await nordex.db.close();
});

describe('подпись и конверт', () => {
  it('подпись проверяется публичным ключом; подмена данных и чужой ключ — нет', () => {
    const env: Envelope = {
      v: 1,
      kind: 'transfer.status',
      messageId: 'm1',
      from: 'apex-ru',
      to: 'nordex-eu',
      transferId: '00000000-0000-4000-8000-000000000001',
      issuedAt: new Date().toISOString(),
      nonce: 'n1',
      data: { a: 1, b: [1, 2] },
    };
    const signed = signEnvelope(env, apex.key);
    expect(verifyEnvelope(signed, publicKeyPemOf(apex.key))).toBe(true);
    // порядок ключей не важен (каноническая форма)
    const reordered = { signature: signed.signature, envelope: { ...env, data: { b: [1, 2], a: 1 } } };
    expect(verifyEnvelope(reordered, publicKeyPemOf(apex.key))).toBe(true);
    expect(verifyEnvelope({ ...signed, envelope: { ...env, data: { a: 2, b: [1, 2] } } }, publicKeyPemOf(apex.key))).toBe(false);
    expect(verifyEnvelope(signed, publicKeyPemOf(nordex.key))).toBe(false);
  });
});

describe('политика направлений', () => {
  it('запрет страны в цели — жёстко; ЕС-резидент в цель без лицензии ЕС — подсказка', () => {
    const p = (o: Partial<GroupPlatformInput>) => ({ ...profile(nordex, o), updatedAt: null });
    expect(checkDirection({ selfSlug: 'apex-ru', source: null, target: p({}), clientCountry: 'US' }).blockers).toContain('countryForbidden');
    expect(checkDirection({ selfSlug: 'apex-ru', source: null, target: p({ servedCountries: ['FR'] }), clientCountry: 'DE' }).blockers).toContain(
      'countryNotServed',
    );
    expect(checkDirection({ selfSlug: 'apex-ru', source: null, target: p({ euLicense: false }), clientCountry: 'DE' }).hints).toContain(
      'euResidentNonEuTarget',
    );
    expect(checkDirection({ selfSlug: 'nordex-eu', source: null, target: p({}), clientCountry: 'DE' }).blockers).toContain('targetIsSelf');
    expect(checkDirection({ selfSlug: 'apex-ru', source: null, target: p({ acceptsTransfers: false }), clientCountry: 'DE' }).blockers).toContain(
      'targetNotAccepting',
    );
    expect(checkDirection({ selfSlug: 'apex-ru', source: null, target: null, clientCountry: 'DE' }).blockers).toEqual(['targetUnknown']);
  });

  it('алерт отчёта: выше абсолютного порога или вдвое выше медианы', () => {
    expect(managerAlert(11, [11, 1, 1])).toBe('absolute');
    expect(managerAlert(5, [5, 1, 1, 2])).toBe('aboveMedian');
    expect(managerAlert(2, [2, 1, 1])).toBeNull();
  });

  it('линтер «предложения»: имя или домен другой платформы группы', () => {
    const list = [profile(apex), profile(nordex)];
    expect(mentionsOtherPlatform('Переходите в Nordex Markets!', list, 'apex-ru')).toBe('nordex-eu');
    expect(mentionsOtherPlatform('см. nordex-eu.test', list, 'apex-ru')).toBe('nordex-eu');
    expect(mentionsOtherPlatform('Apex Markets', list, 'apex-ru')).toBeNull();
  });

  it('JSON реестра для скрипта ячейки разбирается строго', () => {
    expect(parseRegistryJson('[{"slug":"x-y","name":"X","cabinetUrl":"https://c.x"}]').ok).toBe(true);
    expect(parseRegistryJson('[{"slug":"x-y"}]').ok).toBe(false);
    expect(parseRegistryJson('nope').ok).toBe(false);
  });
});

describe('доказательство инициативы (только тикет клиента)', () => {
  it('тикет, открытый оператором, в форме отвергнут и сервером не принимается', async () => {
    const tk = await apex.db.query(
      `INSERT INTO support_tickets (user_id, contact_email, origin_channel, reply_channel, subject)
       VALUES ($1, 'anna@client.test', 'chat', 'chat', 'Предложение') RETURNING id`,
      [client],
    );
    const ticketId = String(tk.rows[0]!.id);
    await apex.db.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_operator_id, channel, body_text) VALUES ($1, 'operator', $2, 'chat', 'Предлагаем перейти')`,
      [ticketId, manager],
    );
    const reply = await apex.db.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_user_id, channel, body_text, created_at)
       VALUES ($1, 'client', $2, 'chat', 'Ок, согласен', now() + interval '1 second') RETURNING id`,
      [ticketId, client],
    );
    const list = await listTicketsForTransfer(apex.db, client);
    expect(list.rejected.map((x) => x.reason)).toContain('openedByOperator');
    const r = await createTransfer(apex.db, {
      operatorId: manager,
      userId: client,
      targetSlug: 'nordex-eu',
      ticketId,
      consentMessageId: String(reply.rows[0]!.id),
      consentConfirmed: true,
      basis: 'x',
      selfSlug: 'apex-ru',
      now: new Date(Date.now() + 5000),
    });
    expect(r).toEqual({ ok: false, reason: 'ticketOpenedByOperator' });
  });

  it('без отметки согласия, без основания, чужой тикет, не менеджер — отказ; ничего не записано', async () => {
    expect(await sendTransfer({ consentConfirmed: false })).toEqual({ ok: false, reason: 'consentNotConfirmed' });
    expect(await sendTransfer({ basis: '  ' })).toEqual({ ok: false, reason: 'missingReason' });
    expect(await sendTransfer({ operatorId: otherOperator })).toEqual({ ok: false, reason: 'notClientManager' });
    expect(await sendTransfer({ operatorId: admin })).toEqual({ ok: false, reason: 'notClientManager' });
    const other = await seedUser(apex.db, { email: 'boris@client.test' });
    const r2 = await postClientChatMessage(apex.db, ALWAYS, { userId: other, body: 'хочу перевод' });
    if (!r2.ok) throw new Error();
    const msg = await apex.db.query(`SELECT id FROM support_messages WHERE ticket_id = $1`, [r2.ticketId]);
    const r = await createTransfer(apex.db, {
      operatorId: manager,
      userId: client,
      targetSlug: 'nordex-eu',
      ticketId: r2.ticketId,
      consentMessageId: String(msg.rows[0]!.id),
      consentConfirmed: true,
      basis: 'x',
      selfSlug: 'apex-ru',
    });
    expect(r).toEqual({ ok: false, reason: 'ticketNotClients' });
    const n = await apex.db.query(`SELECT count(*)::int AS n FROM platform_transfers`);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('запрещённое направление (страна клиента запрещена в цели) — отказ с кодом', async () => {
    await apex.db.query(`UPDATE users SET country = 'US' WHERE id = $1`, [client]);
    const r = await sendTransfer();
    expect(r).toEqual({ ok: false, reason: 'directionForbidden', blockers: ['countryForbidden'] });
  });
});

describe('путь перевода между двумя платформами', () => {
  it('перевод → пакет → приглашение → регистрация → KYC → статусы в источнике; повтор пакета — дубликат', async () => {
    const r = await sendTransfer();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.number).toBe('TR-apex-ru-1001');

    await tick(apex);
    const inbound = await nordex.db.query(`SELECT status, email, full_name, country, invite_mail_id FROM platform_transfers_inbound`);
    expect(inbound.rows[0]).toMatchObject({ status: 'received', email: 'anna@client.test', country: 'DE' });
    let src = await apex.db.query(`SELECT status, delivery_state FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]).toMatchObject({ status: 'delivered', delivery_state: 'delivered' });

    // письмо-приглашение в очереди цели; ссылку берём из тела (до отправки)
    const mail = await nordex.db.query(`SELECT id, purpose, body_text, to_address FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    expect(mail.rows[0]!.to_address).toBe('anna@client.test');
    const token = /invite=([A-Za-z0-9_-]+)/.exec(String(mail.rows[0]!.body_text))![1]!;
    await markMailSent(nordex.db, String(mail.rows[0]!.id), 'transfer_invite', '250 OK');
    await tick(nordex);
    await tick(apex);
    src = await apex.db.query(`SELECT status, target_invited_at FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]!.status).toBe('invited');

    const ins = await inspectInvite(nordex.db, token);
    expect(ins).toMatchObject({ ok: true, prefill: { firstName: 'Анна', lastName: 'Клиентова', email: 'anna@client.test', country: 'DE' } });

    const newUser = await seedUser(nordex.db, { email: 'anna@client.test' });
    expect(await bindInviteWithinTx(nordex.db, { token, userId: newUser })).toBe(true);
    expect(await bindInviteWithinTx(nordex.db, { token, userId: newUser })).toBe(false); // одноразовый
    expect((await inspectInvite(nordex.db, token)).ok).toBe(false);
    await tick(nordex);
    src = await apex.db.query(`SELECT status FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]!.status).toBe('registered');

    await nordex.db.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'verified')`, [newUser]);
    await tick(nordex);
    src = await apex.db.query(`SELECT status FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]!.status).toBe('kyc_passed');

    // журнал обеих сторон связан номером
    const aj = await apex.db.query(`SELECT action FROM admin_action_journal WHERE action LIKE 'client.transfer.%' ORDER BY seq`);
    expect(aj.rows.map((x) => x.action)).toEqual([
      'client.transfer.sent',
      'client.transfer.delivered',
      'client.transfer.target_invited',
      'client.transfer.target_registered',
      'client.transfer.target_kyc_passed',
    ]);
    const nj = await nordex.db.query(`SELECT action FROM admin_action_journal WHERE action LIKE 'client.transfer.%' ORDER BY seq`);
    expect(nj.rows.map((x) => x.action)).toEqual([
      'client.transfer.received',
      'client.transfer.invite_queued',
      'client.transfer.invited',
      'client.transfer.registered',
      'client.transfer.kyc_passed',
    ]);

    // повтор доставки того же пакета (новый nonce) — дубликат, без второго приглашения
    await apex.db.query(`UPDATE platform_transfer_outbox SET state = 'queued', next_attempt_at = now() WHERE kind = 'transfer.package'`);
    await deliverDue(apex.db, { selfSlug: 'apex-ru', signingKey: apex.key, fetch: fetchFor([apex, nordex]) });
    const invites = await nordex.db.query(`SELECT count(*)::int AS n FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    expect(invites.rows[0]!.n).toBe(1);

    // закрытие источника: баланс нулевой → заморозка
    const closed = await closeSourceAccount(apex.db, nullTerminal, {
      operatorId: manager,
      role: 'operator',
      transferId: r.transferId,
      basis: 'клиент активен в цели',
    });
    expect(closed).toEqual({ ok: true });
    const flags = await apex.db.query(`SELECT frozen FROM client_money_flags WHERE user_id = $1`, [client]);
    expect(flags.rows[0]!.frozen).toBe(true);
  });

  it('второй живой перевод того же клиента и лимит менеджера', async () => {
    expect((await sendTransfer()).ok).toBe(true);
    expect(await sendTransfer()).toEqual({ ok: false, reason: 'liveTransferExists' });
  });
});

describe('закрытие счёта в источнике: только пустой счёт (fail-closed)', () => {
  async function registeredTransfer() {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    await tick(apex);
    const mail = await nordex.db.query(`SELECT body_text FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    const token = /invite=([A-Za-z0-9_-]+)/.exec(String(mail.rows[0]!.body_text))![1]!;
    const u = await seedUser(nordex.db, { email: 'anna@client.test' });
    await bindInviteWithinTx(nordex.db, { token, userId: u });
    await tick(nordex);
    return r.transferId;
  }
  const port = (state: Awaited<ReturnType<TransferTerminalPort['realAccountState']>>): TransferTerminalPort => ({
    setTradingFrozen: async () => 'ok',
    realAccountState: async () => state,
  });
  const close = (transferId: string, t: TransferTerminalPort) =>
    closeSourceAccount(apex.db, t, { operatorId: manager, role: 'operator', transferId, basis: 'закрыть' });

  it('деньги, equity, позиции, неизвестный баланс, терминал недоступен — отказ; ноль — можно', async () => {
    const id = await registeredTransfer();
    expect(await close(id, port({ balanceMinor: 482_500, equityMinor: 482_500, openPositions: 0 }))).toMatchObject({
      ok: false,
      reason: 'fundsOrPositions',
      balanceMinor: 482_500,
    });
    expect(await close(id, port({ balanceMinor: 0, equityMinor: 1200, openPositions: 0 }))).toMatchObject({ reason: 'fundsOrPositions' });
    expect(await close(id, port({ balanceMinor: 0, equityMinor: 0, openPositions: 2 }))).toMatchObject({ reason: 'fundsOrPositions', openPositions: 2 });
    expect(await close(id, port({ balanceMinor: null, equityMinor: 0, openPositions: 0 }))).toEqual({ ok: false, reason: 'balanceUnknown' });
    expect(await close(id, port('unavailable'))).toEqual({ ok: false, reason: 'balanceUnknown' });
    const flags = await apex.db.query(`SELECT frozen FROM client_money_flags WHERE user_id = $1`, [client]);
    expect(flags.rows[0]?.frozen ?? false).toBe(false);
    expect(await close(id, port({ balanceMinor: 0, equityMinor: 0, openPositions: 0 }))).toEqual({ ok: true });
  });

  it('незавершённый вывод или пополнение на сайте — отказ даже при нулевом счёте', async () => {
    const id = await registeredTransfer();
    await apex.db.query(
      `INSERT INTO crypto_withdrawals (user_id, to_address, amount_minor, status, debit_state) VALUES ($1, 'TRZbTw7NYaaUw9cEdD4dzbSETWVBem4nGC', 1000, 'requested', 'pending')`,
      [client],
    );
    expect(await close(id, nullTerminal)).toEqual({ ok: false, reason: 'pendingMoney', withdrawals: 1, deposits: 0 });
    await apex.db.query(`UPDATE crypto_withdrawals SET status = 'cancelled' WHERE user_id = $1`, [client]);
    await apex.db.query(`INSERT INTO crypto_deposits (user_id, tx_hash, status) VALUES ($1, $2, 'claimed')`, [client, 'c'.repeat(64)]);
    expect(await close(id, nullTerminal)).toEqual({ ok: false, reason: 'pendingMoney', withdrawals: 0, deposits: 1 });
  });

  it('счёта в терминале нет (не открывался) — закрыть можно', async () => {
    const id = await registeredTransfer();
    expect(await close(id, port(null))).toEqual({ ok: true });
  });
});

describe('приёмник: неверная подпись, повтор, чужой получатель', () => {
  it('подмена тела — 401 badSignature, пакет не принят; перехваченный конверт повторно — 409 replay', async () => {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    tamper = (body) => body.replace('anna@client.test', 'evil@attacker.test');
    await deliverDue(apex.db, { selfSlug: 'apex-ru', signingKey: apex.key, fetch: fetchFor([apex, nordex]) });
    expect(fetchLog.at(-1)?.status).toBe(401);
    let n = await nordex.db.query(`SELECT count(*)::int AS n FROM platform_transfers_inbound`);
    expect(n.rows[0]!.n).toBe(0);
    const src = await apex.db.query(`SELECT status, delivery_error FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]).toMatchObject({ status: 'refused', delivery_error: 'badSignature' });

    // повтор перехваченного валидного конверта
    const env: Envelope = {
      v: 1,
      kind: 'transfer.status',
      messageId: 'x',
      from: 'apex-ru',
      to: 'nordex-eu',
      transferId: r.transferId,
      issuedAt: new Date().toISOString(),
      nonce: 'fixed-nonce-1',
      data: { number: 'x', event: 'invited', at: new Date().toISOString() },
    };
    const body = JSON.stringify(signEnvelope(env, apex.key));
    const first = await handleIncoming(nordex.db, body, { selfSlug: 'nordex-eu' });
    expect(first.status).toBe(422); // перевода в цели нет — отказ по смыслу, nonce не съеден
    const revokeEnv = { ...env, kind: 'transfer.revoke' as const, nonce: 'fixed-nonce-2', data: { number: 'x', basis: 'b', revokedAt: env.issuedAt } };
    const rb = JSON.stringify(signEnvelope(revokeEnv, apex.key));
    expect((await handleIncoming(nordex.db, rb, { selfSlug: 'nordex-eu' })).status).toBe(200);
    expect((await handleIncoming(nordex.db, rb, { selfSlug: 'nordex-eu' })).body.code).toBe('replay');
    // другой получатель и устаревшее сообщение
    expect((await handleIncoming(apex.db, rb, { selfSlug: 'apex-ru' })).body.code).toBe('wrongRecipient');
    const stale = JSON.stringify(signEnvelope({ ...revokeEnv, nonce: 'n3', issuedAt: new Date(Date.now() - 3_600_000).toISOString() }, apex.key));
    expect((await handleIncoming(nordex.db, stale, { selfSlug: 'nordex-eu' })).body.code).toBe('staleMessage');
    n = await nordex.db.query(`SELECT count(*)::int AS n FROM platform_transfer_nonces`);
    expect(n.rows[0]!.n).toBe(1);
  });

  it('цель сама отвергает запрещённое направление (свой профиль), источник видит refused', async () => {
    // в реестре источника цель допускает DE, а сама цель — нет
    const nAdmin = await nordex.db.query(`SELECT id FROM operators WHERE login = 'nadm'`);
    await upsertGroupPlatformWithinTx(nordex.db, {
      operatorId: String(nAdmin.rows[0]!.id),
      basis: 'запрет DE',
      platform: profile(nordex, { forbiddenCountries: ['DE'] }),
    });
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    await tick(apex);
    const src = await apex.db.query(`SELECT status, delivery_error FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]).toMatchObject({ status: 'refused', delivery_error: 'countryForbidden' });
  });

  it('цель недоступна — повтор с отступом, ошибка видна в переводе', async () => {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    await deliverDue(apex.db, { selfSlug: 'apex-ru', signingKey: apex.key, fetch: async () => { throw new Error('ECONNREFUSED'); } });
    const o = await apex.db.query(`SELECT state, attempts, next_attempt_at > now() AS later FROM platform_transfer_outbox`);
    expect(o.rows[0]).toMatchObject({ state: 'queued', attempts: 1, later: true });
    const src = await apex.db.query(`SELECT status, delivery_error FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]!.status).toBe('sent');
    expect(String(src.rows[0]!.delivery_error)).toContain('ECONNREFUSED');
  });
});

describe('возврат перевода admin', () => {
  it('до регистрации: приглашение отозвано, ссылка недействительна, источник получает подтверждение', async () => {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    await tick(apex);
    const mail = await nordex.db.query(`SELECT body_text FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    const token = /invite=([A-Za-z0-9_-]+)/.exec(String(mail.rows[0]!.body_text))![1]!;

    expect(await revokeTransfer(apex.db, { operatorId: manager, transferId: r.transferId, basis: 'x' })).toEqual({ ok: false, reason: 'notAdmin' });
    const rv = await revokeTransfer(apex.db, { operatorId: admin, transferId: r.transferId, basis: 'Нет подтверждения заявления' });
    expect(rv).toMatchObject({ ok: true, stage: 'before_registration', messageQueued: true });
    await tick(apex);
    expect(await inspectInvite(nordex.db, token)).toEqual({ ok: false, reason: 'revoked' });
    const late = await seedUser(nordex.db, { email: 'late@client.test' });
    expect(await bindInviteWithinTx(nordex.db, { token, userId: late })).toBe(false);
    const im = await nordex.db.query(`SELECT status FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    expect(im.rows[0]!.status).toBe('cancelled');
    await tick(nordex);
    const src = await apex.db.query(`SELECT status, revoke_applied_at, revoke_target_detail FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]!.status).toBe('revoked');
    expect(src.rows[0]!.revoke_applied_at).not.toBeNull();
    // тикет снова свободен (возвращённый перевод не держит его)
    const list = await listTicketsForTransfer(apex.db, client);
    expect(list.eligible.every((t) => t.usedByTransfer === null)).toBe(true);
  });

  it('пакет ещё не уходил — снимается с очереди, цель ничего не получает', async () => {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    const rv = await revokeTransfer(apex.db, { operatorId: admin, transferId: r.transferId, basis: 'ошибочно' });
    expect(rv).toMatchObject({ ok: true, messageQueued: false });
    await tick(apex);
    expect(fetchLog).toHaveLength(0);
  });

  it('после регистрации и закрытия источника: цель замораживает счёт, письмо клиенту, задача вернуть средства; источник размораживается', async () => {
    const r = await sendTransfer();
    if (!r.ok) throw new Error();
    await tick(apex);
    const mail = await nordex.db.query(`SELECT body_text FROM outbound_mail WHERE purpose = 'transfer_invite'`);
    const token = /invite=([A-Za-z0-9_-]+)/.exec(String(mail.rows[0]!.body_text))![1]!;
    const newUser = await seedUser(nordex.db, { email: 'anna@client.test' });
    await bindInviteWithinTx(nordex.db, { token, userId: newUser });
    await nordex.db.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status, amount_minor) VALUES ($1, $2, 'credited', 5000)`,
      [newUser, 'a'.repeat(64)],
    );
    await tick(nordex);
    expect((await closeSourceAccount(apex.db, nullTerminal, { operatorId: manager, role: 'operator', transferId: r.transferId, basis: 'закрыть' })).ok).toBe(true);

    const rv = await revokeTransfer(apex.db, { operatorId: admin, transferId: r.transferId, basis: 'Халатность менеджера' });
    expect(rv).toMatchObject({ ok: true, stage: 'after_registration', restorePending: true });
    const srcFlags = await apex.db.query(`SELECT frozen FROM client_money_flags WHERE user_id = $1`, [client]);
    expect(srcFlags.rows[0]!.frozen).toBe(false);
    await tick(apex); // доставка возврата + терминал разморозки
    const tf = await nordex.db.query(`SELECT frozen, withdraw_banned FROM client_money_flags WHERE user_id = $1`, [newUser]);
    expect(tf.rows[0]).toMatchObject({ frozen: true, withdraw_banned: true });
    const inb = await nordex.db.query(`SELECT status, freeze_state, refund_task FROM platform_transfers_inbound`);
    expect(inb.rows[0]).toMatchObject({ status: 'revoked', freeze_state: 'pending', refund_task: 'open' });
    const notice = await nordex.db.query(`SELECT to_address FROM outbound_mail WHERE purpose = 'transfer_notice'`);
    expect(notice.rows[0]!.to_address).toBe('anna@client.test');
    await tick(nordex);
    const inb2 = await nordex.db.query(`SELECT freeze_state FROM platform_transfers_inbound`);
    expect(inb2.rows[0]!.freeze_state).toBe('applied');
    const src = await apex.db.query(`SELECT status, restore_state, revoke_target_detail FROM platform_transfers WHERE id = $1`, [r.transferId]);
    expect(src.rows[0]).toMatchObject({ status: 'revoked', restore_state: 'done' });
    expect(src.rows[0]!.revoke_target_detail).toMatchObject({ stage: 'after_registration', fundsOnTarget: true, accountFrozen: true });
    const counter = await apex.db.query(`SELECT count(*)::int AS n FROM platform_transfers WHERE initiator_id = $1 AND status = 'revoked'`, [manager]);
    expect(counter.rows[0]!.n).toBe(1);
  });
});

describe('флаги денег при переводе и срок запрета вывода (admin-credentials)', () => {
  it('истёкшая автозаморозка не считается запретом: перевод ставит бессрочный money_flags', async () => {
    await apex.db.query(
      `INSERT INTO client_money_flags (user_id, withdraw_banned, withdraw_ban_until, withdraw_ban_kind, withdraw_ban_reason)
       VALUES ($1, true, now() - interval '1 hour', 'credentials_auto', 'автозаморозка')`,
      [client],
    );
    const r = await setMoneyFlagsWithinTx(apex.db, {
      userId: client,
      operatorId: admin,
      basis: 'перевод',
      transferId: '00000000-0000-4000-8000-000000000001',
      withdrawBanned: true,
    });
    expect(r.before.withdrawBanned).toBe(false);
    expect(r.changed).toEqual(['withdrawBanned']);
    const f = (
      await apex.db.query(
        `SELECT withdraw_banned, withdraw_ban_until, withdraw_ban_kind, withdraw_ban_reason FROM client_money_flags WHERE user_id = $1`,
        [client],
      )
    ).rows[0]!;
    expect(f).toMatchObject({ withdraw_banned: true, withdraw_ban_until: null, withdraw_ban_kind: 'money_flags', withdraw_ban_reason: 'перевод' });

    await setMoneyFlagsWithinTx(apex.db, {
      userId: client,
      operatorId: admin,
      basis: 'возврат',
      transferId: '00000000-0000-4000-8000-000000000001',
      withdrawBanned: false,
    });
    const g = (
      await apex.db.query(`SELECT withdraw_banned, withdraw_ban_kind, withdraw_ban_reason FROM client_money_flags WHERE user_id = $1`, [client])
    ).rows[0]!;
    expect(g).toMatchObject({ withdraw_banned: false, withdraw_ban_kind: null, withdraw_ban_reason: null });
  });
});

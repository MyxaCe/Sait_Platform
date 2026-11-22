import { randomUUID } from 'node:crypto';
import { readEnv } from '@broker/utils';
import { getPool } from '../lib/db';

const FIXTURE_USER_ID = '00000000-0000-4000-8000-0000000a0001';

async function main(): Promise<number> {
  if (!readEnv(process.env.DATABASE_URL)) {
    console.error('Фикстура отказана: DATABASE_URL не задан — фикстура пишет в базу.');
    return 2;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Фикстура отказана: NODE_ENV=production — это тестовые данные, не для прода.');
    return 2;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale)
       VALUES ($1, $2, $3, $4, 'ru')
       ON CONFLICT (id) DO NOTHING`,
      [FIXTURE_USER_ID, 'kyc.fixture@example.test', 'x', 'Фикстура Клиентов'],
    );

    await client.query(
      `INSERT INTO client_verification (user_id, state)
       VALUES ($1, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET state = 'pending', updated_at = now()`,
      [FIXTURE_USER_ID],
    );

    await client.query(`DELETE FROM kyc_documents WHERE user_id = $1`, [FIXTURE_USER_ID]);
    const docs: Array<[string, string, string]> = [
      ['identity', `kyc/${FIXTURE_USER_ID}/passport.jpg`, 'image/jpeg'],
      ['selfie_liveness', `kyc/${FIXTURE_USER_ID}/selfie.mp4`, 'video/mp4'],
      ['address_proof', `kyc/${FIXTURE_USER_ID}/utility-bill.pdf`, 'application/pdf'],
    ];
    for (const [kind, key, ctype] of docs) {
      await client.query(
        `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), FIXTURE_USER_ID, kind, key, ctype],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  console.log(`Фикстура KYC засеяна: клиент ${FIXTURE_USER_ID} в pending + 3 документа.`);
  console.log('Открой /kyc в центре управления — клиент должен быть в очереди.');
  return 0;
}

main()
  .then(async (code) => {
    await getPool().end().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('Фикстура не выполнена из-за ошибки:', error);
    await getPool().end().catch(() => {});
    process.exit(3);
  });

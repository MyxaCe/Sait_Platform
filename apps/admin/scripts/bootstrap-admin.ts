import { readEnv } from '@broker/utils';
import { bootstrapFirstOperator } from '../lib/bootstrap';
import { getPool } from '../lib/db';

async function main(): Promise<number> {
  const login = readEnv(process.env.ADMIN_BOOTSTRAP_LOGIN);
  const password = readEnv(process.env.ADMIN_BOOTSTRAP_PASSWORD);
  const displayName = readEnv(process.env.ADMIN_BOOTSTRAP_NAME) ?? login;

  if (!login || !password) {
    console.error(
      'Сид отказан: заданы не все переменные. Нужны ADMIN_BOOTSTRAP_LOGIN и ' +
        'ADMIN_BOOTSTRAP_PASSWORD (пустая строка = не задано).',
    );
    return 2;
  }
  if (!readEnv(process.env.DATABASE_URL)) {
    console.error('Сид отказан: DATABASE_URL не задан — сид пишет в базу.');
    return 2;
  }

  const result = await bootstrapFirstOperator({ login, password, displayName: displayName! });
  if (!result.ok) {
    console.error(
      'Сид отказан: в `operators` уже есть записи (reason=alreadyBootstrapped). ' +
        'Сид одноразовый — следующие операторы заводятся провижинингом (ADM-04).',
    );
    return 1;
  }

  console.log(`Создан первый суперадмин: id=${result.operatorId}, login=${login}, role=admin.`);
  console.log('Запись о сиде добавлена в журнал (action=operator.bootstrap, основание=bootstrap).');
  return 0;
}

main()
  .then(async (code) => {
    await getPool().end().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('Сид не выполнен из-за ошибки:', error);
    await getPool().end().catch(() => {});
    process.exit(3);
  });

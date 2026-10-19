import { NextResponse } from 'next/server';
import { buildFingerprint, configFingerprint, instanceIdentity } from '@/lib/instance';

// GET-хендлер без динамических API Next пререндерит статически на билде —
// health-проба обязана выполняться на каждый запрос (баг B-010)
export const dynamic = 'force-dynamic';

/**
 * Liveness: процесс жив. Паттерн платформы (у CRM — /health).
 *
 * `instance` и `config` добавлены по B-019: `service` называет приложение, и
 * два экземпляра с разной конфигурацией по ответу были неотличимы. Оба
 * отпечатка булевы — какие переменные заданы, а не что в них лежит: ручка
 * не место утечки.
 *
 * **Отпечатков ДВА, и это не дробление ради аккуратности** (WEB-09, B-030).
 * Они отвечают на разные вопросы, и один ответ на оба был ложью:
 *
 *   `config`      — что лежит в окружении ЭТОГО процесса сейчас;
 *   `configBuild` — что было задано в момент, когда образ собирали.
 *
 * `NEXT_PUBLIC_*` впекаются компилятором в браузерный бандл, и в готовом
 * образе `process.env` их не содержит. Единый отпечаток говорил про них
 * «не задано» о значениях, которые ДЕЙСТВУЮТ: `NEXT_PUBLIC_CABINET_URL:
 * false` стояло рядом с `localhost:3102`, вшитым в `layout-*.js`. Нашла
 * команда `deploy`.
 *
 * `configBuild: null` означает «образ собран без снимка» — это НЕ «на
 * сборке ничего не было задано». Старый образ и пустая сборка обязаны
 * быть отличимы.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'site-web',
    instance: instanceIdentity(),
    config: configFingerprint(),
    configBuild: buildFingerprint(),
    time: new Date().toISOString(),
  });
}

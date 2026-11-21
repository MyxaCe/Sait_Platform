import { describe, expect, it } from 'vitest';
import { cabinetTerminalHref } from './cabinet-links';

const CABINET = (process.env.NEXT_PUBLIC_CABINET_URL || 'http://localhost:3002').replace(/\/$/, '');

describe('кнопки страницы инструмента → терминал в кабинете', () => {
  it('реальный счёт, язык по умолчанию — без префикса', () => {
    expect(cabinetTerminalHref('real', 'BTCUSD', 'ru', 'ru')).toBe(`${CABINET}/terminal?account=real&symbol=BTCUSD`);
  });

  it('демо-счёт, язык страницы сохраняется префиксом', () => {
    expect(cabinetTerminalHref('demo', 'eurusd', 'de', 'ru')).toBe(`${CABINET}/de/terminal?account=demo&symbol=EURUSD`);
  });
});

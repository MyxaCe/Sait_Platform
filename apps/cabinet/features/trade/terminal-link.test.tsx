import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalFrame } from './TerminalFrame';
import { TerminalLink } from './TerminalLink';
import { terminalPageHref } from './terminal-href';

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

afterEach(() => vi.unstubAllEnvs());

describe('ТД-010 · адрес терминала с инструментом', () => {
  it.each([
    ['real', 'BTCUSD', '/terminal?account=real&symbol=BTCUSD'],
    ['demo', 'xauusd', '/terminal?account=demo&symbol=XAUUSD'],
    ['real', 'BTC-USDT', '/terminal?account=real'],
    ['demo', undefined, '/terminal?account=demo'],
  ] as const)('%s + %s → %s', (account, symbol, want) => {
    expect(terminalPageHref(account, symbol)).toBe(want);
  });

  it('TerminalLink без верхнего уровня ведёт на /terminal с символом', () => {
    vi.stubEnv('TERMINAL_TOP_LEVEL', '');
    render(<TerminalLink account="real" symbol="btcusd">go</TerminalLink>);

    expect(screen.getByText('go').getAttribute('href')).toBe('/terminal?account=real&symbol=BTCUSD');
  });

  it('TerminalLink верхним уровнем кладёт символ в адрес возврата', () => {
    vi.stubEnv('TERMINAL_TOP_LEVEL', '1');
    vi.stubEnv('NEXT_PUBLIC_TERMINAL_URL', 'https://terminal.example.test/');
    vi.stubEnv('SITE_SLUG', 'apex-ru');
    render(<TerminalLink account="demo" symbol="ETHUSD">go</TerminalLink>);

    const href = new URL(screen.getByText('go').getAttribute('href')!, 'http://cabinet.invalid');
    expect(new URL(href.searchParams.get('return')!).searchParams.get('symbol')).toBe('ETHUSD');
  });

  it('iframe терминала получает symbol', () => {
    render(
      <TerminalFrame terminalUrl="https://terminal.example.test/" site="apex-ru" title="t" accountKind="real" symbol="BTCUSD" />,
    );

    const src = new URL(screen.getByTitle('t').getAttribute('src')!);
    expect(src.searchParams.get('symbol')).toBe('BTCUSD');
    expect(src.searchParams.get('site')).toBe('apex-ru');
  });
});

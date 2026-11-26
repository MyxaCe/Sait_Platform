import { describe, expect, it } from 'vitest';
import { envOr, readEnv } from './env';

describe('readEnv', () => {
  it('значение возвращается как есть', () => {
    expect(readEnv('https://example.test')).toBe('https://example.test');
  });

  it('пустая строка — отсутствие, а не значение', () => {
    expect(readEnv('')).toBeNull();
  });

  it('пробелы — тоже отсутствие', () => {
    expect(readEnv('   ')).toBeNull();
    expect(readEnv('\t\n')).toBeNull();
  });

  it('пробелы по краям срезаются', () => {
    expect(readEnv('  https://example.test  ')).toBe('https://example.test');
  });

  it('не задано — отсутствие', () => {
    expect(readEnv(undefined)).toBeNull();
    expect(readEnv(null)).toBeNull();
  });

  it('строка «0» и «false» — ЗНАЧЕНИЯ, а не отсутствие', () => {
    expect(readEnv('0')).toBe('0');
    expect(readEnv('false')).toBe('false');
  });
});

describe('envOr', () => {
  it('пустая строка получает умолчание — в этом вся суть', () => {
    expect(envOr('', 'http://localhost:3002')).toBe('http://localhost:3002');
  });

  it('заданное значение умолчанием не перекрывается', () => {
    expect(envOr('https://cabinet.example.test', 'http://localhost:3002')).toBe(
      'https://cabinet.example.test',
    );
  });

  it('не задано — умолчание', () => {
    expect(envOr(undefined, 'd')).toBe('d');
  });
});

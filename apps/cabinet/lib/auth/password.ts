import bcrypt from 'bcryptjs';

/**
 * bcryptjs (чистый JS): без нативных сборок в alpine-образе.
 * cost 12 — ~250мс на хеш: терпимо для логина, дорого для брутфорса.
 */
const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

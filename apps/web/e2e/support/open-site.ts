export const E2E_PORT = process.env.E2E_PORT || '3000';
export const OPEN_SITE_PORT = process.env.E2E_OPEN_PORT || String(Number(E2E_PORT) + 1);
export const OPEN_SITE_URL = `http://localhost:${OPEN_SITE_PORT}`;
export const E2E_FEED_URL = process.env.E2E_FEED_URL || 'http://127.0.0.1:55494';

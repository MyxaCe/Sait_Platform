import { envOr } from '@broker/utils';

export const SITE_URL = envOr(process.env.NEXT_PUBLIC_SITE_URL, 'https://example-broker.com');

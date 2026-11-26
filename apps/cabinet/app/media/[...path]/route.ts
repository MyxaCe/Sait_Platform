import { proxyCmsMedia } from '@broker/api-client/media-proxy';

// Медиа CMS (логотип, обложки, документы лицензий) через сайт: хост cms. закрыт по IP.
export const dynamic = 'force-dynamic';

type Context = { params: { path?: string[] } };

export function GET(request: Request, { params }: Context) {
  return proxyCmsMedia(request, params.path ?? []);
}

export function HEAD(request: Request, { params }: Context) {
  return proxyCmsMedia(request, params.path ?? []);
}

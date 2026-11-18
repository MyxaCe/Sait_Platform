import policy from '../scrubbing-policy.v1.json';

type Json = Record<string, unknown>;

const REPLACEMENT = policy.replacement;
const REMOVE_HEADERS = new Set(policy.removeHeaders.map((h) => h.toLowerCase()));
const MASK_QUERY = new Set(policy.maskQueryParams.map((p) => p.toLowerCase()));
const NEVER_ATTACH = policy.requestBodies.neverAttachPathPrefixes;
const ALLOWED_FIELDS = new Set(policy.requestBodies.allowedFields);
const USER_ALLOWED = new Set(policy.userContext.allowedKeys);
const VALUE_REGEXES = policy.valueScrubRegexes.map((r) => new RegExp(r.pattern, 'g'));

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pathOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url, 'http://x').pathname;
  } catch {
    return url.split('?')[0] ?? null;
  }
}

function scrubStringsDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const re of VALUE_REGEXES) out = out.replace(re, REPLACEMENT);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => scrubStringsDeep(v, depth + 1));
  if (isObject(value)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubStringsDeep(v, depth + 1);
    return out;
  }
  return value;
}

export function scrubSentryEvent(event: Json): Json {
  const request = event.request as Json | undefined;

  if (request) {
    if (isObject(request.headers)) {
      for (const key of Object.keys(request.headers)) {
        if (REMOVE_HEADERS.has(key.toLowerCase())) delete request.headers[key];
      }
    }
    if (typeof request.query_string === 'string') {
      request.query_string = request.query_string
        .split('&')
        .map((pair) => {
          const eq = pair.indexOf('=');
          const name = (eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase();
          return MASK_QUERY.has(name) && eq >= 0 ? `${pair.slice(0, eq)}=${REPLACEMENT}` : pair;
        })
        .join('&');
    }
    const path = pathOf(request.url);
    if (path && NEVER_ATTACH.some((p) => path.startsWith(p))) {
      delete request.data;
    } else if (isObject(request.data)) {
      const kept: Json = {};
      for (const [k, v] of Object.entries(request.data)) {
        if (ALLOWED_FIELDS.has(k)) kept[k] = v;
      }
      request.data = kept;
    }
  }

  if (isObject(event.user)) {
    const kept: Json = {};
    for (const [k, v] of Object.entries(event.user)) {
      if (USER_ALLOWED.has(k)) kept[k] = v;
    }
    event.user = kept;
  }

  for (const field of ['message', 'exception', 'breadcrumbs', 'extra', 'contexts', 'request'] as const) {
    if (event[field] !== undefined) {
      (event as Json)[field] = scrubStringsDeep(event[field]);
    }
  }

  return event;
}

export { policy as scrubbingPolicy };

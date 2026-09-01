import { sha256 } from 'js-sha256';

/** Salted hash of a Figma user id — the only form the server ever stores. */
export function hashFigmaId(figmaId: string, salt: string): string {
  return sha256(`${salt}:${figmaId}`);
}

/** Quota/DO identity for a license — hashed so the raw key never reaches DO names or logs. */
export function licenseIdentityId(key: string): string {
  return `lic:${sha256(key)}`;
}

export type Identity =
  | { kind: 'license'; key: string; instanceId: string | null }
  | { kind: 'free'; id: string };

/**
 * License wins when both headers are present. Null = unauthenticated.
 * Bearer is `KEY` (legacy clients, instanceId null) or `KEY:instanceId`
 * (current plugin builds, binding the token to one activated device).
 */
export function identityFromHeaders(headers: Headers, salt: string): Identity | null {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) {
    const sep = bearer.indexOf(':');
    if (sep === -1) return { kind: 'license', key: bearer, instanceId: null };
    return { kind: 'license', key: bearer.slice(0, sep), instanceId: bearer.slice(sep + 1) || null };
  }
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  if (figma) return { kind: 'free', id: hashFigmaId(figma, salt) };
  return null;
}

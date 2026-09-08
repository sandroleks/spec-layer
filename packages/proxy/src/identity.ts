import { sha256 } from 'js-sha256';

/** Salted hash of a Figma user id — the only form the server ever stores. */
export function hashFigmaId(figmaId: string, salt: string): string {
  return sha256(`${salt}:${figmaId}`);
}

/** Quota/DO identity for a license — hashed so the raw key never reaches DO names or logs. */
export function licenseIdentityId(key: string): string {
  return `lic:${sha256(key)}`;
}

/** The bearer's key and instance id, or null when the header carries no non-empty bearer. */
function parseBearer(headers: Headers): { key: string; instanceId: string | null } | null {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearer) return null;
  const sep = bearer.indexOf(':');
  return sep === -1
    ? { key: bearer, instanceId: null }
    : { key: bearer.slice(0, sep), instanceId: bearer.slice(sep + 1) || null };
}

/** Salted hash of a non-empty X-Figma-User header, else null. */
function figmaHashFrom(headers: Headers, salt: string): string | null {
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  return figma ? hashFigmaId(figma, salt) : null;
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
  const bearer = parseBearer(headers);
  if (bearer) return { kind: 'license', ...bearer };
  const figmaHash = figmaHashFrom(headers, salt);
  if (figmaHash) return { kind: 'free', id: figmaHash };
  return null;
}

export interface CallerProofs {
  license: { key: string; instanceId: string | null } | null;
  figmaHash: string | null;
}

/**
 * Every identity a request can prove, side by side. `identityFromHeaders`
 * picks one for AI metering; library ownership needs all of them, because a
 * library created on a free plan is owned by the Figma identity and the same
 * person later publishes with a license key.
 */
export function callerProofs(headers: Headers, salt: string): CallerProofs {
  return {
    license: parseBearer(headers),
    figmaHash: figmaHashFrom(headers, salt),
  };
}

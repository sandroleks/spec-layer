import { sha256 } from 'js-sha256';

/** Salted hash of a Figma user id — the only form the server ever stores. */
export function hashFigmaId(figmaId: string, salt: string): string {
  return sha256(`${salt}:${figmaId}`);
}

export type Identity =
  | { kind: 'license'; key: string }
  | { kind: 'free'; id: string };

/** License wins when both headers are present. Null = unauthenticated. */
export function identityFromHeaders(headers: Headers, salt: string): Identity | null {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return { kind: 'license', key: bearer };
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  if (figma) return { kind: 'free', id: hashFigmaId(figma, salt) };
  return null;
}

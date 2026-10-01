/**
 * Why a reference could not be resolved, stated as a fact. Every status is
 * decided from something Figma or this codebase RECORDED, never inferred from
 * a lookup that found nothing:
 *
 * | status           | decided by                                          |
 * |------------------|-----------------------------------------------------|
 * | not-extracted    | `kind` is `paint-style`. No table exists to look in. |
 * | external         | `remote: true` from Figma. Not inferred.            |
 * | no-foundation    | The caller passed none, as the drift path does.     |
 * | unavailable      | serializeFoundation recorded that read as failed.   |
 * | not-in-snapshot  | Local, not remote, absent from the cached dump.     |
 *
 * No `missing`: a reference's name comes from Figma resolving a real id, so a
 * name pointing at nothing cannot occur (see validate.ts).
 */
import type { FoundationSpec, FoundationRead } from './foundation';
import type { RefIdentity, RefKind } from './tree';

export type ResolutionStatus =
  | 'external' | 'not-extracted' | 'unavailable'
  | 'not-in-snapshot' | 'no-foundation';

export interface Resolution { status: ResolutionStatus; reason: string }

/** Which foundation read backs each kind; paint styles have none. */
const READ_OF: Record<RefKind, FoundationRead | null> = {
  variable: 'variables',
  'text-style': 'textStyles',
  'effect-style': 'effectStyles',
  'paint-style': null,
};

const KIND_WORD: Record<RefKind, string> = {
  variable: 'variable',
  'text-style': 'text style',
  'effect-style': 'effect style',
  'paint-style': 'paint style',
};

const READ_WORD: Record<FoundationRead, string> = {
  variables: 'variables', textStyles: 'text styles', effectStyles: 'effect styles',
};

/**
 * Why this reference has no definition in `foundation`, called once a lookup
 * came back empty. The ORDER is the design: kind-determined causes first, then
 * Figma's stated facts, then recorded read failures, and last the residual
 * "local but absent from the cached dump".
 */
export function resolutionOf(
  foundation: FoundationSpec | undefined,
  ref: RefIdentity,
): Resolution {
  const read = READ_OF[ref.kind];
  if (read === null) {
    return { status: 'not-extracted', reason: 'Paint style definitions are not extracted.' };
  }
  if (ref.remote) {
    return {
      status: 'external',
      reason: `Figma reports this ${KIND_WORD[ref.kind]} as belonging to a library.`,
    };
  }
  if (!foundation) {
    return {
      status: 'no-foundation',
      reason: 'No foundation snapshot was read, so no definition could be looked up.',
    };
  }
  if (foundation.unavailable?.includes(read)) {
    return {
      status: 'unavailable',
      reason: `Reading ${READ_WORD[read]} failed, so nothing could be looked up.`,
    };
  }
  return {
    status: 'not-in-snapshot',
    reason: 'This reference is local to this file but absent from the foundation snapshot, '
      + 'which is read once per session. Refresh sources on the Foundations screen to include it.',
  };
}

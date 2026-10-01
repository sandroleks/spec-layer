/**
 * resolution.ts — why a reference could not be resolved, stated as a fact.
 *
 * Absence from local foundation data has several causes, and a name-only
 * lookup collapses them into one bare `{}`. Every status here is decided from
 * something Figma or this codebase RECORDED, never inferred from a lookup that
 * found nothing:
 *
 * | status           | decided by                                          |
 * |------------------|-----------------------------------------------------|
 * | not-extracted    | `kind` is `paint-style`. No table exists to look in. |
 * | external         | `remote: true` from Figma. Not inferred.            |
 * | no-foundation    | The caller passed none, as the drift path does.     |
 * | unavailable      | serializeFoundation recorded that read as failed.   |
 * | not-in-snapshot  | Local, not remote, absent from the cached dump.     |
 *
 * There is deliberately no `missing`. A reference's name comes from Figma
 * resolving a real id, so a name pointing at nothing is unreachable, and this
 * codebase does not emit findings that cannot occur (see validate.ts).
 */
import type { FoundationSpec, FoundationRead } from './foundation';
import type { RefIdentity, RefKind } from './tree';

export type ResolutionStatus =
  | 'external' | 'not-extracted' | 'unavailable'
  | 'not-in-snapshot' | 'no-foundation';

export interface Resolution { status: ResolutionStatus; reason: string }

/** Which foundation read backs each kind. Paint styles have none: that is the
 *  whole content of `not-extracted`. */
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
 * Why this reference has no definition in `foundation`.
 *
 * Only ever called once a lookup has already come back empty. The ORDER of the
 * checks is the design: kind-determined causes first, so every paint style gets
 * one answer whatever its remoteness; then Figma's own stated facts; then what
 * this codebase recorded about its own reads; and only last the residual
 * "local, present in the file, absent from the dump we cached".
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

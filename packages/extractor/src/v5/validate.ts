/**
 * Level 1 validation — spec §18 "Schema validity".
 *
 * A hand-written mirror of `schema/foundation-5.0.0.json`, kept separate
 * because the plugin sandbox cannot load `ajv` (see the module comment on
 * that schema file). The published schema is for consumers; this is what the
 * plugin itself runs. `test/v5/schemaParity.test.ts` is what keeps the two
 * from drifting apart.
 *
 * Two diagnostic codes carry the whole of this file's judgment, and they mean
 * different things:
 *
 *  - `INCONSISTENT_VALUE_SHAPE` — the JSON is not the shape the discriminated
 *    union promises: a missing or unrecognized discriminant (`kind`, a typed
 *    value's `type`, an alias resolution's `status`), a bare primitive where
 *    an object belongs, a required structural key absent (a resolution chain
 *    step with no `mode_id`, an alias with no `reference`).
 *  - `UNSUPPORTED_VALUE_TYPE` — the discriminant is fine and the object is a
 *    typed value of a KNOWN kind, but a leaf field inside it cannot be
 *    represented: no unit, a unit outside the vocabulary, a hex that is not
 *    six lowercase digits, a non-finite number, an alpha outside 0..1.
 *
 * `validateLevel1` never throws. Every field access below is preceded by a
 * `typeof` / `Array.isArray` guard, because a validator that crashes on
 * malformed input cannot report on the one input where reporting matters.
 */
import { diagnostic } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import { SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS, SUPPORTED_VALUE_KINDS } from './value';
import type { TokenType, Unit } from './value';

const ROOT = '<artifact>';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

const HEX_RE = /^#[0-9a-f]{6}$/;

function shape(
  entityId: string, message: string, modeId?: string,
): Diagnostic {
  return diagnostic('INCONSISTENT_VALUE_SHAPE', {
    entity_id: entityId, message, ...(modeId !== undefined ? { mode_id: modeId } : {}),
  });
}

function unsupported(
  entityId: string, message: string, modeId?: string,
): Diagnostic {
  return diagnostic('UNSUPPORTED_VALUE_TYPE', {
    entity_id: entityId, message, ...(modeId !== undefined ? { mode_id: modeId } : {}),
  });
}

/**
 * A leaf-level typed value (§9), reached once its `type` discriminant is
 * already known to be one of `SUPPORTED_TOKEN_TYPES` — every failure from
 * here down is content the shape cannot carry, never a shape problem.
 */
function validateTypedValue(
  type: TokenType, tv: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string,
): void {
  switch (type) {
    case 'color': {
      if (tv.color_space !== 'srgb') {
        out.push(unsupported(entityId, 'color.color_space must be "srgb".', modeId));
      }
      if (typeof tv.hex !== 'string' || !HEX_RE.test(tv.hex)) {
        out.push(unsupported(entityId, 'color.hex must be six lowercase hex digits with a leading "#".', modeId));
      }
      if (!isFiniteNumber(tv.alpha) || tv.alpha < 0 || tv.alpha > 1) {
        out.push(unsupported(entityId, 'color.alpha must be a finite number between 0 and 1.', modeId));
      }
      if (tv.channels !== undefined) {
        const channels = tv.channels;
        if (!Array.isArray(channels) || channels.length !== 3 || !channels.every(isFiniteNumber)) {
          out.push(unsupported(entityId, 'color.channels must be three finite numbers when present.', modeId));
        }
      }
      break;
    }
    case 'dimension': {
      if (!isFiniteNumber(tv.number)) {
        out.push(unsupported(entityId, 'dimension.number must be a finite number.', modeId));
      }
      if (typeof tv.unit !== 'string' || !SUPPORTED_UNITS.includes(tv.unit as Unit)) {
        out.push(unsupported(entityId, 'dimension.unit is missing or outside the supported unit vocabulary.', modeId));
      }
      break;
    }
    case 'number': {
      if (!isFiniteNumber(tv.value)) {
        out.push(unsupported(entityId, 'number.value must be a finite number.', modeId));
      }
      break;
    }
    case 'string': {
      if (typeof tv.value !== 'string') {
        out.push(unsupported(entityId, 'string.value must be a string.', modeId));
      }
      break;
    }
    case 'boolean': {
      if (typeof tv.value !== 'boolean') {
        out.push(unsupported(entityId, 'boolean.value must be a boolean.', modeId));
      }
      break;
    }
    case 'duration': {
      if (!isFiniteNumber(tv.number)) {
        out.push(unsupported(entityId, 'duration.number must be a finite number.', modeId));
      }
      if (tv.unit !== 'ms' && tv.unit !== 's') {
        out.push(unsupported(entityId, 'duration.unit must be "ms" or "s".', modeId));
      }
      break;
    }
    case 'cubic_bezier': {
      const value = tv.value;
      if (!Array.isArray(value) || value.length !== 4 || !value.every(isFiniteNumber)) {
        out.push(unsupported(entityId, 'cubic_bezier.value must be four finite numbers.', modeId));
      }
      break;
    }
    case 'font_family': {
      if (typeof tv.value !== 'string') {
        out.push(unsupported(entityId, 'font_family.value must be a string.', modeId));
      }
      break;
    }
    default:
      // Exhaustive over TokenType; unreachable when `type` was already
      // checked against SUPPORTED_TOKEN_TYPES by the caller.
      break;
  }
}

/** Dispatches on the typed value's own `type` discriminant, which is what
 *  decides shape (INCONSISTENT_VALUE_SHAPE) vs. content (UNSUPPORTED_VALUE_TYPE). */
function validateTypedValueEnvelope(
  value: unknown, entityId: string, out: Diagnostic[], modeId?: string,
): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'A typed value must be an object.', modeId));
    return;
  }
  const { type } = value;
  if (typeof type !== 'string' || !SUPPORTED_TOKEN_TYPES.includes(type as TokenType)) {
    out.push(shape(entityId, `Typed value has an unrecognized or missing "type" discriminant: ${JSON.stringify(type)}.`, modeId));
    return;
  }
  validateTypedValue(type as TokenType, value, entityId, out, modeId);
}

function validateChainStep(step: unknown, entityId: string, out: Diagnostic[], modeId?: string): void {
  if (!isRecord(step) || typeof step.token_id !== 'string' || typeof step.mode_id !== 'string') {
    out.push(shape(entityId, 'A resolution chain step must carry both token_id and mode_id.', modeId));
  }
}

function validateAliasReference(ref: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string): void {
  if (!(ref.target_id === null || typeof ref.target_id === 'string')) {
    out.push(shape(entityId, 'alias.reference.target_id must be a string or null.', modeId));
  }
  if (!(ref.target_collection_id === null || typeof ref.target_collection_id === 'string')) {
    out.push(shape(entityId, 'alias.reference.target_collection_id must be a string or null.', modeId));
  }
  if (!isStringArray(ref.target_path)) {
    out.push(shape(entityId, 'alias.reference.target_path must be an array of strings.', modeId));
  }
  if (typeof ref.external !== 'boolean') {
    out.push(shape(entityId, 'alias.reference.external must be a boolean.', modeId));
  }
  if (ref.source_library_name !== undefined && typeof ref.source_library_name !== 'string') {
    out.push(shape(entityId, 'alias.reference.source_library_name must be a string when present.', modeId));
  }
}

function validateAliasResolution(resolved: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string): void {
  const { status } = resolved;
  if (status === 'resolved') {
    validateTypedValueEnvelope(resolved.value, entityId, out, modeId);
  } else if (status === 'unresolved') {
    if (!isNonEmptyString(resolved.reason)) {
      out.push(shape(entityId, 'An unresolved alias must carry a non-empty reason.', modeId));
    }
    if (resolved.value !== null) {
      out.push(shape(entityId, 'An unresolved alias must carry a null value.', modeId));
    }
  } else {
    out.push(shape(entityId, `alias.resolved.status has an unrecognized value: ${JSON.stringify(status)}.`, modeId));
  }

  if (!Array.isArray(resolved.chain)) {
    out.push(shape(entityId, 'alias.resolved.chain must be an array.', modeId));
  } else {
    for (const step of resolved.chain) validateChainStep(step, entityId, out, modeId);
  }
}

/** A single mode's `CanonicalValue` (§9): the `kind` discriminant, dispatched. */
function validateValue(value: unknown, entityId: string, modeId: string, out: Diagnostic[]): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'A token value must be an object, not a bare primitive.', modeId));
    return;
  }
  const { kind } = value;
  if (typeof kind !== 'string' || !SUPPORTED_VALUE_KINDS.includes(kind as typeof SUPPORTED_VALUE_KINDS[number])) {
    out.push(shape(entityId, `Value has an unrecognized or missing "kind" discriminant: ${JSON.stringify(kind)}.`, modeId));
    return;
  }

  if (kind === 'literal') {
    validateTypedValueEnvelope(value.value, entityId, out, modeId);
  } else if (kind === 'alias') {
    if (!isRecord(value.reference)) {
      out.push(shape(entityId, 'An alias value must carry a reference object.', modeId));
    } else {
      validateAliasReference(value.reference, entityId, out, modeId);
    }
    if (!isRecord(value.resolved)) {
      out.push(shape(entityId, 'An alias value must carry a resolved object.', modeId));
    } else {
      validateAliasResolution(value.resolved, entityId, out, modeId);
    }
  } else if (kind === 'missing') {
    if (!isNonEmptyString(value.reason)) {
      out.push(shape(entityId, 'A missing value must carry a non-empty reason.', modeId));
    }
  }
}

/** §8 — one token record. Structural checks only; cross-references (does
 *  `collection_id` resolve, is there a value for every declared mode) are
 *  Level 2/3, not this level. */
function validateToken(token: unknown, index: number, out: Diagnostic[]): void {
  if (!isRecord(token)) {
    out.push(shape(`tokens[${index}]`, 'A token must be an object.'));
    return;
  }

  const entityId = isNonEmptyString(token.id) ? token.id : `tokens[${index}]`;

  if (!isNonEmptyString(token.id)) {
    out.push(shape(entityId, 'token.id must be a non-empty string.'));
  }
  if (typeof token.collection_id !== 'string' || token.collection_id.length === 0) {
    out.push(shape(entityId, 'token.collection_id must be a non-empty string.'));
  }
  if (typeof token.name !== 'string') {
    out.push(shape(entityId, 'token.name must be a string.'));
  }
  if (!isStringArray(token.path) || token.path.length === 0) {
    out.push(shape(entityId, 'token.path must be a non-empty array of strings.'));
  }
  if (typeof token.type !== 'string') {
    out.push(shape(entityId, 'token.type must be a string.'));
  } else if (!SUPPORTED_TOKEN_TYPES.includes(token.type as TokenType)) {
    out.push(shape(entityId, `token.type is not a recognized token type: ${JSON.stringify(token.type)}.`));
  }
  if (typeof token.description !== 'string') {
    out.push(shape(entityId, 'token.description must be present and a string (an empty string is allowed).'));
  }
  if (!Array.isArray(token.scopes)) {
    out.push(shape(entityId, 'token.scopes must be an array.'));
  }
  if (!isRecord(token.values)) {
    out.push(shape(entityId, 'token.values must be an object keyed by mode id.'));
    return;
  }

  for (const [modeId, value] of Object.entries(token.values)) {
    validateValue(value, entityId, modeId, out);
  }
}

/**
 * §5.2 — the top-level sections every artifact must expose. Only container
 * shape is checked here (object vs. array vs. absent); `tokens` is the one
 * section given full field-by-field treatment, per this task's scope.
 */
const COMPLETENESS_VALUES = ['complete', 'partial', 'unavailable'];

function validateRootSections(artifact: Record<string, unknown>, out: Diagnostic[]): void {
  if (!isRecord(artifact.spec_layer)) {
    out.push(shape(ROOT, '`spec_layer` must be an object.'));
  }
  const completeness = artifact.completeness;
  if (
    !isRecord(completeness)
    || !COMPLETENESS_VALUES.includes(completeness.collections as string)
    || !COMPLETENESS_VALUES.includes(completeness.styles as string)
    || !isStringArray(completeness.unavailable_sources)
  ) {
    out.push(shape(ROOT, '`completeness` must state collections/styles completeness and list unavailable sources.'));
  }
  if (!Array.isArray(artifact.collections)) {
    out.push(shape(ROOT, '`collections` must be an array.'));
  }
  if (!isRecord(artifact.styles) || !Array.isArray(artifact.styles.typography) || !Array.isArray(artifact.styles.effects)) {
    out.push(shape(ROOT, '`styles` must be an object with `typography` and `effects` arrays.'));
  }
  if (!Array.isArray(artifact.diagnostics)) {
    out.push(shape(ROOT, '`diagnostics` must be an array.'));
  }
  if (!isRecord(artifact.statistics)) {
    out.push(shape(ROOT, '`statistics` must be an object.'));
  }
}

/**
 * Level 1 validation — never throws, on any input.
 *
 * Anchors every diagnostic to the entity it is about (`entity_id`, plus
 * `mode_id` when the fault lives inside one mode's value), so a caller can
 * join a finding back to the token that produced it without re-deriving
 * position from array indices.
 */
export function validateLevel1(artifact: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];

  if (!isRecord(artifact)) {
    out.push(shape(ROOT, 'The artifact root must be an object.'));
    return out;
  }

  validateRootSections(artifact, out);

  if (!Array.isArray(artifact.tokens)) {
    out.push(shape(ROOT, '`tokens` must be an array.'));
  } else {
    artifact.tokens.forEach((token, index) => validateToken(token, index, out));
  }

  return out;
}

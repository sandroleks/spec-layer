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
import { compareCodeUnits, diagnostic } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import {
  SUPPORTED_DURATION_UNITS, SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS, SUPPORTED_VALUE_KINDS,
} from './value';
import type { CanonicalValue, TokenType, TypedValue, Unit } from './value';
import type { EffectStyleV5, TokenV5 } from './entities';
import { canonicalJson } from './canonical';
import type { FoundationArtifactV5 } from './canonical';
import { numericValue } from './units';

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
      // Reads the runtime vocabulary rather than re-spelling 'ms'/'s' inline,
      // so this check and the published schema's enum have one source that
      // schemaParity.test.ts can assert them both against.
      if (typeof tv.unit !== 'string' || !SUPPORTED_DURATION_UNITS.includes(tv.unit as 'ms' | 's')) {
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
  expectedType?: TokenType,
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
  if (expectedType !== undefined && type !== expectedType) {
    out.push(shape(
      entityId,
      `Expected a "${expectedType}" typed value, but the value declares "${type}".`,
      modeId,
    ));
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

function validateAliasResolution(
  resolved: Record<string, unknown>, entityId: string, out: Diagnostic[],
  modeId?: string, expectedType?: TokenType,
): void {
  const { status } = resolved;
  if (status === 'resolved') {
    validateTypedValueEnvelope(resolved.value, entityId, out, modeId, expectedType);
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
function validateValue(
  value: unknown, entityId: string, modeId: string, out: Diagnostic[], expectedType?: TokenType,
): void {
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
    validateTypedValueEnvelope(value.value, entityId, out, modeId, expectedType);
  } else if (kind === 'alias') {
    if (!isRecord(value.reference)) {
      out.push(shape(entityId, 'An alias value must carry a reference object.', modeId));
    } else {
      validateAliasReference(value.reference, entityId, out, modeId);
    }
    if (!isRecord(value.resolved)) {
      out.push(shape(entityId, 'An alias value must carry a resolved object.', modeId));
    } else {
      validateAliasResolution(value.resolved, entityId, out, modeId, expectedType);
    }
  } else if (kind === 'missing') {
    if (!isNonEmptyString(value.reason)) {
      out.push(shape(entityId, 'A missing value must carry a non-empty reason.', modeId));
    }
  }
}

function validateIdentity(
  entity: Record<string, unknown>, entityId: string, kind: string, out: Diagnostic[],
): void {
  if (!isNonEmptyString(entity.id)) {
    out.push(shape(entityId, `${kind}.id must be a non-empty string.`));
  }
  if (typeof entity.name !== 'string') {
    out.push(shape(entityId, `${kind}.name must be a string.`));
  }
  if (!isStringArray(entity.path) || entity.path.length === 0) {
    out.push(shape(entityId, `${kind}.path must be a non-empty array of strings.`));
  }
  if (entity.suggested_code_name !== undefined && typeof entity.suggested_code_name !== 'string') {
    out.push(shape(entityId, `${kind}.suggested_code_name must be a string when present.`));
  }
}

function validatePublication(value: unknown, entityId: string, out: Diagnostic[]): void {
  if (
    !isRecord(value)
    || typeof value.published !== 'boolean'
    || typeof value.hidden_from_publishing !== 'boolean'
  ) {
    out.push(shape(
      entityId,
      'publication must state boolean published and hidden_from_publishing fields.',
    ));
  }
}

function validateLifecycle(value: unknown, entityId: string, out: Diagnostic[]): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'lifecycle must be an object when present.'));
    return;
  }
  if (!['active', 'deprecated', 'archived'].includes(value.status as string)) {
    out.push(shape(entityId, 'lifecycle.status must be active, deprecated, or archived.'));
  }
  if (!(value.replacement_id === null || typeof value.replacement_id === 'string')) {
    out.push(shape(entityId, 'lifecycle.replacement_id must be a string or null.'));
  }
}

function validateSource(value: unknown, entityId: string, out: Diagnostic[]): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'source must be an object when present.'));
    return;
  }
  if (typeof value.remote !== 'boolean') {
    out.push(shape(entityId, 'source.remote must be a boolean.'));
  }
  for (const field of ['library_file_id', 'library_name', 'modified_at']) {
    if (!(value[field] === null || typeof value[field] === 'string')) {
      out.push(shape(entityId, `source.${field} must be a string or null.`));
    }
  }
}

function validateOptionalEntityMetadata(
  entity: Record<string, unknown>, entityId: string, out: Diagnostic[],
  includeSource = false, includeLifecycle = true,
): void {
  if (entity.publication !== undefined) validatePublication(entity.publication, entityId, out);
  if (includeLifecycle && entity.lifecycle !== undefined) validateLifecycle(entity.lifecycle, entityId, out);
  if (includeSource && entity.source !== undefined) validateSource(entity.source, entityId, out);
}

function validateCollection(collection: unknown, index: number, out: Diagnostic[]): void {
  if (!isRecord(collection)) {
    out.push(shape(`collections[${index}]`, 'A collection must be an object.'));
    return;
  }
  const entityId = isNonEmptyString(collection.id) ? collection.id : `collections[${index}]`;
  validateIdentity(collection, entityId, 'collection', out);
  if (!isNonEmptyString(collection.default_mode_id)) {
    out.push(shape(entityId, 'collection.default_mode_id must be a non-empty string.'));
  }
  if (!Array.isArray(collection.modes)) {
    out.push(shape(entityId, 'collection.modes must be an array.'));
  } else {
    collection.modes.forEach((mode, modeIndex) => {
      if (!isRecord(mode)) {
        out.push(shape(entityId, `collection.modes[${modeIndex}] must be an object.`));
        return;
      }
      if (!isNonEmptyString(mode.id)) {
        out.push(shape(entityId, `collection.modes[${modeIndex}].id must be a non-empty string.`));
      }
      if (typeof mode.name !== 'string') {
        out.push(shape(entityId, `collection.modes[${modeIndex}].name must be a string.`));
      }
      if (!isFiniteNumber(mode.order)) {
        out.push(shape(entityId, `collection.modes[${modeIndex}].order must be a finite number.`));
      }
    });
  }
  validateOptionalEntityMetadata(collection, entityId, out, true, false);
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
  if (token.suggested_code_name !== undefined && typeof token.suggested_code_name !== 'string') {
    out.push(shape(entityId, 'token.suggested_code_name must be a string when present.'));
  }
  let tokenType: TokenType | undefined;
  if (typeof token.type !== 'string') {
    out.push(shape(entityId, 'token.type must be a string.'));
  } else if (!SUPPORTED_TOKEN_TYPES.includes(token.type as TokenType)) {
    out.push(shape(entityId, `token.type is not a recognized token type: ${JSON.stringify(token.type)}.`));
  } else {
    tokenType = token.type as TokenType;
  }
  if (typeof token.description !== 'string') {
    out.push(shape(entityId, 'token.description must be present and a string (an empty string is allowed).'));
  }
  if (!isStringArray(token.scopes)) {
    out.push(shape(entityId, 'token.scopes must be an array of strings.'));
  }
  validateOptionalEntityMetadata(token, entityId, out);
  if (!isRecord(token.values)) {
    out.push(shape(entityId, 'token.values must be an object keyed by mode id.'));
    return;
  }

  for (const [modeId, value] of Object.entries(token.values)) {
    validateValue(value, entityId, modeId, out, tokenType);
  }
}

function validateStyleProperty(
  property: unknown, entityId: string, propertyName: string, out: Diagnostic[],
): void {
  if (!isRecord(property)) {
    out.push(shape(entityId, `typography.properties.${propertyName} must be an object.`));
    return;
  }
  const { source } = property;
  if (!isRecord(source)) {
    out.push(shape(entityId, `typography.properties.${propertyName}.source must be an object.`));
  } else if (source.kind === 'alias') {
    if (!(source.target_id === null || typeof source.target_id === 'string')) {
      out.push(shape(entityId, `typography.properties.${propertyName}.source.target_id must be a string or null.`));
    }
    if (!isStringArray(source.target_path)) {
      out.push(shape(entityId, `typography.properties.${propertyName}.source.target_path must be an array of strings.`));
    }
  } else if (source.kind !== 'literal') {
    out.push(shape(entityId, `typography.properties.${propertyName}.source.kind must be literal or alias.`));
  }

  if (property.resolved !== null) {
    validateTypedValueEnvelope(property.resolved, entityId, out);
  }
}

const TYPOGRAPHY_STYLE_PROPERTIES = [
  'font_family', 'font_weight', 'font_size', 'line_height', 'letter_spacing',
  'paragraph_spacing', 'paragraph_indent',
] as const;

function validateTypographyStyle(style: unknown, index: number, out: Diagnostic[]): void {
  if (!isRecord(style)) {
    out.push(shape(`styles.typography[${index}]`, 'A typography style must be an object.'));
    return;
  }
  const entityId = isNonEmptyString(style.id) ? style.id : `styles.typography[${index}]`;
  validateIdentity(style, entityId, 'typography style', out);
  if (typeof style.description !== 'string') {
    out.push(shape(entityId, 'typography.description must be a string.'));
  }
  if (!isRecord(style.properties)) {
    out.push(shape(entityId, 'typography.properties must be an object.'));
  } else {
    for (const propertyName of TYPOGRAPHY_STYLE_PROPERTIES) {
      validateStyleProperty(style.properties[propertyName], entityId, propertyName, out);
    }
    if (typeof style.properties.text_case !== 'string') {
      out.push(shape(entityId, 'typography.properties.text_case must be a string.'));
    }
    if (typeof style.properties.text_decoration !== 'string') {
      out.push(shape(entityId, 'typography.properties.text_decoration must be a string.'));
    }
  }
  validateOptionalEntityMetadata(style, entityId, out, true);
}

const EFFECT_KINDS = ['drop_shadow', 'inner_shadow', 'layer_blur', 'background_blur'];

function validateEffect(effect: unknown, entityId: string, index: number, out: Diagnostic[]): void {
  if (!isRecord(effect)) {
    out.push(shape(entityId, `effects[${index}] must be an object.`));
    return;
  }
  if (!EFFECT_KINDS.includes(effect.type as string)) {
    out.push(shape(entityId, `effects[${index}].type is not a recognized effect kind.`));
  }
  if (typeof effect.visible !== 'boolean') {
    out.push(shape(entityId, `effects[${index}].visible must be a boolean.`));
  }
  if (effect.blend_mode !== undefined && typeof effect.blend_mode !== 'string') {
    out.push(shape(entityId, `effects[${index}].blend_mode must be a string when present.`));
  }
  if (effect.color !== undefined) {
    validateTypedValueEnvelope(effect.color, entityId, out, undefined, 'color');
  }
  for (const field of ['offset_x', 'offset_y', 'blur', 'spread']) {
    if (effect[field] !== undefined) {
      validateTypedValueEnvelope(effect[field], entityId, out, undefined, 'dimension');
    }
  }
  if (effect.show_behind_node !== undefined && typeof effect.show_behind_node !== 'boolean') {
    out.push(shape(entityId, `effects[${index}].show_behind_node must be a boolean when present.`));
  }
}

function validateEffectStyle(style: unknown, index: number, out: Diagnostic[]): void {
  if (!isRecord(style)) {
    out.push(shape(`styles.effects[${index}]`, 'An effect style must be an object.'));
    return;
  }
  const entityId = isNonEmptyString(style.id) ? style.id : `styles.effects[${index}]`;
  validateIdentity(style, entityId, 'effect style', out);
  if (!(style.mode_id === null || typeof style.mode_id === 'string')) {
    out.push(shape(entityId, 'effect style.mode_id must be a string or null.'));
  }
  if (!Array.isArray(style.effects)) {
    out.push(shape(entityId, 'effect style.effects must be an array.'));
  } else {
    style.effects.forEach((effect, effectIndex) => validateEffect(effect, entityId, effectIndex, out));
  }
  if (style.bindings !== undefined) {
    if (!Array.isArray(style.bindings)) {
      out.push(shape(entityId, 'effect style.bindings must be an array when present.'));
    } else {
      style.bindings.forEach((binding, bindingIndex) => {
        if (
          !isRecord(binding)
          || !isNonEmptyString(binding.property)
          || !isNonEmptyString(binding.token_id)
        ) {
          out.push(shape(
            entityId,
            `effect style.bindings[${bindingIndex}] must carry non-empty property and token_id strings.`,
          ));
        }
      });
    }
  }
  validateOptionalEntityMetadata(style, entityId, out, true);
}

/**
 * §5.2 — the top-level sections every artifact must expose. This validates
 * their containers plus every nested field Level 2 dereferences.
 * That invariant is what makes "Level 1 accepted" a safe precondition for
 * Level 2 rather than a promise that malformed collections or styles can
 * violate at runtime.
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
  } else {
    artifact.collections.forEach((collection, index) => validateCollection(collection, index, out));
  }
  if (!isRecord(artifact.styles) || !Array.isArray(artifact.styles.typography) || !Array.isArray(artifact.styles.effects)) {
    out.push(shape(ROOT, '`styles` must be an object with `typography` and `effects` arrays.'));
  } else {
    artifact.styles.typography.forEach((style, index) => validateTypographyStyle(style, index, out));
    artifact.styles.effects.forEach((style, index) => validateEffectStyle(style, index, out));
  }
  if (!Array.isArray(artifact.diagnostics)) {
    out.push(shape(ROOT, '`diagnostics` must be an array.'));
  }
  if (!isRecord(artifact.statistics)) {
    out.push(shape(ROOT, '`statistics` must be an object.'));
  }
  if (artifact.guidelines !== undefined) {
    const guidelines = artifact.guidelines;
    if (!isRecord(guidelines) || guidelines.origin !== 'generated'
      || !isRecord(guidelines.group_descriptions)) {
      out.push(shape(
        ROOT,
        '`guidelines` must state origin "generated" and a group_descriptions object.',
      ));
    } else {
      for (const [collectionName, folders] of Object.entries(guidelines.group_descriptions)) {
        if (!isRecord(folders)
          || Object.values(folders).some((description) => typeof description !== 'string')) {
          out.push(shape(
            ROOT,
            `guidelines.group_descriptions[${JSON.stringify(collectionName)}] must map folder names to strings.`,
          ));
        }
      }
    }
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
  try {
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
  } catch (err) {
    // A per-access type guard cannot prevent an exception from a throwing
    // getter or Proxy trap — the throw happens during the read itself. The
    // guarantee has to be enforced structurally here instead.
    const message = err instanceof Error && err.message
      ? `The artifact could not be read; accessing its properties threw: ${err.message}`
      : 'The artifact could not be read; accessing its properties threw.';
    return [diagnostic('INCONSISTENT_VALUE_SHAPE', {
      entity_id: 'artifact',
      message,
    })];
  }
}

// ---------------------------------------------------------------------------
// Level 2 — referential integrity (§18 Level 2, §10 "Alias graph", §7 modes,
// §6 identity and paths).
//
// Unlike Level 1, `validateLevel2` takes a typed `FoundationArtifactV5`, not
// `unknown`: it is only meaningful to run once Level 1 has already accepted
// the shape, so the defensive `isRecord`/`typeof` guarding above has no
// counterpart down here -- every field this section reads is already the
// type it claims to be.
// ---------------------------------------------------------------------------

interface AliasNode { tokenId: string; modeId: string }

type NodeState = 'in_progress' | 'done';

/** get-or-create for the nested per-(token_id, mode_id) traversal state. */
function nodeStates(store: Map<string, Map<string, NodeState>>, tokenId: string): Map<string, NodeState> {
  let inner = store.get(tokenId);
  if (!inner) {
    inner = new Map();
    store.set(tokenId, inner);
  }
  return inner;
}

function getNodeState(
  store: Map<string, Map<string, NodeState>>, tokenId: string, modeId: string,
): NodeState | undefined {
  return store.get(tokenId)?.get(modeId);
}

function equalStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

interface ValidationIndexes {
  tokensById: Map<string, TokenV5>;
  collectionsById: Map<string, FoundationArtifactV5['collections'][number]>;
}

type AliasValue = Extract<CanonicalValue, { kind: 'alias' }>;

/**
 * Independently replays Figma's mode choice. It deliberately does not consult
 * either alias's recorded chain: a bad mode-selection implementation must not
 * be able to validate its own output merely because every nested record repeats
 * the same wrong choice.
 */
function expectedTargetMode(
  sourceToken: TokenV5,
  sourceModeId: string,
  targetToken: TokenV5,
  indexes: ValidationIndexes,
): string | undefined {
  const sourceCollection = indexes.collectionsById.get(sourceToken.collection_id);
  const targetCollection = indexes.collectionsById.get(targetToken.collection_id);
  const sourceMode = sourceCollection?.modes.find((mode) => mode.id === sourceModeId);
  if (!sourceCollection || !targetCollection || !sourceMode) return undefined;

  if (sourceCollection.id === targetCollection.id) {
    return targetCollection.modes.some((mode) => mode.id === sourceModeId)
      ? sourceModeId
      : undefined;
  }

  const exact = targetCollection.modes.filter((mode) => mode.name === sourceMode.name);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return undefined;
  return targetCollection.modes.some((mode) => mode.id === targetCollection.default_mode_id)
    ? targetCollection.default_mode_id
    : undefined;
}

function aliasTypesCompatible(owner: TokenType, target: TokenType): boolean {
  if (owner === target) return true;
  // Figma aliases enforce raw FLOAT/STRING compatibility. Scope evidence can
  // specialize those sources into v5 dimension/font_family tokens; these are
  // the only cross-v5-type pairs accepted here, not general coercion rules.
  return (owner === 'number' && target === 'dimension')
    || (owner === 'dimension' && target === 'number')
    || (owner === 'string' && target === 'font_family')
    || (owner === 'font_family' && target === 'string');
}

function scalarOf(value: TypedValue): number | string | undefined {
  if (value.type === 'number') return value.value;
  if (value.type === 'dimension') return value.number;
  if (value.type === 'string' || value.type === 'font_family') return value.value;
  return undefined;
}

function snapshotMatchesTerminal(
  snapshot: TypedValue,
  terminal: TypedValue,
  owner: TokenV5,
): boolean {
  if (snapshot.type === terminal.type) return canonicalJson(snapshot) === canonicalJson(terminal);

  if ((snapshot.type === 'dimension' && terminal.type === 'number')
    || (snapshot.type === 'number' && terminal.type === 'dimension')) {
    const scalar = scalarOf(terminal);
    if (typeof scalar !== 'number') return false;
    if (snapshot.type === 'dimension') {
      const specialized = numericValue(scalar, owner.scopes);
      return specialized !== null && canonicalJson(snapshot) === canonicalJson(specialized);
    }
    return snapshot.value === scalar;
  }

  if ((snapshot.type === 'font_family' && terminal.type === 'string')
    || (snapshot.type === 'string' && terminal.type === 'font_family')) {
    return scalarOf(snapshot) === scalarOf(terminal);
  }
  return false;
}

function provenanceFinding(
  out: Diagnostic[],
  token: TokenV5,
  modeId: string,
  message: string,
  details: Record<string, unknown>,
  external = false,
): void {
  out.push(diagnostic(external ? 'UNRESOLVED_EXTERNAL_ALIAS' : 'UNRESOLVED_ALIAS', {
    entity_id: token.id, mode_id: modeId, message, details,
  }));
}

/** Validate one chain against independently replayed reference/mode choices. */
function checkChainTruth(
  rootToken: TokenV5,
  rootModeId: string,
  rootValue: AliasValue,
  indexes: ValidationIndexes,
  out: Diagnostic[],
): void {
  const { resolved } = rootValue;
  if (rootValue.reference.external) {
    if (resolved.status === 'resolved') {
      provenanceFinding(
        out, rootToken, rootModeId,
        'An external alias cannot claim a resolved snapshot while its target is absent.',
        { fault: 'external_claims_resolved' }, true,
      );
    }
    if (resolved.chain.length > 0) {
      provenanceFinding(
        out, rootToken, rootModeId,
        'An external alias cannot carry a local resolution chain.',
        { fault: 'external_claims_local_chain', chain_length: resolved.chain.length }, true,
      );
    }
    return;
  }

  let currentToken = rootToken;
  let currentModeId = rootModeId;
  let currentValue = rootValue;
  let chainIndex = 0;
  const seen = new Set<string>();

  while (true) {
    const pair = canonicalJson([currentToken.id, currentModeId]);
    if (seen.has(pair)) {
      if (resolved.status === 'resolved') {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A chain recorded as resolved enters an alias cycle before reaching a literal.',
          { fault: 'resolved_chain_cycle', chain_index: chainIndex },
        );
      }
      return;
    }
    seen.add(pair);

    const targetId = currentValue.reference.target_id;
    const targetToken = targetId === null ? undefined : indexes.tokensById.get(targetId);
    if (!targetToken) {
      if (resolved.status === 'resolved') {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolved chain reaches an alias target that is absent from the artifact.',
          { fault: 'resolved_chain_missing_target', chain_index: chainIndex, target_id: targetId },
        );
      }
      return;
    }

    const targetModeId = expectedTargetMode(
      currentToken, currentModeId, targetToken, indexes,
    );
    if (targetModeId === undefined) {
      if (resolved.status === 'resolved' || chainIndex < resolved.chain.length) {
        provenanceFinding(
          out, rootToken, rootModeId,
          'The chain claims a hop for which no authoritative target mode can be selected.',
          {
            fault: 'target_mode_unresolvable', chain_index: chainIndex,
            source_token_id: currentToken.id, source_mode_id: currentModeId,
            target_id: targetToken.id,
          },
        );
      }
      return;
    }

    const actualStep = resolved.chain[chainIndex];
    if (actualStep === undefined) {
      if (resolved.status === 'resolved') {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolved chain ends before recording every alias hop.',
          {
            fault: 'chain_ended_early', chain_index: chainIndex,
            expected_token_id: targetToken.id, expected_mode_id: targetModeId,
          },
        );
      }
      return;
    }
    if (actualStep.token_id !== targetToken.id || actualStep.mode_id !== targetModeId) {
      provenanceFinding(
        out, rootToken, rootModeId,
        'A resolution-chain step does not match the independently replayed alias target and mode.',
        {
          fault: 'chain_step_mismatch', chain_index: chainIndex,
          expected_token_id: targetToken.id, expected_mode_id: targetModeId,
          actual_token_id: actualStep.token_id, actual_mode_id: actualStep.mode_id,
        },
      );
    }
    chainIndex += 1;

    const targetValue = targetToken.values[targetModeId];
    if (targetValue === undefined || targetValue.kind === 'missing') {
      if (resolved.status === 'resolved') {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolved chain terminates at a missing value rather than a literal.',
          {
            fault: 'resolved_chain_missing_value', chain_index: chainIndex - 1,
            token_id: targetToken.id, mode_id: targetModeId,
          },
        );
      }
      if (chainIndex < resolved.chain.length) {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolution chain continues after a missing terminal value.',
          { fault: 'extra_step_after_missing', chain_index: chainIndex },
        );
      }
      return;
    }

    if (targetValue.kind === 'literal') {
      if (chainIndex < resolved.chain.length) {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolution chain contains an extra step after its terminal literal.',
          { fault: 'extra_step_after_literal', chain_index: chainIndex },
        );
      }
      if (resolved.status === 'resolved'
        && !snapshotMatchesTerminal(resolved.value, targetValue.value, rootToken)) {
        provenanceFinding(
          out, rootToken, rootModeId,
          'The resolved snapshot does not equal the terminal literal under the owner token type.',
          {
            fault: 'terminal_snapshot_mismatch', terminal_token_id: targetToken.id,
            terminal_mode_id: targetModeId,
          },
        );
      }
      return;
    }

    if (targetValue.reference.external) {
      if (resolved.status === 'resolved') {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A resolved local chain terminates at an unresolved external alias.',
          {
            fault: 'resolved_chain_external_terminal',
            token_id: targetToken.id, mode_id: targetModeId,
          },
        );
      }
      if (chainIndex < resolved.chain.length) {
        provenanceFinding(
          out, rootToken, rootModeId,
          'A local resolution chain continues through an external alias.',
          { fault: 'extra_step_after_external', chain_index: chainIndex },
        );
      }
      return;
    }
    if (resolved.status === 'resolved' && targetValue.resolved.status === 'unresolved') {
      provenanceFinding(
        out, rootToken, rootModeId,
        'A chain recorded as resolved passes through an alias recorded as unresolved.',
        {
          fault: 'resolved_chain_unresolved_alias',
          token_id: targetToken.id, mode_id: targetModeId,
          reason: targetValue.resolved.reason,
        },
      );
      return;
    }

    // An unresolved root may state only the honest prefix available before a
    // depth/source failure. Validate every supplied adjacency, but do not
    // invent or require a terminal it explicitly says it did not reach.
    if (resolved.status === 'unresolved' && chainIndex >= resolved.chain.length) return;

    currentToken = targetToken;
    currentModeId = targetModeId;
    currentValue = targetValue;
  }
}

/**
 * Verifies the alias metadata and the recorded resolution snapshot against the
 * artifact's stable identities, then independently replays every supplied
 * chain. This is deliberately separate from the graph walk: chain provenance
 * is validated as data, never used as the resolver's source of truth.
 */
function checkAliasProvenance(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const indexes: ValidationIndexes = {
    tokensById: new Map(artifact.tokens.map((token) => [token.id, token])),
    collectionsById: new Map(artifact.collections.map((collection) => [collection.id, collection])),
  };

  for (const token of artifact.tokens) {
    for (const [modeId, value] of Object.entries(token.values)) {
      if (value.kind !== 'alias') continue;
      const { reference, resolved } = value;
      const chainCode = reference.external
        ? 'UNRESOLVED_EXTERNAL_ALIAS' as const
        : 'UNRESOLVED_ALIAS' as const;

      for (let chainIndex = 0; chainIndex < resolved.chain.length; chainIndex += 1) {
        const step = resolved.chain[chainIndex];
        const stepToken = indexes.tokensById.get(step.token_id);
        if (stepToken === undefined) {
          out.push(diagnostic(chainCode, {
            entity_id: token.id,
            mode_id: modeId,
            message: `Alias resolution chain step ${chainIndex} names token ${JSON.stringify(step.token_id)}, which is not in this artifact.`,
            details: { chain_index: chainIndex, token_id: step.token_id, mode_id: step.mode_id },
          }));
          continue;
        }

        const stepCollection = indexes.collectionsById.get(stepToken.collection_id);
        if (stepCollection === undefined) {
          out.push(diagnostic(chainCode, {
            entity_id: token.id,
            mode_id: modeId,
            message: `Alias resolution chain step ${chainIndex} names token ${JSON.stringify(step.token_id)}, whose collection does not resolve.`,
            details: {
              chain_index: chainIndex, token_id: step.token_id,
              mode_id: step.mode_id, collection_id: stepToken.collection_id,
            },
          }));
          continue;
        }
        if (!stepCollection.modes.some((mode) => mode.id === step.mode_id)) {
          out.push(diagnostic(chainCode, {
            entity_id: token.id,
            mode_id: modeId,
            message: `Alias resolution chain step ${chainIndex} names mode ${JSON.stringify(step.mode_id)}, which is not declared by token ${JSON.stringify(step.token_id)}'s collection.`,
            details: { chain_index: chainIndex, token_id: step.token_id, mode_id: step.mode_id },
          }));
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(stepToken.values, step.mode_id)) {
          out.push(diagnostic(chainCode, {
            entity_id: token.id,
            mode_id: modeId,
            message: `Alias resolution chain step ${chainIndex} names a token/mode pair with no value record.`,
            details: { chain_index: chainIndex, token_id: step.token_id, mode_id: step.mode_id },
          }));
        }
      }

      if (reference.external) {
        if (resolved.status === 'unresolved') {
          out.push(diagnostic('UNRESOLVED_EXTERNAL_ALIAS', {
            entity_id: token.id,
            mode_id: modeId,
            message: `Alias references an external library that did not resolve: ${reference.source_library_name ?? 'unknown library'}.`,
            details: { reason: resolved.reason },
          }));
        }
        checkChainTruth(token, modeId, value, indexes, out);
        continue;
      }

      const targetToken = reference.target_id === null
        ? undefined
        : indexes.tokensById.get(reference.target_id);
      if (targetToken === undefined) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Alias reference target does not exist in this artifact: ${JSON.stringify(reference.target_id)}.`,
          details: { target_id: reference.target_id },
        }));
        checkChainTruth(token, modeId, value, indexes, out);
        continue;
      }

      if (resolved.status === 'unresolved') {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Internal alias is recorded as unresolved (${resolved.reason}).`,
          details: { target_id: targetToken.id, reason: resolved.reason },
        }));
      }

      if (reference.target_collection_id === null) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: 'Internal alias has a target token id but no target_collection_id.',
          details: { target_id: targetToken.id },
        }));
      } else if (!indexes.collectionsById.has(reference.target_collection_id)) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Internal alias target_collection_id ${JSON.stringify(reference.target_collection_id)} names no collection in this artifact.`,
          details: { target_id: targetToken.id, target_collection_id: reference.target_collection_id },
        }));
      } else if (reference.target_collection_id !== targetToken.collection_id) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Internal alias target_collection_id ${JSON.stringify(reference.target_collection_id)} does not match target token ${JSON.stringify(targetToken.id)}'s collection ${JSON.stringify(targetToken.collection_id)}.`,
          details: {
            target_id: targetToken.id,
            target_collection_id: reference.target_collection_id,
            actual_collection_id: targetToken.collection_id,
          },
        }));
      }

      if (!equalStringArrays(reference.target_path, targetToken.path)) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Internal alias target_path does not match target token ${JSON.stringify(targetToken.id)}'s path.`,
          details: { target_id: targetToken.id, target_path: reference.target_path, actual_path: targetToken.path },
        }));
      }

      if (!aliasTypesCompatible(token.type, targetToken.type)) {
        out.push(diagnostic('ALIAS_TYPE_MISMATCH', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Alias on a "${token.type}" token targets "${targetToken.id}", which is "${targetToken.type}".`,
        }));
      }

      checkChainTruth(token, modeId, value, indexes, out);
    }
  }
}

/** The ring node with the lowest (token_id, mode_id) by code-unit order, so a
 *  cycle is reported from the same node regardless of which token the walk
 *  happened to reach it from first -- entry order depends on array position,
 *  which §16 determinism forbids leaking into output. */
function lowestRingIndex(ring: AliasNode[]): number {
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const cmp = compareCodeUnits(ring[i].tokenId, ring[best].tokenId)
      || compareCodeUnits(ring[i].modeId, ring[best].modeId);
    if (cmp < 0) best = i;
  }
  return best;
}

/**
 * Walks the alias graph rooted at every (token, mode) pair holding an alias
 * value.
 *
 * ITERATIVE, with an explicit `path` array standing in for the call stack a
 * recursive walk would otherwise consume. A recursive depth-first walk blows
 * the JS call stack at a few thousand hops regardless of algorithmic
 * complexity -- exactly what `artifactWithChainOfLength(5000)` exists to
 * catch.
 *
 * MEMOIZED on (token_id, mode_id): once a node's outcome is known -- resolved
 * to a terminal value, unresolved, or part of an already-reported cycle -- it
 * is marked 'done' and is never walked again. That is what keeps whole-
 * artifact resolution linear instead of quadratic (§21.3): without it, every
 * node in an N-long chain would be re-walked from every one of its N
 * ancestors.
 *
 * The alias graph is a FUNCTIONAL graph: every node has out-degree at most 1
 * (one `reference` per alias value), so "does the walk return to a node
 * already on the CURRENT path" is the entire cycle test -- no branching DFS
 * is needed, only a path stack and an O(1) membership check on it.
 */
function walkAliasGraph(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const tokens = artifact.tokens;
  const tokensById = new Map(tokens.map((t) => [t.id, t]));
  const indexes: ValidationIndexes = {
    tokensById,
    collectionsById: new Map(artifact.collections.map((collection) => [collection.id, collection])),
  };
  const states = new Map<string, Map<string, NodeState>>();

  /**
   * The mode the walk continues under after a hop. Mode ids are
   * collection-scoped and selected independently from source/target mode
   * metadata. The recorded chain is evidence to validate, never an instruction
   * used to make a bad chain self-consistent.
   */
  const modeAfterHop = (
    fromToken: TokenV5, toToken: TokenV5, curModeId: string,
    _value: Extract<TokenV5['values'][string], { kind: 'alias' }>,
  ): string | undefined => {
    return expectedTargetMode(fromToken, curModeId, toToken, indexes);
  };

  const markDone = (path: AliasNode[]): void => {
    for (const node of path) nodeStates(states, node.tokenId).set(node.modeId, 'done');
  };

  const reportCycle = (path: AliasNode[], ringStart: number): void => {
    const ring = path.slice(ringStart);
    const lowest = lowestRingIndex(ring);
    const rotated = [...ring.slice(lowest), ...ring.slice(0, lowest)];
    const chain = [...rotated, rotated[0]].map((n) => ({ token_id: n.tokenId, mode_id: n.modeId }));
    out.push(diagnostic('ALIAS_CYCLE', {
      entity_id: rotated[0].tokenId,
      mode_id: rotated[0].modeId,
      message: `Alias resolution cycles back to itself: ${chain.map((c) => c.token_id).join(' -> ')}.`,
      details: { chain },
    }));
  };

  for (const startToken of tokens) {
    for (const startModeId of Object.keys(startToken.values)) {
      if (startToken.values[startModeId].kind !== 'alias') continue;
      if (getNodeState(states, startToken.id, startModeId) === 'done') continue;

      const path: AliasNode[] = [];
      const pathIndex = new Map<string, Map<string, number>>();
      let curTokenId = startToken.id;
      let curModeId = startModeId;

      while (true) {
        if (getNodeState(states, curTokenId, curModeId) === 'done') {
          // A prior walk already determined this node's outcome (and
          // reported whatever that outcome warranted). The nodes THIS walk
          // added leading up to it are new, though, and need marking.
          markDone(path);
          break;
        }

        const seenAt = pathIndex.get(curTokenId)?.get(curModeId);
        if (seenAt !== undefined) {
          reportCycle(path, seenAt);
          markDone(path);
          break;
        }

        nodeStates(states, curTokenId).set(curModeId, 'in_progress');
        const inner = pathIndex.get(curTokenId) ?? new Map<string, number>();
        inner.set(curModeId, path.length);
        pathIndex.set(curTokenId, inner);
        path.push({ tokenId: curTokenId, modeId: curModeId });

        const curToken = tokensById.get(curTokenId);
        const value = curToken?.values[curModeId];
        if (!curToken || !value || value.kind !== 'alias') {
          // Terminal: a literal, an explicit `missing` record, or simply no
          // entry for this mode on this token. Nothing further to resolve.
          markDone(path);
          break;
        }

        const { reference } = value;
        if (reference.external) {
          // External resolution is checked by `checkAliasProvenance`; the
          // local graph cannot walk into a library that is absent here.
          markDone(path);
          break;
        }

        const targetId = reference.target_id;
        const targetToken = targetId === null ? undefined : tokensById.get(targetId);
        if (!targetToken) {
          // `checkAliasProvenance` owns the actionable dangling-target
          // diagnostic; this walker owns cycle detection only.
          markDone(path);
          break;
        }

        // Which mode the walk continues under. See `modeAfterHop`; this is
        // replayed from artifact collection metadata, not copied from the
        // alias's own asserted provenance.
        const nextModeId = modeAfterHop(curToken, targetToken, curModeId, value);
        if (nextModeId === undefined) {
          // No authoritative cross-collection mode was recorded. Provenance
          // validation reports that; the graph must not guess one merely to
          // keep walking.
          markDone(path);
          break;
        }

        curTokenId = targetToken.id;
        curModeId = nextModeId;
      }
    }
  }
}

/**
 * §7: every token must carry an entry for every mode its collection
 * declares -- either a value, or an explicit `{kind: 'missing'}` record
 * stating so. Omitting the key entirely is the ABSENT case ("An absent mode
 * value MUST be distinguishable from an explicit null value"); a `missing`
 * record is the token stating the fact itself, so it is not reported.
 */
function checkModeCompleteness(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const collectionsById = new Map(artifact.collections.map((c) => [c.id, c]));
  for (const token of artifact.tokens) {
    const collection = collectionsById.get(token.collection_id);
    // A token whose collection is not in the artifact has no declared mode
    // list to check against, so this check genuinely cannot run for it -- but
    // it is NOT skipped silently: `checkReferences` reports the dangling
    // `collection_id` as UNRESOLVED_REFERENCE. That fact has exactly one owner,
    // there, which is why this does not report it a second time.
    if (!collection) continue;
    for (const mode of collection.modes) {
      if (!(mode.id in token.values)) {
        out.push(diagnostic('MISSING_MODE_VALUE', {
          entity_id: token.id,
          mode_id: mode.id,
          message: `Token has no value record for mode "${mode.name}" (${mode.id}), and does not declare it explicitly missing.`,
        }));
      }
    }
  }
}

/**
 * §6: id is identity. Two entities -- of any kind -- sharing one stable id
 * makes that id useless as identity, since a consumer joining on it cannot
 * tell which entity it means.
 */
function checkDuplicateIds(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const allIds = [
    ...artifact.collections.map((c) => c.id),
    ...artifact.tokens.map((t) => t.id),
    ...artifact.styles.typography.map((s) => s.id),
    ...artifact.styles.effects.map((s) => s.id),
  ];
  const counts = new Map<string, number>();
  for (const id of allIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const reported = new Set<string>();
  for (const id of allIds) {
    const count = counts.get(id) ?? 0;
    if (count > 1 && !reported.has(id)) {
      reported.add(id);
      out.push(diagnostic('DUPLICATE_SOURCE_ID', {
        entity_id: id,
        message: `${count} entities share the stable id "${id}".`,
      }));
    }
  }

  // Mode ids are collection-scoped, so the same id in two collections is
  // valid. Repeating one inside a collection is not: default_mode_id and
  // resolution-chain references would identify two records at once.
  for (const collection of artifact.collections) {
    const modeCounts = new Map<string, number>();
    for (const mode of collection.modes) {
      modeCounts.set(mode.id, (modeCounts.get(mode.id) ?? 0) + 1);
    }
    for (const [modeId, count] of modeCounts) {
      if (count > 1) {
        out.push(diagnostic('DUPLICATE_SOURCE_ID', {
          entity_id: collection.id,
          mode_id: modeId,
          message: `${count} modes in collection "${collection.id}" share the id "${modeId}".`,
          details: { collection_id: collection.id, mode_id: modeId, count },
        }));
      }
    }
  }
}

/**
 * §6: a normalized-path collision, scoped to `(collection_id, NFC(path))`.
 * Two collections both holding the same path is the normal, intended shape of
 * a themed design system -- a collection IS the namespace -- so this is
 * deliberately NOT a global check; flagging the cross-collection case would
 * fire on nearly every real file.
 */
function checkPathCollisions(tokens: TokenV5[], out: Diagnostic[]): void {
  const groups = new Map<string, TokenV5[]>();
  for (const token of tokens) {
    const key = JSON.stringify([token.collection_id, token.path.map((seg) => seg.normalize('NFC'))]);
    const group = groups.get(key);
    if (group) group.push(token); else groups.set(key, [token]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = group.map((t) => t.id).sort(compareCodeUnits);
    out.push(diagnostic('PATH_COLLISION', {
      entity_id: ids[0],
      message: `${group.length} tokens in collection "${group[0].collection_id}" normalize to the same path: ${JSON.stringify(group[0].path)}.`,
      details: { collection_id: group[0].collection_id, token_ids: ids },
    }));
  }
}

/**
 * §18 Level 2's OTHER four reference classes.
 *
 * The level requires that "collection, mode, alias, replacement, and binding
 * references resolve". `walkAliasGraph` covers aliases and
 * `checkModeCompleteness` covers per-token mode records; nothing covered the
 * rest, so an artifact with a `collection_id` naming no collection, a
 * `default_mode_id` naming no declared mode, and a `replacement_id` naming no
 * token passed BOTH levels clean. Worse, the dangling `collection_id` made
 * `checkModeCompleteness` skip that token entirely, so a broken reference
 * SUPPRESSED a check instead of producing a finding.
 *
 * Every finding here is `UNRESOLVED_REFERENCE`, never `UNRESOLVED_ALIAS`: see
 * that code's comment in diagnostics.ts for why the two must stay apart.
 */
function checkReferences(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const collectionsById = new Map(artifact.collections.map((collection) => [collection.id, collection]));
  const collectionIds = new Set(collectionsById.keys());
  const tokensById = new Map(artifact.tokens.map((token) => [token.id, token]));
  const tokenIds = new Set(artifact.tokens.map((t) => t.id));
  // Replacement targets are resolved against EVERY entity id rather than
  // against the same kind as the referrer. §18 requires only that a
  // replacement "resolves"; requiring a token to be replaced by a token would
  // be a stricter rule than the spec states, and would fire on the legitimate
  // case of a token superseded by a composite style.
  const allEntityIds = new Set([
    ...collectionIds,
    ...tokenIds,
    ...artifact.styles.typography.map((s) => s.id),
    ...artifact.styles.effects.map((s) => s.id),
  ]);

  for (const collection of artifact.collections) {
    // §7: "The default mode MUST reference a declared mode ID." Checked
    // against the collection's OWN mode list, not a global mode set: mode ids
    // are collection-scoped, so a default naming another collection's mode is
    // just as dangling as one naming nothing.
    if (!collection.modes.some((m) => m.id === collection.default_mode_id)) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: collection.id,
        message: `Collection default_mode_id ${JSON.stringify(collection.default_mode_id)} names `
          + `none of the ${collection.modes.length} mode(s) this collection declares.`,
        details: {
          default_mode_id: collection.default_mode_id,
          declared_modes: collection.modes.map((m) => m.id),
        },
      }));
    }
  }

  for (const token of artifact.tokens) {
    if (!collectionIds.has(token.collection_id)) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: token.id,
        message: `Token collection_id ${JSON.stringify(token.collection_id)} names no collection `
          + 'in this artifact.',
        details: { collection_id: token.collection_id },
      }));
      continue;
    }
    const collection = collectionsById.get(token.collection_id)!;
    const declaredModeIds = new Set(collection.modes.map((mode) => mode.id));
    for (const modeId of Object.keys(token.values)) {
      if (!declaredModeIds.has(modeId)) {
        out.push(diagnostic('UNRESOLVED_REFERENCE', {
          entity_id: token.id,
          mode_id: modeId,
          message: `Token value key ${JSON.stringify(modeId)} names no mode declared by its collection.`,
          details: { collection_id: token.collection_id, mode_id: modeId },
        }));
      }
    }
  }

  // §11: typography properties carry their variable binding in `source`.
  // These aliases are not TokenV5 values, so `walkAliasGraph` cannot see them;
  // validate their stable target identity and path explicitly here.
  for (const style of artifact.styles.typography) {
    for (const propertyName of TYPOGRAPHY_STYLE_PROPERTIES) {
      const source = style.properties[propertyName].source;
      if (source.kind !== 'alias') continue;
      const targetToken = source.target_id === null
        ? undefined
        : tokensById.get(source.target_id);
      if (targetToken === undefined) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: style.id,
          message: `Typography property ${JSON.stringify(propertyName)} aliases a token that is `
            + `not in this artifact: ${JSON.stringify(source.target_id)}.`,
          details: { property: propertyName, target_id: source.target_id },
        }));
        continue;
      }
      if (!equalStringArrays(source.target_path, targetToken.path)) {
        out.push(diagnostic('UNRESOLVED_ALIAS', {
          entity_id: style.id,
          message: `Typography property ${JSON.stringify(propertyName)} target_path does not `
            + `match token ${JSON.stringify(targetToken.id)}'s path.`,
          details: {
            property: propertyName, target_id: targetToken.id,
            target_path: source.target_path, actual_path: targetToken.path,
          },
        }));
      }
    }
  }

  // §12: an effect style's mode is a reference just like a token value key.
  // Mode ids are collection-scoped, so an id repeated across collections is
  // valid in isolation but ambiguous when a style carries no collection id to
  // qualify it.
  const modeOwners = new Map<string, string[]>();
  for (const collection of artifact.collections) {
    for (const mode of collection.modes) {
      const owners = modeOwners.get(mode.id) ?? [];
      owners.push(collection.id);
      modeOwners.set(mode.id, owners);
    }
  }
  for (const style of artifact.styles.effects) {
    if (style.mode_id === null) continue;
    const owners = modeOwners.get(style.mode_id) ?? [];
    if (owners.length === 0) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: style.id,
        message: `Effect style mode_id ${JSON.stringify(style.mode_id)} names no declared mode `
          + 'in this artifact.',
        details: { mode_id: style.mode_id },
      }));
    } else if (owners.length > 1) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: style.id,
        message: `Effect style mode_id ${JSON.stringify(style.mode_id)} is ambiguous across `
          + `${owners.length} declared mode records.`,
        details: { mode_id: style.mode_id, collection_ids: owners },
      }));
    }
  }

  // §11/§12/§13: lifecycle lives on tokens and on both style kinds, so the
  // replacement check walks all three rather than tokens alone.
  const withLifecycle: { id: string; replacement_id: string | null }[] = [
    ...artifact.tokens,
    ...artifact.styles.typography,
    ...artifact.styles.effects,
  ].flatMap((e) => (e.lifecycle === undefined
    ? []
    : [{ id: e.id, replacement_id: e.lifecycle.replacement_id }]));

  for (const { id, replacement_id: replacementId } of withLifecycle) {
    // `null` is the stated "no replacement", which resolves trivially. Only a
    // named replacement can dangle.
    if (replacementId !== null && !allEntityIds.has(replacementId)) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: id,
        message: `lifecycle.replacement_id ${JSON.stringify(replacementId)} names no entity in `
          + 'this artifact.',
        details: { replacement_id: replacementId },
      }));
    }
  }

  // §12: a binding is the explicit link between a scalar token and the
  // composite property it drives, so a binding naming no token makes the
  // style's own provenance unreadable. Only effect styles carry `bindings`;
  // typography's per-property aliases were checked above.
  for (const style of artifact.styles.effects) {
    for (const binding of style.bindings ?? []) {
      const property = binding.property.match(
        /^effects\[(\d+)\]\.(color|offset_x|offset_y|blur|spread)$/,
      );
      const effectIndex = property === null ? -1 : Number(property[1]);
      const effectField = property?.[2] as keyof EffectStyleV5['effects'][number] | undefined;
      if (
        property === null
        || effectField === undefined
        || style.effects[effectIndex]?.[effectField] === undefined
      ) {
        out.push(diagnostic('UNRESOLVED_REFERENCE', {
          entity_id: style.id,
          message: `Style binding property ${JSON.stringify(binding.property)} names no `
            + 'exported scalar effect property.',
          details: { property: binding.property, token_id: binding.token_id },
        }));
      }
      if (!tokenIds.has(binding.token_id)) {
        out.push(diagnostic('UNRESOLVED_REFERENCE', {
          entity_id: style.id,
          message: `Style binding for ${JSON.stringify(binding.property)} names token `
            + `${JSON.stringify(binding.token_id)}, which is not in this artifact.`,
          details: { property: binding.property, token_id: binding.token_id },
        }));
      }
    }
  }
}

/**
 * Level 2 validation — spec §18 "Referential integrity" and §10 "Alias
 * graph". Assumes `artifact` has already passed `validateLevel1`.
 */
export function validateLevel2(artifact: FoundationArtifactV5): Diagnostic[] {
  try {
    const out: Diagnostic[] = [];
    checkAliasProvenance(artifact, out);
    walkAliasGraph(artifact, out);
    checkModeCompleteness(artifact, out);
    checkDuplicateIds(artifact, out);
    checkPathCollisions(artifact.tokens, out);
    checkReferences(artifact, out);
    return out;
  } catch (err) {
    // The public API stays total even when a caller ignores the documented
    // Level-1-first sequence and defeats the TypeScript boundary with unknown
    // JSON. Valid Level 1 output should never reach this fallback; it is the
    // final guard against hostile getters and unchecked casts.
    const message = err instanceof Error && err.message
      ? `Level 2 could not read the artifact: ${err.message}`
      : 'Level 2 could not read the artifact.';
    return [shape(ROOT, message)];
  }
}

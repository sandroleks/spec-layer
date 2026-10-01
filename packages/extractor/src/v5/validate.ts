/**
 * Level 1 validation (spec §18 "Schema validity"): a hand-written mirror of
 * `schema/foundation-5.1.1.json`, because the plugin sandbox cannot load
 * `ajv`. `test/v5/schemaParity.test.ts` keeps the two from drifting.
 *
 * Two codes carry its judgment:
 *  - `INCONSISTENT_VALUE_SHAPE`: not the shape the union promises (a missing or
 *    unknown discriminant such as `kind`, `type` or `status`, a bare primitive
 *    for an object, a required structural key absent).
 *  - `UNSUPPORTED_VALUE_TYPE`: a typed value of a known kind whose leaf field
 *    cannot be represented (no unit, an unknown unit, a hex that is not six
 *    lowercase digits, a non-finite number, an alpha outside 0..1).
 *
 * `validateLevel1` never throws: every access is type-guarded, since a
 * validator that crashes on malformed input cannot report on it.
 */
import { compareCodeUnits, diagnostic } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import {
  SUPPORTED_DURATION_UNITS, SUPPORTED_MISSING_REASONS, SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS,
  SUPPORTED_UNRESOLVED_REASONS, SUPPORTED_VALUE_KINDS,
} from './value';
import type { CanonicalValue, MissingReason, TokenType, TypedValue, Unit, UnresolvedReason } from './value';
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

/** Names an absent reason: `JSON.stringify(undefined)` would print a bare
 *  `undefined`, indistinguishable from the string "undefined". */
function describeReason(value: unknown): string {
  return value === undefined ? 'no reason at all' : JSON.stringify(value);
}

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
 * A typed value (§9) whose `type` is already known valid, so every failure
 * here is content the shape cannot carry, never a shape problem.
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
      // The runtime vocabulary, so schemaParity.test.ts checks this and the
      // schema's enum against one source.
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
      // Unreachable: the caller checked `type`.
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
    if (!isNonEmptyString(resolved.reason)
      || !SUPPORTED_UNRESOLVED_REASONS.includes(resolved.reason as UnresolvedReason)) {
      out.push(shape(entityId, `An unresolved alias must carry a reason from the v5 vocabulary, not ${describeReason(resolved.reason)}.`, modeId));
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
    if (!isNonEmptyString(value.reason)
      || !SUPPORTED_MISSING_REASONS.includes(value.reason as MissingReason)) {
      out.push(shape(entityId, `A missing value must carry a reason from the v5 vocabulary, not ${describeReason(value.reason)}.`, modeId));
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

/** §8: one token record, structurally. Cross-references (does `collection_id`
 *  resolve, a value for every mode) are Level 2/3. */
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
  if (token.code_syntax !== undefined) {
    if (!isRecord(token.code_syntax)
      || Object.values(token.code_syntax).some((v) => typeof v !== 'string')) {
      out.push(shape(entityId, 'token.code_syntax must be an object of strings when present.'));
    }
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
 * §5.2: the top-level sections every artifact must expose, validated with
 * every nested field Level 2 dereferences, so "Level 1 accepted" is a safe
 * precondition for Level 2.
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
 * Level 1 validation; never throws. Each diagnostic is anchored to its entity
 * (`entity_id`, plus `mode_id` for a fault in one mode's value), so a caller
 * joins findings without re-deriving positions from array indices.
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
    // A throwing getter or Proxy trap fires during the read, past any type
    // guard, so the no-throw guarantee is enforced here.
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
// Level 2: referential integrity (§18 Level 2, §10 "Alias graph", §7 modes,
// §6 identity and paths). Takes a typed artifact Level 1 already accepted, so
// it carries no defensive guarding.
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
 * Independently replays Figma's mode choice without consulting a recorded
 * chain, so a wrong mode selection cannot validate its own output.
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
  // Figma aliases enforce raw FLOAT/STRING compatibility, which scopes may
  // specialize into dimension/font_family; the only cross-type pairs accepted.
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

/**
 * Whether two typed values state the same thing, allowing the two v5 type
 * pairs that are one raw Figma type: a FLOAT is `number` or `dimension` by its
 * scopes, a STRING is `font_family` under FONT_FAMILY. Two dimensions in
 * different units still disagree. Shared by the Level 2 chain replay and the
 * style-binding drift check in `fromFoundation.ts`, so both judge alike.
 */
export function typedValuesAgree(a: TypedValue, b: TypedValue): boolean {
  if (a.type === b.type) return canonicalJson(a) === canonicalJson(b);
  if ((a.type === 'dimension' && b.type === 'number')
    || (a.type === 'number' && b.type === 'dimension')) {
    return scalarOf(a) === scalarOf(b);
  }
  if ((a.type === 'font_family' && b.type === 'string')
    || (a.type === 'string' && b.type === 'font_family')) {
    return scalarOf(a) === scalarOf(b);
  }
  return false;
}

function snapshotMatchesTerminal(
  snapshot: TypedValue,
  terminal: TypedValue,
  owner: TokenV5,
): boolean {
  // A dimension over a bare-number terminal must be the owner's own
  // specialization: its scopes must reproduce exactly this dimension.
  if (snapshot.type === 'dimension' && terminal.type === 'number') {
    const specialized = numericValue(terminal.value, owner.scopes);
    return specialized !== null && canonicalJson(snapshot) === canonicalJson(specialized);
  }
  return typedValuesAgree(snapshot, terminal);
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

    // An unresolved root may state only the honest prefix before a depth or
    // source failure: check every supplied hop, never require a terminal.
    if (resolved.status === 'unresolved' && chainIndex >= resolved.chain.length) return;

    currentToken = targetToken;
    currentModeId = targetModeId;
    currentValue = targetValue;
  }
}

/**
 * Verifies alias metadata and resolution snapshots against the artifact's
 * identities, then replays every chain. Separate from the graph walk: chain
 * provenance is validated as data, never used as the resolver's truth.
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

/** The ring node with the lowest (token_id, mode_id) by code unit, so a cycle
 *  is reported from one node whatever the walk's entry order (§16). */
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
 * Walks the alias graph from every (token, mode) pair holding an alias.
 * Iterative, with `path` as the stack, since recursion overflows at a few
 * thousand hops. Memoized on (token_id, mode_id): a node with a known outcome
 * is 'done' and never walked again, keeping whole-artifact resolution linear
 * (§21.3). Every node has out-degree at most 1, so "back on the current path"
 * is the whole cycle test.
 */
function walkAliasGraph(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const tokens = artifact.tokens;
  const tokensById = new Map(tokens.map((t) => [t.id, t]));
  const indexes: ValidationIndexes = {
    tokensById,
    collectionsById: new Map(artifact.collections.map((collection) => [collection.id, collection])),
  };
  const states = new Map<string, Map<string, NodeState>>();

  /** The mode after a hop, replayed from collection metadata; the recorded
   *  chain is evidence to validate, never an instruction. */
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
          // A prior walk settled this node; mark the nodes this walk added.
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
          // Terminal: a literal, a `missing` record, or no entry for this mode.
          markDone(path);
          break;
        }

        const { reference } = value;
        if (reference.external) {
          // `checkAliasProvenance` checks externals; an absent library cannot be walked.
          markDone(path);
          break;
        }

        const targetId = reference.target_id;
        const targetToken = targetId === null ? undefined : tokensById.get(targetId);
        if (!targetToken) {
          // `checkAliasProvenance` owns dangling targets; this walker owns cycles.
          markDone(path);
          break;
        }

        const nextModeId = modeAfterHop(curToken, targetToken, curModeId, value);
        if (nextModeId === undefined) {
          // No authoritative mode: provenance validation reports it, and the
          // walk never guesses one.
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
 * §7: every token carries an entry for every mode its collection declares, a
 * value or an explicit `{kind: 'missing'}`. Only an absent key is reported ("An
 * absent mode value MUST be distinguishable from an explicit null value").
 */
function checkModeCompleteness(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const collectionsById = new Map(artifact.collections.map((c) => [c.id, c]));
  for (const token of artifact.tokens) {
    const collection = collectionsById.get(token.collection_id);
    // No collection, no mode list; `checkReferences` owns the dangling
    // `collection_id` (UNRESOLVED_REFERENCE).
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

/** §6: id is identity, so two entities of any kind sharing one cannot be told
 *  apart by a consumer joining on it. */
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

  // Mode ids are collection-scoped: one id in two collections is valid, but a
  // repeat within one makes default_mode_id and chain references ambiguous.
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
 * §6: a normalized-path collision, scoped to `(collection_id, NFC(path))`. A
 * collection is the namespace, so one path in two collections is the normal
 * themed shape and is not flagged.
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
 * §18 Level 2's other reference classes ("collection, mode, alias,
 * replacement, and binding references resolve") beyond `walkAliasGraph` and
 * `checkModeCompleteness`. A broken collection, mode, replacement or binding
 * reference is `UNRESOLVED_REFERENCE`; a typography alias to a missing or
 * mismatched token is `UNRESOLVED_ALIAS`, like any other alias (diagnostics.ts).
 */
function checkReferences(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const collectionsById = new Map(artifact.collections.map((collection) => [collection.id, collection]));
  const collectionIds = new Set(collectionsById.keys());
  const tokensById = new Map(artifact.tokens.map((token) => [token.id, token]));
  const tokenIds = new Set(artifact.tokens.map((t) => t.id));
  // Replacements resolve against every entity id: §18 only requires that one
  // "resolves", and a token may be superseded by a composite style.
  const allEntityIds = new Set([
    ...collectionIds,
    ...tokenIds,
    ...artifact.styles.typography.map((s) => s.id),
    ...artifact.styles.effects.map((s) => s.id),
  ]);

  for (const collection of artifact.collections) {
    // §7: "The default mode MUST reference a declared mode ID", from the
    // collection's own modes, since mode ids are collection-scoped.
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

  // §11: typography bindings live in `source`, not in TokenV5 values, so
  // `walkAliasGraph` never sees them.
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

  // §12: an effect style's mode is a reference. An id repeated across
  // collections is ambiguous, since a style names no collection.
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
    // `null` states "no replacement"; only a named one can dangle.
    if (replacementId !== null && !allEntityIds.has(replacementId)) {
      out.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: id,
        message: `lifecycle.replacement_id ${JSON.stringify(replacementId)} names no entity in `
          + 'this artifact.',
        details: { replacement_id: replacementId },
      }));
    }
  }

  // §12: a binding naming no token makes the style's provenance unreadable.
  // Only effect styles carry `bindings`.
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

/** Level 2 validation (spec §18 "Referential integrity", §10 "Alias graph").
 *  Assumes `artifact` already passed `validateLevel1`. */
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
    // Total even when a caller skips Level 1 and casts unknown JSON: the last
    // guard against hostile getters and unchecked casts.
    const message = err instanceof Error && err.message
      ? `Level 2 could not read the artifact: ${err.message}`
      : 'Level 2 could not read the artifact.';
    return [shape(ROOT, message)];
  }
}

/**
 * Shared v5 test fixtures.
 *
 * `OK_ARTIFACT` is the one minimal, fully valid artifact every other fixture
 * in this module is derived from by cloning and mutating a single field —
 * exactly the pattern `validate.test.ts` uses inline (`structuredClone(OK_ARTIFACT)`
 * then poke one field). Keeping the mutations local and un-exported here (as
 * `withValue` / `withToken` / `withRoot`) leaves room for Task 8 to add its own
 * exported `artifactWith*` helpers alongside them without a naming collision.
 *
 * `VALID_CASES` and `INVALID_CASES` are the parity fixtures: `schemaParity.test.ts`
 * runs every one through BOTH the published JSON Schema and `validateLevel1`,
 * and both must agree — accepting the valid ones, rejecting the invalid ones.
 * A rejection-side fixture exists for every structural or content rule
 * `validateLevel1` implements; see the comment above each group below.
 */
import { SUPPORTED_DURATION_UNITS, SUPPORTED_UNITS } from '../../src/v5/value';
import type { CanonicalValue, TokenType, TypedValue } from '../../src/v5/value';
import type { CollectionV5, TokenV5 } from '../../src/v5/entities';
import type { ArtifactSource, FoundationArtifactV5, SemanticPayload } from '../../src/v5/canonical';
import { buildEnvelope } from '../../src/v5/canonical';

const SOURCE: ArtifactSource = {
  provider: 'figma',
  file_id: 'F:1',
  file_name: 'Company Foundations',
  file_version: null,
  library_enabled: true,
};

const COLLECTION: CollectionV5 = {
  id: 'VariableCollectionId:1:2',
  name: 'Display mode',
  path: ['Display mode'],
  default_mode_id: '1:2/light',
  modes: [
    { id: '1:2/light', name: 'light', order: 0 },
    { id: '1:2/dark', name: 'dark', order: 1 },
  ],
  publication: { published: true, hidden_from_publishing: false },
  source: { remote: false, library_file_id: null, library_name: null, modified_at: null },
};

const TOKEN: TokenV5 = {
  id: 'VariableID:3:4',
  collection_id: 'VariableCollectionId:1:2',
  name: 'Background/Surface/Page',
  path: ['Background', 'Surface', 'Page'],
  type: 'color',
  description: 'Use for a page or screen background.',
  scopes: ['FRAME_FILL', 'SHAPE_FILL'],
  publication: { published: true, hidden_from_publishing: false },
  lifecycle: { status: 'active', replacement_id: null },
  values: {
    '1:2/light': { kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 } },
    '1:2/dark': { kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#00332f', alpha: 1 } },
  },
};

const PAYLOAD: SemanticPayload = {
  completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
  collections: [COLLECTION],
  tokens: [TOKEN],
  styles: { typography: [], effects: [] },
};

const META = {
  exportId: 'fixture-export',
  generatedAt: '2026-01-01T00:00:00.000Z',
  build: 'fixture-build',
  source: SOURCE,
};

/** A minimal, fully valid Foundation Context v5 artifact: one collection, one
 *  color token with a value for each of its two modes, and empty style
 *  arrays (Phase 1 emits no typography or effect styles). */
export const OK_ARTIFACT: FoundationArtifactV5 = {
  ...PAYLOAD,
  spec_layer: buildEnvelope(PAYLOAD, META),
  diagnostics: [],
  statistics: {},
};

export interface FixtureCase { name: string; artifact: unknown }

// ---------------------------------------------------------------------------
// Local mutators. Not exported: these exist to build the case tables below,
// not as part of this module's public surface.
// ---------------------------------------------------------------------------

function clone(): Record<string, unknown> {
  return structuredClone(OK_ARTIFACT) as unknown as Record<string, unknown>;
}

function firstToken(root: Record<string, unknown>): Record<string, unknown> {
  return (root.tokens as Record<string, unknown>[])[0];
}

/** Replaces the light-mode value of the fixture's one token. */
function withValue(value: unknown): Record<string, unknown> {
  const root = clone();
  (firstToken(root).values as Record<string, unknown>)['1:2/light'] = value;
  return root;
}

/** Mutates the fixture's one token record directly. */
function withToken(mutate: (token: Record<string, unknown>) => void): Record<string, unknown> {
  const root = clone();
  mutate(firstToken(root));
  return root;
}

/** Mutates the artifact root directly. */
function withRoot(mutate: (root: Record<string, unknown>) => void): Record<string, unknown> {
  const root = clone();
  mutate(root);
  return root;
}

/** Replaces the fixture's one token with a fresh one of the given type,
 *  carrying `value` for both declared modes. Used to cover every member of
 *  `SUPPORTED_TOKEN_TYPES` on the accept side. */
function withTokenOfType(type: TokenV5['type'], value: TypedValue): Record<string, unknown> {
  const literal: CanonicalValue = { kind: 'literal', value };
  return withToken((token) => {
    token.type = type;
    token.values = { '1:2/light': literal, '1:2/dark': literal };
  });
}

function withValidStyles(
  mutate?: (styles: Record<string, unknown>) => void,
): Record<string, unknown> {
  const root = clone();
  const literalProperty = (resolved: TypedValue) => ({
    source: { kind: 'literal' }, resolved,
  });
  const styles: Record<string, unknown> = {
    typography: [{
      id: 'TypographyStyleId:1',
      name: 'Heading/XL',
      path: ['Heading', 'XL'],
      description: '',
      lifecycle: { status: 'active', replacement_id: null },
      properties: {
        font_family: literalProperty({ type: 'font_family', value: 'Inter' }),
        font_weight: literalProperty({ type: 'number', value: 700 }),
        font_size: literalProperty({ type: 'dimension', number: 42, unit: 'px' }),
        line_height: literalProperty({ type: 'dimension', number: 50, unit: 'px' }),
        letter_spacing: literalProperty({ type: 'dimension', number: 0, unit: '%' }),
        paragraph_spacing: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
        paragraph_indent: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
        text_case: 'original',
        text_decoration: 'none',
      },
    }],
    effects: [{
      id: 'EffectStyleId:1',
      name: 'Shadow/Card',
      path: ['Shadow', 'Card'],
      mode_id: '1:2/light',
      lifecycle: { status: 'active', replacement_id: null },
      effects: [{
        type: 'drop_shadow', visible: true, blend_mode: 'normal',
        color: { type: 'color', color_space: 'srgb', hex: '#000000', alpha: 0.2 },
        offset_x: { type: 'dimension', number: 0, unit: 'px' },
        offset_y: { type: 'dimension', number: 2, unit: 'px' },
        blur: { type: 'dimension', number: 8, unit: 'px' },
        spread: { type: 'dimension', number: 0, unit: 'px' },
        show_behind_node: false,
      }],
      bindings: [{ property: 'effects[0].color', token_id: 'VariableID:3:4' }],
    }],
  };
  mutate?.(styles);
  root.styles = styles;
  return root;
}

// ---------------------------------------------------------------------------
// VALID_CASES — one per SUPPORTED_TOKEN_TYPES member, one per SUPPORTED_UNITS
// member, one per SUPPORTED_DURATION_UNITS member, plus the non-literal value
// kinds (alias, resolved and unresolved; missing).
//
// The unit cases are GENERATED from the runtime vocabularies rather than hand-
// listed. Before this, coverage was `px` and `ms` only: five of the seven units
// and one of the two duration units never went through either validator, so the
// published schema and the hand-written validator could disagree about them
// with every test still green. Generating the cases means adding a member to
// `SUPPORTED_UNITS` automatically produces a case that both validators must
// accept, and `schemaParity.test.ts` asserts the resulting coverage is total —
// the guard is structural, not a list somebody has to remember to extend.
// ---------------------------------------------------------------------------

const RESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: 'VariableID:color-teal-500',
    target_collection_id: 'VariableCollectionId:color-base',
    target_path: ['color', 'teal-green', '500'],
    external: false,
  },
  resolved: {
    status: 'resolved',
    value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
    chain: [{ token_id: 'VariableID:color-teal-500', mode_id: '1:2/light' }],
  },
};

const UNRESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: null, target_collection_id: null,
    target_path: ['coolGray-80'], external: true,
    source_library_name: 'Color base [deprecated]',
  },
  resolved: { status: 'unresolved', reason: 'source_library_unavailable', value: null, chain: [] },
};

const MISSING_VALUE: CanonicalValue = { kind: 'missing', reason: 'no_value_for_mode' };

export const VALID_CASES: FixtureCase[] = [
  { name: 'minimal valid artifact (color token)', artifact: OK_ARTIFACT },
  { name: 'valid typography and effect styles', artifact: withValidStyles() },
  ...SUPPORTED_UNITS.map((unit) => ({
    name: `dimension token with unit "${unit}"`,
    artifact: withTokenOfType('dimension', { type: 'dimension', number: 16, unit }),
  })),
  { name: 'number token', artifact: withTokenOfType('number', { type: 'number', value: 400 }) },
  { name: 'string token', artifact: withTokenOfType('string', { type: 'string', value: 'Inter' }) },
  { name: 'boolean token', artifact: withTokenOfType('boolean', { type: 'boolean', value: true }) },
  ...SUPPORTED_DURATION_UNITS.map((unit) => ({
    name: `duration token with unit "${unit}"`,
    artifact: withTokenOfType('duration', { type: 'duration', number: 200, unit }),
  })),
  { name: 'cubic_bezier token', artifact: withTokenOfType('cubic_bezier', { type: 'cubic_bezier', value: [0.4, 0, 0.2, 1] }) },
  { name: 'font_family token', artifact: withTokenOfType('font_family', { type: 'font_family', value: 'Inter' }) },
  { name: 'resolved alias value', artifact: withValue(RESOLVED_ALIAS) },
  { name: 'unresolved alias value', artifact: withValue(UNRESOLVED_ALIAS) },
  { name: 'missing value', artifact: withValue(MISSING_VALUE) },
  {
    name: 'color value with source channels',
    artifact: withValue({
      kind: 'literal',
      value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1, channels: [0, 0.42, 0.38] },
    }),
  },
];

// ---------------------------------------------------------------------------
// INVALID_CASES — one per rejection rule `validateLevel1` implements.
// Grouped to match the structure of validate.ts: root sections, token
// record fields, value-kind shape, alias sub-structure, and typed-value
// content.
// ---------------------------------------------------------------------------

export const INVALID_CASES: FixtureCase[] = [
  // -- root is not an object at all --
  { name: 'root is not an object', artifact: 'not-an-object' },

  // -- §5.2 top-level sections: required, and the right container type --
  { name: 'root missing spec_layer', artifact: withRoot((r) => { delete r.spec_layer; }) },
  { name: 'root completeness has an unrecognized value', artifact: withRoot((r) => { (r.completeness as Record<string, unknown>).collections = 'bogus'; }) },
  { name: 'root completeness.unavailable_sources not an array of strings', artifact: withRoot((r) => { (r.completeness as Record<string, unknown>).unavailable_sources = [1, 2]; }) },
  { name: 'root collections not an array', artifact: withRoot((r) => { r.collections = {}; }) },
  { name: 'collection entry is not an object', artifact: withRoot((r) => { (r.collections as unknown[])[0] = null; }) },
  { name: 'collection mode entry is not an object', artifact: withRoot((r) => { ((r.collections as Record<string, unknown>[])[0].modes as unknown[])[0] = null; }) },
  { name: 'collection mode order is not a number', artifact: withRoot((r) => { (((r.collections as Record<string, unknown>[])[0].modes as Record<string, unknown>[])[0]).order = 'first'; }) },
  { name: 'collection publication is malformed', artifact: withRoot((r) => { (r.collections as Record<string, unknown>[])[0].publication = { published: true }; }) },
  { name: 'collection source is malformed', artifact: withRoot((r) => { (r.collections as Record<string, unknown>[])[0].source = null; }) },
  { name: 'root styles.typography not an array', artifact: withRoot((r) => { (r.styles as Record<string, unknown>).typography = 'x'; }) },
  { name: 'typography style entry is not an object', artifact: withValidStyles((s) => { (s.typography as unknown[])[0] = null; }) },
  { name: 'typography lifecycle is malformed', artifact: withValidStyles((s) => { ((s.typography as Record<string, unknown>[])[0]).lifecycle = 'active'; }) },
  { name: 'typography property is malformed', artifact: withValidStyles((s) => { ((((s.typography as Record<string, unknown>[])[0]).properties as Record<string, unknown>)).font_size = null; }) },
  { name: 'effect style entry is not an object', artifact: withValidStyles((s) => { (s.effects as unknown[])[0] = null; }) },
  { name: 'effect style lifecycle is malformed', artifact: withValidStyles((s) => { ((s.effects as Record<string, unknown>[])[0]).lifecycle = { status: 'retired', replacement_id: null }; }) },
  { name: 'effect style binding is malformed', artifact: withValidStyles((s) => { (((s.effects as Record<string, unknown>[])[0]).bindings as unknown[])[0] = null; }) },
  { name: 'root diagnostics not an array', artifact: withRoot((r) => { r.diagnostics = {}; }) },
  { name: 'root statistics not an object', artifact: withRoot((r) => { r.statistics = []; }) },
  { name: 'root tokens not an array', artifact: withRoot((r) => { r.tokens = {}; }) },

  // -- §8.1/§8.2 token record fields --
  { name: 'token is not an object', artifact: withRoot((r) => { (r.tokens as unknown[])[0] = 'garbage'; }) },
  { name: 'token missing id', artifact: withToken((t) => { delete t.id; }) },
  { name: 'token missing collection_id', artifact: withToken((t) => { delete t.collection_id; }) },
  { name: 'token missing name', artifact: withToken((t) => { delete t.name; }) },
  { name: 'token path is empty', artifact: withToken((t) => { t.path = []; }) },
  { name: 'token path has a non-string segment', artifact: withToken((t) => { t.path = ['Background', 1]; }) },
  { name: 'token type outside the token-type vocabulary', artifact: withToken((t) => { t.type = 'colour'; }) },
  { name: 'token missing description', artifact: withToken((t) => { delete t.description; }) },
  { name: 'token scopes not an array', artifact: withToken((t) => { t.scopes = 'x'; }) },
  { name: 'token scopes contain a non-string', artifact: withToken((t) => { t.scopes = ['FRAME_FILL', 1]; }) },
  { name: 'token lifecycle is malformed', artifact: withToken((t) => { t.lifecycle = { status: 'active' }; }) },
  { name: 'token values not an object', artifact: withToken((t) => { t.values = 'x'; }) },

  // -- §9 value kind: not a well-formed discriminated object --
  { name: 'value is a bare string, not an object', artifact: withValue('#ffffff') },
  { name: 'value kind is unrecognized', artifact: withValue({ kind: 'bogus' }) },
  { name: 'literal value missing its typed value', artifact: withValue({ kind: 'literal' }) },
  { name: 'literal typed value is a bare string', artifact: withValue({ kind: 'literal', value: '#ffffff' }) },
  {
    name: 'typed value has an unrecognized type discriminant',
    artifact: withValue({ kind: 'literal', value: { type: 'colour', value: 1 } }),
  },
  {
    name: 'literal typed value disagrees with token.type',
    artifact: withValue({ kind: 'literal', value: { type: 'number', value: 1 } }),
  },
  { name: 'alias value missing its reference', artifact: withValue({ kind: 'alias', resolved: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).resolved }) },
  { name: 'alias value missing its resolved', artifact: withValue({ kind: 'alias', reference: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference }) },
  {
    name: 'alias reference target_path is not an array of strings',
    artifact: withValue({
      kind: 'alias',
      reference: { ...(RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference, target_path: 'not-an-array' },
      resolved: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).resolved,
    }),
  },
  {
    name: 'alias reference external is not a boolean',
    artifact: withValue({
      kind: 'alias',
      reference: { ...(RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference, external: 'no' },
      resolved: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).resolved,
    }),
  },
  {
    name: 'alias resolution status is unrecognized',
    artifact: withValue({
      kind: 'alias',
      reference: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: { status: 'pending', value: null, chain: [] },
    }),
  },
  {
    name: 'resolved alias carries a malformed typed value',
    artifact: withValue({
      kind: 'alias',
      reference: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: { status: 'resolved', value: 'not-a-typed-value', chain: [] },
    }),
  },
  {
    name: 'resolved alias typed value disagrees with token.type',
    artifact: withValue({
      kind: 'alias',
      reference: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: {
        status: 'resolved', value: { type: 'number', value: 1 },
        chain: [{ token_id: 'VariableID:color-teal-500', mode_id: '1:2/light' }],
      },
    }),
  },
  {
    name: 'unresolved alias missing its reason',
    artifact: withValue({
      kind: 'alias',
      reference: (UNRESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: { status: 'unresolved', value: null, chain: [] },
    }),
  },
  {
    name: 'unresolved alias carries a non-null value',
    artifact: withValue({
      kind: 'alias',
      reference: (UNRESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: {
        status: 'unresolved', reason: 'source_library_unavailable',
        value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 }, chain: [],
      },
    }),
  },
  {
    name: 'alias resolution chain step missing mode_id',
    artifact: withValue({
      kind: 'alias',
      reference: (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>).reference,
      resolved: {
        status: 'resolved',
        value: { type: 'number', value: 1 },
        chain: [{ token_id: 'V:x' }],
      },
    }),
  },
  { name: 'missing value has no reason', artifact: withValue({ kind: 'missing' }) },

  // -- §9.5/§9.6 typed value content: well-formed shape, unrepresentable data --
  { name: 'color hex is uppercase', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#FFFFFF', alpha: 1 } }) },
  { name: 'color hex is short', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#fff', alpha: 1 } }) },
  { name: 'color hex is not a color at all', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#colors/blue/200', alpha: 1 } }) },
  { name: 'color alpha is out of range', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1.5 } }) },
  { name: 'color alpha is non-finite', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: Number.NaN } }) },
  { name: 'color color_space is unsupported', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'display-p3', hex: '#006b62', alpha: 1 } }) },
  { name: 'color channels wrong length', artifact: withValue({ kind: 'literal', value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1, channels: [0, 1] } }) },
  { name: 'dimension has no unit', artifact: withValue({ kind: 'literal', value: { type: 'dimension', number: 16 } }) },
  { name: 'dimension unit outside the vocabulary', artifact: withValue({ kind: 'literal', value: { type: 'dimension', number: 16, unit: 'pt' } }) },
  { name: 'dimension number is non-finite', artifact: withValue({ kind: 'literal', value: { type: 'dimension', number: Number.NaN, unit: 'px' } }) },
  { name: 'number value is non-finite', artifact: withValue({ kind: 'literal', value: { type: 'number', value: Number.NaN } }) },
  { name: 'string value is not a string', artifact: withValue({ kind: 'literal', value: { type: 'string', value: 42 } }) },
  { name: 'boolean value is not a boolean', artifact: withValue({ kind: 'literal', value: { type: 'boolean', value: 'true' } }) },
  { name: 'duration unit outside ms/s', artifact: withValue({ kind: 'literal', value: { type: 'duration', number: 200, unit: 'min' } }) },
  { name: 'duration number is non-finite', artifact: withValue({ kind: 'literal', value: { type: 'duration', number: Number.NaN, unit: 'ms' } }) },
  { name: 'cubic_bezier has three components instead of four', artifact: withValue({ kind: 'literal', value: { type: 'cubic_bezier', value: [0, 0, 1] } }) },
  { name: 'cubic_bezier component is non-finite', artifact: withValue({ kind: 'literal', value: { type: 'cubic_bezier', value: [0, 0, 1, Number.NaN] } }) },
  { name: 'font_family value is not a string', artifact: withValue({ kind: 'literal', value: { type: 'font_family', value: 42 } }) },
];

// ---------------------------------------------------------------------------
// Task 8 — validateLevel2 fixtures.
//
// Unlike the mutators above, these return a typed `FoundationArtifactV5`
// (validateLevel2's own parameter type: it only runs once Level 1 has
// already accepted the shape), and each clones `OK_ARTIFACT` with
// `structuredClone` rather than hand-writing a full artifact.
// ---------------------------------------------------------------------------

/** A representative typed value for each token type, for fixtures that only
 *  care that a value is well-formed, not what it says. */
function sampleTypedValue(type: TokenType): TypedValue {
  switch (type) {
    case 'color': return { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 };
    case 'dimension': return { type: 'dimension', number: 16, unit: 'px' };
    case 'number': return { type: 'number', value: 1 };
    case 'string': return { type: 'string', value: 'x' };
    case 'boolean': return { type: 'boolean', value: true };
    case 'duration': return { type: 'duration', number: 200, unit: 'ms' };
    case 'cubic_bezier': return { type: 'cubic_bezier', value: [0, 0, 1, 1] };
    case 'font_family': return { type: 'font_family', value: 'Inter' };
    default: throw new Error(`no sample value for token type: ${type as string}`);
  }
}

/** Replaces the fixture token's light-mode value with an alias whose
 *  reference targets an id that exists nowhere in the artifact. */
export function artifactWithAlias(targetId: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.tokens[0].values['1:2/light'] = {
    kind: 'alias',
    reference: { target_id: targetId, target_collection_id: null, target_path: [], external: false },
    resolved: { status: 'unresolved', reason: 'target_not_found', value: null, chain: [] },
  };
  return root;
}

/** Two new tokens, with the given ids, that alias each other under one mode
 *  of a dedicated collection -- a two-node ring. */
export function artifactWithCycle(idA: string, idB: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const collectionId = 'VariableCollectionId:cycle';
  root.collections.push({
    id: collectionId, name: 'Cycle', path: ['Cycle'],
    default_mode_id: 'm1', modes: [{ id: 'm1', name: 'm1', order: 0 }],
  });
  const aliasTo = (target: string): CanonicalValue => ({
    kind: 'alias',
    reference: { target_id: target, target_collection_id: collectionId, target_path: [target], external: false },
    resolved: { status: 'unresolved', reason: 'cycle', value: null, chain: [] },
  });
  root.tokens.push(
    {
      id: idA, collection_id: collectionId, name: idA, path: [idA], type: 'color',
      description: '', scopes: [], values: { m1: aliasTo(idB) },
    },
    {
      id: idB, collection_id: collectionId, name: idB, path: [idB], type: 'color',
      description: '', scopes: [], values: { m1: aliasTo(idA) },
    },
  );
  return root;
}

/** A new token of `sourceType` that aliases a new token of `targetType`. */
export function artifactWithTypeMismatch(sourceType: TokenType, targetType: TokenType): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const collectionId = 'VariableCollectionId:mismatch';
  root.collections.push({
    id: collectionId, name: 'Mismatch', path: ['Mismatch'],
    default_mode_id: 'm1', modes: [{ id: 'm1', name: 'm1', order: 0 }],
  });
  const targetToken: TokenV5 = {
    id: 'VariableID:mismatch-target', collection_id: collectionId, name: 'Target', path: ['Target'],
    type: targetType, description: '', scopes: [],
    values: { m1: { kind: 'literal', value: sampleTypedValue(targetType) } },
  };
  const sourceToken: TokenV5 = {
    id: 'VariableID:mismatch-source', collection_id: collectionId, name: 'Source', path: ['Source'],
    type: sourceType, description: '', scopes: [],
    values: {
      m1: {
        kind: 'alias',
        reference: {
          target_id: targetToken.id,
          target_collection_id: collectionId,
          target_path: targetToken.path,
          external: false,
        },
        resolved: { status: 'resolved', value: sampleTypedValue(targetType), chain: [{ token_id: targetToken.id, mode_id: 'm1' }] },
      },
    },
  };
  root.tokens.push(targetToken, sourceToken);
  return root;
}

/** Deletes the fixture token's value entry for `modeId` outright -- the
 *  ABSENT case (as opposed to `artifactWithExplicitMissing`, the DECLARED
 *  case). `modeId` must be one of the fixture collection's declared modes. */
export function artifactMissingMode(modeId: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  delete (root.tokens[0].values as Record<string, unknown>)[modeId];
  return root;
}

/** Sets the fixture token's value entry for `modeId` to an explicit
 *  `{kind: 'missing'}` record -- the DECLARED case. */
export function artifactWithExplicitMissing(modeId: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.tokens[0].values[modeId] = { kind: 'missing', reason: 'no_value_for_mode' };
  return root;
}

/** A second token carrying the SAME id as the fixture's one token. */
export function artifactWithDuplicateId(): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const duplicate = structuredClone(root.tokens[0]);
  duplicate.name = 'Duplicate';
  duplicate.path = ['Duplicate'];
  root.tokens.push(duplicate);
  return root;
}

/** Two new tokens sharing one path, filed under `collectionA` and
 *  `collectionB` respectively -- a collision when the two are the same
 *  collection id, and not a collision when they differ. */
export function artifactWithPathCollision(collectionA: string, collectionB: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const path = ['Surface', 'Primary'];
  const value: CanonicalValue = { kind: 'literal', value: sampleTypedValue('color') };
  root.tokens.push(
    {
      id: 'VariableID:collide-a', collection_id: collectionA, name: 'Surface/Primary', path: [...path],
      type: 'color', description: '', scopes: [], values: { '1:2/light': value },
    },
    {
      id: 'VariableID:collide-b', collection_id: collectionB, name: 'Surface/Primary', path: [...path],
      type: 'color', description: '', scopes: [], values: { '1:2/light': value },
    },
  );
  return root;
}

/** Two new tokens in the fixture's own collection whose paths are equal only
 *  after NFC normalization: one precomposed ("Cafe" + U+00E9), one
 *  decomposed ("Cafe" + U+0065 followed by a combining acute accent,
 *  U+0301). The two path literals below LOOK identical but are different
 *  code-unit sequences on disk -- do not "simplify" them to share one
 *  string constant, that would defeat the fixture. */
export function artifactWithDecomposedDuplicate(): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const collectionId = root.collections[0].id;
  const value: CanonicalValue = { kind: 'literal', value: sampleTypedValue('string') };
  const values = { '1:2/light': value, '1:2/dark': value };
  root.tokens.push(
    {
      id: 'VariableID:decomposed-a', collection_id: collectionId, name: 'Cafe (NFC)',
      path: ['Café'], type: 'string', description: '', scopes: [], values,
    },
    {
      id: 'VariableID:decomposed-b', collection_id: collectionId, name: 'Cafe (NFD)',
      path: ['Café'], type: 'string', description: '', scopes: [], values,
    },
  );
  return root;
}

/** The fixture token, refiled under a collection id no collection in the
 *  artifact carries. §18 Level 2 requires collection references to resolve;
 *  before the fix this ALSO suppressed the mode-completeness check for that
 *  token, so a dangling reference removed a check instead of adding a
 *  finding. */
export function artifactWithDanglingCollectionId(): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.tokens[0].collection_id = 'VariableCollectionId:not-here';
  return root;
}

/** A collection whose `default_mode_id` names none of its declared modes —
 *  §7's "The default mode MUST reference a declared mode ID". This is the
 *  shape `normalizeV4` now deliberately emits when v4 states no usable
 *  default, so validation MUST reject it. */
export function artifactWithUndeclaredDefaultMode(): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.collections[0].default_mode_id = '1:2/there-is-no-such-mode';
  return root;
}

/** The fixture token marked deprecated with a `replacement_id` naming no
 *  entity in the artifact. */
export function artifactWithDanglingReplacement(replacementId: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.tokens[0].lifecycle = { status: 'deprecated', replacement_id: replacementId };
  return root;
}

/** An effect style whose binding names a token that is not in the artifact.
 *  Phase 1 emits no styles, so this is hand-built: the check exists now so the
 *  gap cannot reopen when plan 3 starts populating them. */
export function artifactWithDanglingStyleBinding(tokenId: string): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  root.styles.effects.push({
    id: 'EffectStyleId:1', name: 'Card/Shadow', path: ['Card', 'Shadow'],
    mode_id: null, effects: [],
    bindings: [{ property: 'effects[0].offset_y', token_id: tokenId }],
  });
  return root;
}

/** A valid typography style whose font-family property aliases `targetId`.
 *  Level 2 must resolve both that stable id and the recorded target path; token
 *  alias traversal cannot see aliases nested under style properties. */
export function artifactWithTypographyAlias(
  targetId: string | null, targetPath: string[],
): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const literalProperty = (resolved: TypedValue) => ({
    source: { kind: 'literal' as const }, resolved,
  });
  root.styles.typography.push({
    id: 'TypographyStyleId:alias',
    name: 'Heading/Alias',
    path: ['Heading', 'Alias'],
    description: '',
    properties: {
      font_family: {
        source: { kind: 'alias', target_id: targetId, target_path: targetPath },
        resolved: { type: 'font_family', value: 'Inter' },
      },
      font_weight: literalProperty({ type: 'number', value: 700 }),
      font_size: literalProperty({ type: 'dimension', number: 32, unit: 'px' }),
      line_height: literalProperty({ type: 'dimension', number: 40, unit: 'px' }),
      letter_spacing: literalProperty({ type: 'dimension', number: 0, unit: '%' }),
      paragraph_spacing: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
      paragraph_indent: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
      text_case: 'original',
      text_decoration: 'none',
    },
  });
  return root;
}

/** One effect style carrying `modeId`. When `ambiguous` is true, a second
 *  collection declares the same collection-scoped mode id, leaving the style's
 *  unqualified reference with two possible owners. */
export function artifactWithEffectMode(
  modeId: string, ambiguous = false,
): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  if (ambiguous) {
    root.collections.push({
      id: 'VariableCollectionId:second-mode-owner',
      name: 'Second mode owner',
      path: ['Second mode owner'],
      default_mode_id: modeId,
      modes: [{ id: modeId, name: 'same id', order: 0 }],
    });
  }
  root.styles.effects.push({
    id: 'EffectStyleId:mode',
    name: 'Shadow/Mode',
    path: ['Shadow', 'Mode'],
    mode_id: modeId,
    effects: [],
  });
  return root;
}

/**
 * A two-collection alias cycle: token A in collection A aliases token B in
 * collection B, which aliases A back.
 *
 * Mode ids are collection-scoped, so this is the case the walk could not see:
 * holding the current mode id constant across the hop made
 * `targetToken.values[curModeId]` undefined, the hop read as terminal, and the
 * ring was never closed. The SAME ring inside one collection was reported
 * (see `artifactWithCycle`), so cycle detection silently depended on how the
 * designer had arranged their collections.
 */
export function artifactWithCrossCollectionCycle(): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const collA = 'VariableCollectionId:xc-a';
  const collB = 'VariableCollectionId:xc-b';
  root.collections.push(
    {
      id: collA, name: 'XC A', path: ['XC A'],
      default_mode_id: 'xc-a/default',
      modes: [
        { id: 'xc-a/default', name: 'default', order: 0 },
        { id: 'xc-a/only', name: 'only', order: 1 },
      ],
    },
    {
      id: collB, name: 'XC B', path: ['XC B'],
      default_mode_id: 'xc-b/default',
      modes: [
        { id: 'xc-b/default', name: 'default', order: 0 },
        { id: 'xc-b/only', name: 'only', order: 1 },
      ],
    },
  );
  const aliasTo = (
    targetId: string, collectionId: string, targetPath: string[], targetModeId: string,
  ): CanonicalValue => ({
    kind: 'alias',
    reference: {
      target_id: targetId, target_collection_id: collectionId, target_path: targetPath, external: false,
    },
    resolved: {
      status: 'unresolved', reason: 'cycle', value: null,
      chain: [{ token_id: targetId, mode_id: targetModeId }],
    },
  });
  root.tokens.push(
    {
      id: 'V:xc-a', collection_id: collA, name: 'A', path: ['A'], type: 'color',
      description: '', scopes: [],
      values: {
        'xc-a/default': { kind: 'missing', reason: 'no_value_for_mode' },
        'xc-a/only': aliasTo('V:xc-b', collB, ['B'], 'xc-b/only'),
      },
    },
    {
      id: 'V:xc-b', collection_id: collB, name: 'B', path: ['B'], type: 'color',
      description: '', scopes: [],
      values: {
        'xc-b/default': { kind: 'missing', reason: 'no_value_for_mode' },
        'xc-b/only': aliasTo('V:xc-a', collA, ['A'], 'xc-a/only'),
      },
    },
  );
  return root;
}

/** A chain of `length` tokens, each aliasing the next under one mode of a
 *  dedicated collection, terminating in a literal -- long enough to blow a
 *  recursive walk's call stack, and to make an O(n^2) resolution slow. */
export function artifactWithChainOfLength(length: number): FoundationArtifactV5 {
  const root = structuredClone(OK_ARTIFACT);
  const collectionId = 'VariableCollectionId:chain';
  root.collections.push({
    id: collectionId, name: 'Chain', path: ['Chain'],
    default_mode_id: 'm1', modes: [{ id: 'm1', name: 'm1', order: 0 }],
  });
  const ids = Array.from({ length }, (_, i) => `VariableID:chain-${i}`);
  const tokens: TokenV5[] = ids.map((id, i) => {
    const isLast = i === length - 1;
    const value: CanonicalValue = isLast
      ? { kind: 'literal', value: sampleTypedValue('number') }
      : {
          kind: 'alias',
          reference: {
            target_id: ids[i + 1], target_collection_id: collectionId,
            target_path: [ids[i + 1]], external: false,
          },
          resolved: {
            status: 'resolved', value: sampleTypedValue('number'),
            chain: [{ token_id: ids[i + 1], mode_id: 'm1' }],
          },
        };
    return {
      id, collection_id: collectionId, name: id, path: [id], type: 'number',
      description: '', scopes: [], values: { m1: value },
    };
  });
  root.tokens.push(...tokens);
  return root;
}

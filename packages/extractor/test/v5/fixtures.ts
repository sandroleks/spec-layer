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
import type { CanonicalValue, TypedValue } from '../../src/v5/value';
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

// ---------------------------------------------------------------------------
// VALID_CASES — one per SUPPORTED_TOKEN_TYPES member, plus the non-literal
// value kinds (alias, resolved and unresolved; missing).
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
  { name: 'dimension token', artifact: withTokenOfType('dimension', { type: 'dimension', number: 16, unit: 'px' }) },
  { name: 'number token', artifact: withTokenOfType('number', { type: 'number', value: 400 }) },
  { name: 'string token', artifact: withTokenOfType('string', { type: 'string', value: 'Inter' }) },
  { name: 'boolean token', artifact: withTokenOfType('boolean', { type: 'boolean', value: true }) },
  { name: 'duration token', artifact: withTokenOfType('duration', { type: 'duration', number: 200, unit: 'ms' }) },
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
  { name: 'root styles.typography not an array', artifact: withRoot((r) => { (r.styles as Record<string, unknown>).typography = 'x'; }) },
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

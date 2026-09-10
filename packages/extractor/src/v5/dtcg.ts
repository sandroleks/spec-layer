/**
 * DTCG projection of a Foundation Context v5 artifact. Spec:
 * docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md.
 *
 * Design Tokens Format Module 2025.10 and Resolver Module 2025.10. This is a
 * presentation profile over a validated artifact, like aiContext.ts: it never
 * feeds a hash, never mutates its input, and anything the format cannot state
 * is omitted and written to the report rather than approximated.
 */
import { sha256 } from 'js-sha256';
import { SCHEMA_VERSION, type FoundationArtifactV5, canonicalJson } from './canonical';
import { compareCodeUnits } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, EffectV5, StyleProperty, TokenV5, TypographyStyleV5,
} from './entities';
import { canonicalNumber } from './precision';
import type { ColorValue, DimensionValue, ResolutionStep, TypedValue } from './value';

export type DtcgValueStyle = 'standard' | 'legacy';
export interface DtcgOptions {
  /** `standard` is the 2025.10 object form; `legacy` is the pre-2025 string form. */
  values?: DtcgValueStyle;
  /** `"Collection/name glob": unit` overrides for numbers whose scopes state no unit. */
  units?: Record<string, 'px' | 'rem'>;
}

export type DtcgJson = string | number | boolean | null | DtcgJson[] | { [key: string]: DtcgJson };
export type DtcgTree = { [key: string]: DtcgJson };

export type DtcgReportCode =
  | 'segment_split' | 'name_escaped' | 'path_collision' | 'type_not_expressible'
  | 'unit_not_expressible' | 'unit_override_conflicts_with_scope'
  | 'mode_selection_not_expressible' | 'value_omitted' | 'effect_not_expressible'
  | 'duplicate_code_syntax' | 'collection_name_collision' | 'binding_dropped';

export interface DtcgReportEntry {
  code: DtcgReportCode;
  severity: 'error' | 'warning' | 'info';
  /** DTCG path, collection first, dot-joined. */
  path: string;
  mode?: string;
  message: string;
  details: Record<string, DtcgJson>;
}

/** The rule that produced a token's `$value` in one mode. */
export type DtcgTransform =
  | 'alias' | 'color' | 'dimension' | 'duration' | 'number'
  | 'font-weight' | 'cubic-bezier' | 'font-family' | 'number-unit-override';

export interface DtcgMetaEntry {
  id: string;
  collection_id: string;
  type: string;
  scopes: string[];
  code_syntax?: Record<string, string>;
  publication?: { published: boolean; hidden_from_publishing: boolean };
  omitted?: true;
  /** Canonical values by mode label, only for omitted tokens. */
  values?: Record<string, DtcgJson>;
  /** The rule behind `$value` in each mode, by mode label. Keyed by mode
   *  because Figma lets one token alias in one mode and hold a literal in
   *  another, so a single name would misreport the other mode. Absent for a
   *  token this projection omitted. */
  transform?: Record<string, DtcgTransform>;
  /** The DTCG value an alias resolves to in each mode, by mode label. Taken
   *  from the same chain walk that produced the reference, never derived a
   *  second time. Absent for a literal token, whose value is already in the
   *  file. */
  resolved?: Record<string, DtcgJson>;
}

export interface DtcgResolverDocument {
  version: '2025.10';
  name?: string;
  sets: Record<string, { sources: DtcgJson[] }>;
  modifiers: Record<string, { contexts: Record<string, DtcgJson[]>; default?: string }>;
  resolutionOrder: Array<{ $ref: string }>;
}

export interface DtcgExport {
  files: Record<string, DtcgTree>;
  resolver: DtcgResolverDocument;
  meta: Record<string, DtcgMetaEntry>;
  report: DtcgReportEntry[];
  /** The `com.spec-layer` block. Built once here so `resolver.json` on disk
   *  and the clipboard document can never carry different bytes. */
  extension: DtcgDocumentExtension;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface SegmentNote { code: 'segment_split' | 'name_escaped'; original: string }

/**
 * Figma name -> DTCG group segments. `/` groups, as `path` does. A `.` inside
 * a segment splits it further, because DTCG reserves `.` for references and an
 * underscore would flatten a hierarchy the author meant. `{`, `}`, a leading
 * `$`, and an empty segment are escaped and noted.
 */
export function dtcgSegments(name: string): { segments: string[]; notes: SegmentNote[] } {
  const segments: string[] = [];
  const notes: SegmentNote[] = [];
  for (const raw of name.split('/')) {
    const parts = raw.includes('.') ? raw.split('.') : [raw];
    if (parts.length > 1) notes.push({ code: 'segment_split', original: raw });
    for (const part of parts) {
      let out = part;
      if (out === '') out = '_';
      if (/[{}]/.test(out)) out = out.replace(/[{}]/g, '_');
      if (out.startsWith('$')) out = `_${out}`;
      if (out !== part) notes.push({ code: 'name_escaped', original: part });
      segments.push(out);
    }
  }
  return { segments, notes };
}

export function dtcgPathOf(collectionName: string, tokenName: string): string {
  return [...dtcgSegments(collectionName).segments, ...dtcgSegments(tokenName).segments].join('.');
}

/**
 * The file-name slug the DTCG record and the CSS output share: lowercase,
 * every run outside a-z0-9 becomes `-`, ends trimmed, `unnamed` when nothing
 * is left. Exported so the CSS projection names its files by the same rule.
 */
/** Removes leading and trailing `-` without a backtracking regex; the input is a Figma name. */
function trimDashes(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '-') start += 1;
  while (end > start && s[end - 1] === '-') end -= 1;
  return s.slice(start, end);
}

export const dtcgSlug = (s: string): string =>
  trimDashes(s.toLowerCase().replace(/[^a-z0-9]+/g, '-')) || 'unnamed';
const slug = dtcgSlug;

/** The names the export writes itself. A collection file must never land on
 *  one of them: a collection named "Styles" with a mode "Typography" would
 *  otherwise overwrite the typography style file. */
const RESERVED_FILE_NAMES: readonly string[] = [
  'styles.typography.json', 'styles.effects.json',
  'resolver.json', 'spec-layer.meta.json', 'report.json',
];

/** `<collection>.<mode>.json`, with `-2`, `-3` on a slug collision with an
 *  already taken or reserved name. */
export function fileNameFor(
  collection: { name: string }, mode: { name: string }, taken: Set<string>,
): string {
  const base = `${slug(collection.name)}.${slug(mode.name)}`;
  let candidate = `${base}.json`;
  let n = 1;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}.json`;
  }
  taken.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function hexByte(n: number): string {
  return Math.round(n * 255).toString(16).padStart(2, '0');
}

function colorComponents(color: ColorValue): [number, number, number] {
  if (color.channels) return [color.channels[0], color.channels[1], color.channels[2]];
  const at = (i: number) => canonicalNumber(parseInt(color.hex.slice(i, i + 2), 16) / 255);
  return [at(1), at(3), at(5)];
}

export interface DtcgTyped { $type: string; $value: DtcgJson }
export type Converted =
  | DtcgTyped
  | { omit: 'type_not_expressible' | 'unit_not_expressible'; details: Record<string, DtcgJson> };

/**
 * One typed literal. `fontWeight` is chosen only by the FONT_WEIGHT scope, not
 * the name: units.ts already made the name inadmissible as evidence and this
 * module keeps that rule.
 */
export function dtcgLiteral(
  value: TypedValue, scopes: string[], style: DtcgValueStyle,
): Converted {
  switch (value.type) {
    case 'color': {
      if (style === 'legacy') {
        const alpha = value.alpha === 1 ? '' : hexByte(value.alpha);
        return { $type: 'color', $value: `${value.hex}${alpha}` };
      }
      return {
        $type: 'color',
        $value: {
          colorSpace: 'srgb', components: colorComponents(value), alpha: value.alpha, hex: value.hex,
        },
      };
    }
    case 'dimension': {
      if (value.unit !== 'px' && value.unit !== 'rem') {
        return { omit: 'unit_not_expressible', details: { unit: value.unit, number: value.number } };
      }
      return {
        $type: 'dimension',
        $value: style === 'legacy' ? `${value.number}${value.unit}` : { value: value.number, unit: value.unit },
      };
    }
    case 'duration':
      return {
        $type: 'duration',
        $value: style === 'legacy' ? `${value.number}${value.unit}` : { value: value.number, unit: value.unit },
      };
    case 'number':
      return { $type: scopes.includes('FONT_WEIGHT') ? 'fontWeight' : 'number', $value: value.value };
    case 'cubic_bezier':
      return { $type: 'cubicBezier', $value: [...value.value] };
    case 'font_family':
      return { $type: 'fontFamily', $value: value.value };
    case 'string':
    case 'boolean':
      return { omit: 'type_not_expressible', details: { type: value.type } };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function setLeaf(tree: DtcgTree, segments: string[], leaf: DtcgJson): void {
  let node: DtcgTree = tree;
  for (const seg of segments.slice(0, -1)) {
    const next = node[seg];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[seg] = {};
    node = node[seg] as DtcgTree;
  }
  node[segments[segments.length - 1]] = leaf;
}

/** Recursively sorts keys by code unit, keeping `$`-keys first in a fixed order. */
const KEY_ORDER = ['$type', '$value', '$description', '$deprecated', '$extensions'];
export function sortTree(value: DtcgJson): DtcgJson {
  if (Array.isArray(value)) return value.map(sortTree);
  if (typeof value !== 'object' || value === null) return value;
  const rank = (k: string) => { const i = KEY_ORDER.indexOf(k); return i === -1 ? KEY_ORDER.length : i; };
  const keys = Object.keys(value).sort((a, b) => rank(a) - rank(b) || compareCodeUnits(a, b));
  return Object.fromEntries(keys.map((k) => [k, sortTree(value[k])]));
}

interface Projection {
  artifact: FoundationArtifactV5;
  options: { values: DtcgValueStyle; units?: Record<string, 'px' | 'rem'> };
  tokenById: Map<string, TokenV5>;
  /** Every token id in the artifact, regardless of whether the projection
   *  carried it through. Distinguishes a binding to a token this export never
   *  had (`target_unavailable`) from one it omitted (`target_omitted`). */
  tokenIds: Set<string>;
  collectionById: Map<string, CollectionV5>;
  /** collection id -> resolver label: the name alone, or name plus id when a
   *  name repeats. Figma allows two collections to share a display name. */
  collectionLabelById: Map<string, string>;
  /** collection id -> mode id -> resolver context label. */
  modeLabelsById: Map<string, Map<string, string>>;
  /** token id -> dot-joined DTCG path, for every token that survived collision. */
  pathById: Map<string, string>;
  /** token id -> segments including the collection head. */
  segmentsById: Map<string, string[]>;
  omittedIds: Set<string>;
  /** The subset of `omittedIds` dropped because two tokens reached one DTCG
   *  path. Their sidecar keys carry the token id, since the path does not
   *  identify them. */
  collidedIds: Set<string>;
  report: DtcgReportEntry[];
  /** Serialized identity of every entry already in `report`, so the dedupe
   *  below stays O(1) per call instead of re-serializing the whole report. */
  reportKeys: Set<string>;
  /** token id -> what the leaf builder did, gathered where the leaf is built
   *  so the sidecar reports the projection rather than re-deriving it. */
  factsById: Map<string, LeafFacts>;
}

export interface LeafFacts {
  transform: Record<string, DtcgTransform>;
  resolved: Record<string, DtcgJson>;
}

function recordFact(
  p: Projection, tokenId: string, mode: string, transform: DtcgTransform, resolved?: DtcgJson,
): void {
  let facts = p.factsById.get(tokenId);
  if (!facts) {
    facts = { transform: {}, resolved: {} };
    p.factsById.set(tokenId, facts);
  }
  facts.transform[mode] = transform;
  if (resolved !== undefined) facts.resolved[mode] = resolved;
}

function reportOnce(p: Projection, entry: DtcgReportEntry): void {
  const key = JSON.stringify([entry.code, entry.path, entry.mode ?? null, entry.details]);
  if (p.reportKeys.has(key)) return;
  p.reportKeys.add(key);
  p.report.push(entry);
}

/** Resolves every token's DTCG path and drops both sides of a collision. */
function indexPaths(p: Projection): void {
  const owners = new Map<string, TokenV5[]>();
  for (const token of p.artifact.tokens) {
    const collection = p.collectionById.get(token.collection_id);
    if (!collection) continue;
    const head = dtcgSegments(collection.name);
    const tail = dtcgSegments(token.name);
    const segments = [...head.segments, ...tail.segments];
    const path = segments.join('.');
    p.segmentsById.set(token.id, segments);
    for (const note of [...head.notes, ...tail.notes]) {
      reportOnce(p, {
        code: note.code, severity: note.code === 'segment_split' ? 'info' : 'warning', path,
        message: note.code === 'segment_split'
          ? `The segment "${note.original}" contains "." and was split into nested groups.`
          : `The segment "${note.original}" contains a character DTCG forbids and was escaped.`,
        details: { id: token.id, original: note.original },
      });
    }
    owners.set(path, [...(owners.get(path) ?? []), token]);
  }
  for (const [path, tokens] of owners) {
    if (tokens.length === 1) {
      p.pathById.set(tokens[0].id, path);
      continue;
    }
    for (const token of tokens) {
      p.omittedIds.add(token.id);
      p.collidedIds.add(token.id);
      reportOnce(p, {
        code: 'path_collision', severity: 'error', path,
        message: `${tokens.length} tokens share this DTCG path after escaping; all were omitted.`,
        details: { id: token.id, ids: tokens.map((t) => t.id) },
      });
    }
  }
}

function modeName(collection: CollectionV5, modeId: string): string {
  return collection.modes.find((m) => m.id === modeId)?.name ?? modeId;
}

/** `Collection/glob` -> matcher over a token's Figma name within that collection. */
function unitOverrideFor(p: Projection, token: TokenV5, collection: CollectionV5): 'px' | 'rem' | undefined {
  const units = p.options.units;
  if (!units) return undefined;
  for (const key of Object.keys(units).sort(compareCodeUnits)) {
    const slash = key.indexOf('/');
    if (slash === -1 || key.slice(0, slash) !== collection.name) continue;
    const glob = key.slice(slash + 1);
    const escaped = glob.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp(`^${escaped}$`).test(token.name)) return units[key];
  }
  return undefined;
}

const STATED_NUMBER_SCOPES = ['FONT_WEIGHT', 'OPACITY'];

/**
 * The typed leaf one token's own value projects to: a declared unit override
 * and the scopes that pin a number are the TOKEN's, not the reader's. Shared by
 * the literal branch and the alias branch of `tokenLeaf` so the two can never
 * disagree about a `$type`. `onOverrideConflict` fires only when the caller
 * owns the token, since an override that contradicts a scope is reported once
 * against the token it names, not against everything that aliases it.
 */
export interface Projected { converted: Converted; transform: DtcgTransform | null }

function projectedLiteral(
  p: Projection, token: TokenV5, resolved: TypedValue,
  onOverrideConflict?: (override: 'px' | 'rem') => void,
): Projected {
  const collection = p.collectionById.get(token.collection_id);
  const override = collection ? unitOverrideFor(p, token, collection) : undefined;
  let literal: TypedValue = resolved;
  let overrode = false;
  if (override !== undefined && literal.type === 'number') {
    if (token.scopes.some((s) => STATED_NUMBER_SCOPES.includes(s))) onOverrideConflict?.(override);
    else {
      literal = { type: 'dimension', number: literal.value, unit: override };
      overrode = true;
    }
  }
  const converted = dtcgLiteral(literal, token.scopes, p.options.values);
  if ('omit' in converted) return { converted, transform: null };
  return {
    converted,
    transform: overrode ? 'number-unit-override' : literalTransform(literal, token.scopes),
  };
}

/** The transform name for a literal DTCG could state. `string` and `boolean`
 *  never reach here: `dtcgLiteral` omits them, and the caller returns early. */
function literalTransform(value: TypedValue, scopes: string[]): DtcgTransform | null {
  switch (value.type) {
    case 'color': return 'color';
    case 'dimension': return 'dimension';
    case 'duration': return 'duration';
    case 'number': return scopes.includes('FONT_WEIGHT') ? 'font-weight' : 'number';
    case 'cubic_bezier': return 'cubic-bezier';
    case 'font_family': return 'font-family';
    case 'string':
    case 'boolean': return null;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

/**
 * The `$type` an alias leaf carries. DTCG requires a referencing token's type
 * to equal the referenced token's, and the referenced token's type is decided
 * by ITS override and scopes. Following the chain to its last hop gives the
 * same answer as asking the direct target for its own projected type, hop by
 * hop, and terminates on the token that actually holds the literal.
 */
function aliasLeafType(
  p: Projection, token: TokenV5, chain: readonly ResolutionStep[], resolved: TypedValue,
): Converted {
  const terminal = chain.length > 0 ? p.tokenById.get(chain[chain.length - 1].token_id) : undefined;
  return projectedLiteral(p, terminal ?? token, resolved).converted;
}

/** Mode labels unique within a collection: the name alone, or name plus id when a name repeats. */
function modeLabels(collection: CollectionV5): Map<string, string> {
  const counts = new Map<string, number>();
  for (const m of collection.modes) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  return new Map(collection.modes.map((m) => [m.id, counts.get(m.name) === 1 ? m.name : `${m.name} [${m.id}]`]));
}

/** Collection labels unique across the artifact, by the same rule as modes.
 *  Two Figma collections may share a display name, and keying the resolver by
 *  the bare name would drop one of them. */
function collectionLabels(collections: CollectionV5[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of collections) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return new Map(collections.map(
    (c) => [c.id, counts.get(c.name) === 1 ? c.name : `${c.name} [${c.id}]`],
  ));
}

/** The resolver context label for one mode, from the cache built per collection. */
function modeLabelOf(p: Projection, collection: CollectionV5, modeId: string): string {
  return p.modeLabelsById.get(collection.id)?.get(modeId) ?? modeId;
}

const collectionLabelOf = (p: Projection, collection: CollectionV5): string =>
  p.collectionLabelById.get(collection.id) ?? collection.name;

function reportCollectionNameCollisions(p: Projection): void {
  const owners = new Map<string, CollectionV5[]>();
  for (const collection of p.artifact.collections) {
    owners.set(collection.name, [...(owners.get(collection.name) ?? []), collection]);
  }
  for (const [name, collections] of owners) {
    if (collections.length < 2) continue;
    for (const collection of collections) {
      reportOnce(p, {
        code: 'collection_name_collision', severity: 'warning',
        path: collectionLabelOf(p, collection),
        message: `${collections.length} collections are named "${name}"; the resolver labels each one by its id.`,
        details: { id: collection.id, ids: collections.map((c) => c.id) },
      });
    }
  }
}

function asJson(value: unknown): DtcgJson {
  return JSON.parse(JSON.stringify(value)) as DtcgJson;
}

/** `transform` and `resolved` for one token, each sorted by mode label, and
 *  each absent rather than empty when the projection has nothing to report. */
function transformField(
  p: Projection, token: TokenV5,
): { transform?: Record<string, DtcgTransform>; resolved?: Record<string, DtcgJson> } {
  const facts = p.factsById.get(token.id);
  if (!facts) return {};
  const sorted = <T>(source: Record<string, T>): Record<string, T> | undefined => {
    const keys = Object.keys(source).sort(compareCodeUnits);
    return keys.length === 0 ? undefined : Object.fromEntries(keys.map((k) => [k, source[k]]));
  };
  const transform = sorted(facts.transform);
  const resolved = sorted(facts.resolved);
  return { ...(transform ? { transform } : {}), ...(resolved ? { resolved } : {}) };
}

function metaEntry(p: Projection, token: TokenV5, collection: CollectionV5): DtcgMetaEntry {
  const labels = p.modeLabelsById.get(collection.id) ?? modeLabels(collection);
  const omitted = p.omittedIds.has(token.id);
  const plain = (v: TokenV5['values'][string]): DtcgJson => {
    if (v.kind === 'literal' && (v.value.type === 'boolean' || v.value.type === 'string'
      || v.value.type === 'number' || v.value.type === 'font_family')) return v.value.value;
    return asJson(v);
  };
  return {
    id: token.id,
    collection_id: token.collection_id,
    type: token.type,
    scopes: [...token.scopes],
    ...(omitted ? {} : transformField(p, token)),
    ...(token.code_syntax ? { code_syntax: token.code_syntax } : {}),
    ...(token.publication ? { publication: token.publication } : {}),
    ...(omitted
      ? {
          omitted: true,
          values: Object.fromEntries(Object.entries(token.values)
            .map(([modeId, v]) => [labels.get(modeId) ?? modeId, plain(v)])),
        }
      : {}),
  };
}

function reportDuplicateCodeSyntax(p: Projection): void {
  const owners = new Map<string, TokenV5[]>();
  for (const token of p.artifact.tokens) {
    for (const [platform, identifier] of Object.entries(token.code_syntax ?? {})) {
      const key = JSON.stringify([platform, identifier]);
      owners.set(key, [...(owners.get(key) ?? []), token]);
    }
  }
  for (const [key, tokens] of owners) {
    if (tokens.length < 2) continue;
    const [platform, identifier] = JSON.parse(key) as [string, string];
    for (const token of tokens) {
      reportOnce(p, {
        code: 'duplicate_code_syntax', severity: 'warning',
        path: p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name,
        message: `${tokens.length} tokens declare the ${platform} identifier "${identifier}".`,
        details: { id: token.id, platform, identifier, ids: tokens.map((t) => t.id) },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SPEC_LAYER_EXT = 'com.spec-layer';

/** A binding whose target this export does not carry: the resolved literal is
 *  written instead. `target_omitted` when the artifact holds the token and the
 *  projection dropped it, `target_unavailable` when the artifact never had it. */
function reportBindingDropped(
  p: Projection, path: string, property: string, targetId: string,
): void {
  reportOnce(p, {
    code: 'binding_dropped', severity: 'warning', path,
    message: `The ${property} property is bound to a token this export does not carry; the resolved literal is written instead.`,
    details: {
      property, target_id: targetId,
      reason: p.tokenIds.has(targetId) ? 'target_omitted' : 'target_unavailable',
    },
  });
}

/** A style property as a DTCG composite member: a reference when bound to a
 *  surviving token, else the converted literal; `null` when nothing truthful fits. */
function styleMember(
  p: Projection, property: StyleProperty, scopes: string[], path: string, name: string,
): { value: DtcgJson } | { extension: DtcgJson } | null {
  if (property.source.kind === 'alias' && property.source.target_id !== null) {
    const targetId = property.source.target_id;
    const target = p.omittedIds.has(targetId) ? undefined : p.pathById.get(targetId);
    if (target !== undefined) return { value: `{${target}}` };
    reportBindingDropped(p, path, name, targetId);
  }
  if (property.resolved === null) {
    reportOnce(p, {
      code: 'value_omitted', severity: 'warning', path,
      message: `The ${name} property has no resolved value and was omitted.`,
      details: { property: name, reason: 'source_unavailable' },
    });
    return null;
  }
  const converted = dtcgLiteral(property.resolved, scopes, p.options.values);
  if ('omit' in converted) {
    if (converted.omit === 'unit_not_expressible') {
      reportOnce(p, {
        code: 'unit_not_expressible', severity: 'info', path,
        message: `The ${name} unit is not a DTCG dimension unit; the value is kept under $extensions.`,
        details: { property: name, ...converted.details },
      });
      const d = property.resolved as DimensionValue;
      return { extension: { value: d.number, unit: d.unit } };
    }
    reportOnce(p, {
      code: 'type_not_expressible', severity: 'warning', path,
      message: `The ${name} property has a type DTCG cannot state and was omitted.`,
      details: { property: name, ...converted.details },
    });
    return null;
  }
  return { value: converted.$value };
}

type TypographyKey = 'font_family' | 'font_size' | 'font_weight' | 'line_height'
  | 'letter_spacing' | 'paragraph_spacing' | 'paragraph_indent';
const TYPOGRAPHY_MEMBERS: Array<[TypographyKey, string, string[]]> = [
  ['font_family', 'fontFamily', []],
  ['font_size', 'fontSize', []],
  ['font_weight', 'fontWeight', ['FONT_WEIGHT']],
  ['line_height', 'lineHeight', []],
  ['letter_spacing', 'letterSpacing', []],
];
const TYPOGRAPHY_EXTENSION_MEMBERS: Array<[TypographyKey, string]> = [
  ['paragraph_spacing', 'paragraphSpacing'],
  ['paragraph_indent', 'paragraphIndent'],
];

function typographyLeaf(p: Projection, style: TypographyStyleV5, path: string): DtcgTree {
  const value: DtcgTree = {};
  const ext: DtcgTree = {};
  for (const [key, name, scopes] of TYPOGRAPHY_MEMBERS) {
    const property = style.properties[key];
    // The stable format states that `lineHeight` MUST be a number or a
    // reference to a number token, read as a multiplier of the font size. A
    // measured px line height is not that, and dividing it by the font size
    // would derive a figure Figma never stated, so it is kept verbatim under
    // $extensions. This holds for a binding too: the target's own $type is
    // `dimension`, which `lineHeight` does not accept. A measured percent IS
    // that multiplier already (140% of the font size is 1.4x it), so a
    // literal percent, or one bound to a token this export does not carry, is
    // divided by 100 and written straight into $value instead.
    if (key === 'line_height' && property.resolved?.type === 'dimension') {
      const boundTo = property.source.kind === 'alias' ? property.source.target_id : null;
      let targetExported = false;
      if (property.resolved.unit === '%' && boundTo !== null) {
        targetExported = !p.omittedIds.has(boundTo) && p.pathById.get(boundTo) !== undefined;
        if (!targetExported) reportBindingDropped(p, path, name, boundTo);
      }
      if (property.resolved.unit === '%' && !targetExported) {
        value[name] = canonicalNumber(property.resolved.number / 100);
        continue;
      }
      reportOnce(p, {
        code: 'unit_not_expressible', severity: 'info', path,
        message: 'DTCG line height is a unitless multiplier of the font size; the measured value is kept under $extensions.',
        // The binding is replaced by a literal here, so the entry names the
        // target it stood for; without it a consumer cannot tell this value
        // was bound at all.
        details: {
          property: name, unit: property.resolved.unit, number: property.resolved.number,
          ...(boundTo !== null ? { target_id: boundTo } : {}),
        },
      });
      ext[name] = { value: property.resolved.number, unit: property.resolved.unit };
      continue;
    }
    const member = styleMember(p, property, scopes, path, name);
    if (member === null) continue;
    if ('value' in member) value[name] = member.value;
    else ext[name] = member.extension;
  }
  for (const [key, name] of TYPOGRAPHY_EXTENSION_MEMBERS) {
    const member = styleMember(p, style.properties[key], [], path, name);
    if (member === null) continue;
    ext[name] = 'value' in member ? member.value : member.extension;
  }
  ext.textCase = style.properties.text_case;
  ext.textDecoration = style.properties.text_decoration;
  return {
    $type: 'typography',
    $value: value,
    ...(style.description.length > 0 ? { $description: style.description } : {}),
    $extensions: { [SPEC_LAYER_EXT]: ext },
  };
}

type ShadowKey = 'color' | 'offset_x' | 'offset_y' | 'blur' | 'spread';
const SHADOW_FIELDS: Array<[ShadowKey, string]> = [
  ['color', 'color'], ['offset_x', 'offsetX'], ['offset_y', 'offsetY'], ['blur', 'blur'], ['spread', 'spread'],
];

function effectLeaf(p: Projection, style: EffectStyleV5, path: string): DtcgTree {
  const bindings = new Map((style.bindings ?? []).map((b) => [b.property, b.token_id]));
  const shadows: DtcgJson[] = [];
  const layers: DtcgJson[] = [];
  style.effects.forEach((effect: EffectV5, index) => {
    const isShadow = effect.type === 'drop_shadow' || effect.type === 'inner_shadow';
    const layer: DtcgTree = { index, type: effect.type, visible: effect.visible };
    if (effect.blend_mode !== undefined) layer.blend_mode = effect.blend_mode;
    if (!isShadow && effect.blur) {
      const b = dtcgLiteral(effect.blur, [], p.options.values);
      if (!('omit' in b)) layer.blur = b.$value;
    }
    layers.push(layer);
    if (!isShadow || !effect.visible) return;
    const shadow: DtcgTree = {};
    for (const [field, name] of SHADOW_FIELDS) {
      const boundId = bindings.get(`effects[${index}].${field}`);
      const boundPath = boundId !== undefined && !p.omittedIds.has(boundId) ? p.pathById.get(boundId) : undefined;
      if (boundPath !== undefined) {
        shadow[name] = `{${boundPath}}`;
        continue;
      }
      if (boundId !== undefined) {
        reportBindingDropped(p, path, `effects[${index}].${field}`, boundId);
      }
      const raw = effect[field] as TypedValue | undefined;
      if (raw === undefined) continue;
      const converted = dtcgLiteral(raw, [], p.options.values);
      if (!('omit' in converted)) shadow[name] = converted.$value;
    }
    shadow.inset = effect.type === 'inner_shadow';
    shadows.push(shadow);
  });
  if (shadows.length === 0) {
    reportOnce(p, {
      code: 'effect_not_expressible', severity: 'warning', path,
      message: 'The style has no visible shadow; DTCG has no blur type, so it is kept only under $extensions.',
      details: { id: style.id },
    });
  }
  return {
    $type: 'shadow',
    $value: shadows,
    $extensions: { [SPEC_LAYER_EXT]: { layers } },
  };
}

function styleFiles(p: Projection): Record<string, DtcgTree> {
  const files: Record<string, DtcgTree> = {};
  const build = <T extends { id: string; name: string }>(
    styles: T[], root: string, file: string, leafOf: (style: T, path: string) => DtcgTree,
  ) => {
    if (styles.length === 0) return;
    const tree: DtcgTree = {};
    const seen = new Map<string, string>();
    for (const style of styles) {
      const segments = [root, ...dtcgSegments(style.name).segments];
      const path = segments.join('.');
      const other = seen.get(path);
      if (other !== undefined) {
        reportOnce(p, {
          code: 'path_collision', severity: 'error', path,
          message: 'Two styles share this DTCG path after escaping; the later one was omitted.',
          details: { id: style.id, ids: [other, style.id] },
        });
        continue;
      }
      seen.set(path, style.id);
      setLeaf(tree, segments, leafOf(style, path));
    }
    files[file] = sortTree(tree) as DtcgTree;
  };
  build(p.artifact.styles.typography, 'Typography styles', 'styles.typography.json',
    (s, path) => typographyLeaf(p, s, path));
  build(p.artifact.styles.effects, 'Effect styles', 'styles.effects.json',
    (s, path) => effectLeaf(p, s, path));
  return files;
}

const pointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

interface FilePlan { collection: CollectionV5; modeId: string; file: string }

const STYLE_ROOTS: Record<string, string> = {
  'styles.typography.json': 'Typography styles',
  'styles.effects.json': 'Effect styles',
};

function buildResolver(p: Projection, plans: FilePlan[], styleFileNames: string[]): DtcgResolverDocument {
  const sets: DtcgResolverDocument['sets'] = {};
  const modifiers: DtcgResolverDocument['modifiers'] = {};
  const order: Array<{ $ref: string }> = [];
  for (const collection of p.artifact.collections) {
    const own = plans.filter((f) => f.collection.id === collection.id);
    if (own.length === 0) continue;
    const labels = p.modeLabelsById.get(collection.id) ?? modeLabels(collection);
    const label = collectionLabelOf(p, collection);
    if (own.length === 1) {
      sets[label] = { sources: [{ $ref: own[0].file }] };
      order.push({ $ref: `#/sets/${pointer(label)}` });
      continue;
    }
    const contexts: Record<string, DtcgJson[]> = {};
    for (const plan of own) contexts[labels.get(plan.modeId) ?? plan.modeId] = [{ $ref: plan.file }];
    const def = labels.get(collection.default_mode_id);
    modifiers[label] = { contexts, ...(def !== undefined ? { default: def } : {}) };
    order.push({ $ref: `#/modifiers/${pointer(label)}` });
  }
  for (const file of styleFileNames) {
    const root = STYLE_ROOTS[file];
    sets[root] = { sources: [{ $ref: file }] };
    order.push({ $ref: `#/sets/${pointer(root)}` });
  }
  const fileName = p.artifact.spec_layer.source.file_name;
  return {
    version: '2025.10',
    ...(typeof fileName === 'string' && fileName.length > 0 ? { name: fileName } : {}),
    sets, modifiers, resolutionOrder: order,
  };
}

/** Generated group descriptions become `$description` on the group they name. */
function annotateGroups(p: Projection, tree: DtcgTree, collection: CollectionV5): void {
  const groups = p.artifact.guidelines?.group_descriptions[collection.name];
  if (!groups) return;
  const head = dtcgSegments(collection.name).segments;
  folders: for (const [folder, text] of Object.entries(groups)) {
    if (text.length === 0) continue;
    let node: DtcgJson | undefined = tree;
    for (const seg of [...head, ...dtcgSegments(folder).segments]) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) continue folders;
      node = node[seg];
    }
    if (typeof node === 'object' && node !== null && !Array.isArray(node) && !('$value' in node)) {
      node.$description = text;
    }
  }
}

interface CensusAccumulator {
  tokens: number;
  types: Map<string, number>;
  present: number;
  missing: number;
  aliases: number;
  literals: number;
  scopes: Map<string, number>;
  codeSyntaxPresent: number;
  codeSyntaxMissing: number;
  published: number;
  hiddenFromPublishing: number;
  omitted: number;
  collided: number;
}

const newAccumulator = (): CensusAccumulator => ({
  tokens: 0, types: new Map(), present: 0, missing: 0, aliases: 0, literals: 0,
  scopes: new Map(), codeSyntaxPresent: 0, codeSyntaxMissing: 0,
  published: 0, hiddenFromPublishing: 0, omitted: 0, collided: 0,
});

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** A counted map as a plain object in code-unit key order. */
const histogram = (counts: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...counts.keys()].sort(compareCodeUnits).map((k) => [k, counts.get(k) as number]));

/** One accumulator as the entry it describes. A count that would be zero for a
 *  reason the projection cannot state is omitted, never written as zero. */
function censusEntry(a: CensusAccumulator): DtcgCensusEntry {
  return {
    tokens: a.tokens,
    types: histogram(a.types),
    descriptions: { present: a.present, missing: a.missing },
    aliases: a.aliases,
    literals: a.literals,
    scopes: histogram(a.scopes),
    code_syntax: { present: a.codeSyntaxPresent, missing: a.codeSyntaxMissing },
    publication: { published: a.published, hidden_from_publishing: a.hiddenFromPublishing },
    ...(a.omitted > 0 ? { omitted: a.omitted } : {}),
    ...(a.collided > 0 ? { collided: a.collided } : {}),
  };
}

/** A style file's census: only the fields a style leaf can answer. */
function styleCensus(tree: DtcgTree): DtcgCensusEntry {
  const a = newAccumulator();
  const walk = (node: DtcgJson): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const record = node as Record<string, DtcgJson>;
    if ('$value' in record) {
      a.tokens += 1;
      bump(a.types, typeof record.$type === 'string' ? record.$type : 'unknown');
      if (typeof record.$description === 'string' && record.$description.length > 0) a.present += 1;
      else a.missing += 1;
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith('$')) continue;
      walk(value);
    }
  };
  walk(tree);
  return { tokens: a.tokens, types: histogram(a.types), descriptions: { present: a.present, missing: a.missing } };
}

export function foundationDtcg(artifact: FoundationArtifactV5, options: DtcgOptions = {}): DtcgExport {
  const p: Projection = {
    artifact,
    options: { values: options.values ?? 'standard', ...(options.units ? { units: options.units } : {}) },
    tokenById: new Map(artifact.tokens.map((t) => [t.id, t])),
    tokenIds: new Set(artifact.tokens.map((t) => t.id)),
    collectionById: new Map(artifact.collections.map((c) => [c.id, c])),
    collectionLabelById: collectionLabels(artifact.collections),
    modeLabelsById: new Map(artifact.collections.map((c) => [c.id, modeLabels(c)])),
    pathById: new Map(),
    segmentsById: new Map(),
    omittedIds: new Set(),
    collidedIds: new Set(),
    report: [],
    reportKeys: new Set(),
    factsById: new Map(),
  };
  indexPaths(p);
  omitInexpressibleTypes(p);
  reportDuplicateCodeSyntax(p);
  reportCollectionNameCollisions(p);

  const files: Record<string, DtcgTree> = {};
  const plans: FilePlan[] = [];
  const census: Record<string, DtcgCensusEntry> = {};
  const taken = new Set<string>(RESERVED_FILE_NAMES);
  for (const collection of artifact.collections) {
    for (const mode of collection.modes) {
      const tree: DtcgTree = {};
      const a = newAccumulator();
      for (const token of artifact.tokens) {
        if (token.collection_id !== collection.id) continue;
        if (p.omittedIds.has(token.id)) {
          a.omitted += 1;
          if (p.collidedIds.has(token.id)) a.collided += 1;
          continue;
        }
        const leaf = tokenLeaf(p, token, collection, mode.id);
        if (!leaf) continue;
        setLeaf(tree, p.segmentsById.get(token.id) ?? [], leaf);
        a.tokens += 1;
        bump(a.types, typeof leaf.$type === 'string' ? leaf.$type : 'unknown');
        if (typeof leaf.$value === 'string' && leaf.$value.startsWith('{')) a.aliases += 1;
        else a.literals += 1;
        if (token.description.length > 0) a.present += 1; else a.missing += 1;
        for (const scope of token.scopes) bump(a.scopes, scope);
        if (token.code_syntax) a.codeSyntaxPresent += 1; else a.codeSyntaxMissing += 1;
        if (token.publication?.published) a.published += 1;
        if (token.publication?.hidden_from_publishing) a.hiddenFromPublishing += 1;
      }
      annotateGroups(p, tree, collection);
      const file = fileNameFor(collection, mode, taken);
      plans.push({ collection, modeId: mode.id, file });
      files[file] = sortTree(tree) as DtcgTree;
      census[file] = censusEntry(a);
    }
  }
  const styles = styleFiles(p);
  Object.assign(files, styles);
  for (const [file, tree] of Object.entries(styles)) census[file] = styleCensus(tree);
  const resolver = buildResolver(p, plans, Object.keys(styles).sort(compareCodeUnits));
  p.report.sort((a, b) => compareCodeUnits(a.path, b.path)
    || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.mode ?? '', b.mode ?? ''));

  const meta: Record<string, DtcgMetaEntry> = {};
  for (const token of artifact.tokens) {
    const collection = p.collectionById.get(token.collection_id);
    if (!collection) continue;
    const path = p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name;
    // Colliding tokens share a path, so the path alone would let one of them
    // overwrite the other and lose the record the sidecar exists to keep.
    meta[p.collidedIds.has(token.id) ? `${path} [${token.id}]` : path] = metaEntry(p, token, collection);
  }
  const sortedMeta = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => compareCodeUnits(a, b)));

  const codeSyntax: Record<string, Record<string, string>> = {};
  for (const [path, entry] of Object.entries(sortedMeta)) {
    if (entry.code_syntax) codeSyntax[path] = entry.code_syntax;
  }
  const sourceFileName = artifact.spec_layer.source.file_name;
  const extension: DtcgDocumentExtension = {
    schema_version: SCHEMA_VERSION,
    content_hash: artifact.spec_layer.export.content_hash,
    config_hash: `sha256:${sha256(canonicalJson(p.options))}`,
    source: {
      provider: 'figma',
      ...(typeof sourceFileName === 'string' && sourceFileName.length > 0
        ? { file_name: sourceFileName } : {}),
    },
    completeness: artifact.completeness,
    code_syntax: codeSyntax,
    census: Object.fromEntries(Object.keys(census).sort(compareCodeUnits).map((k) => [k, census[k]])),
    report: p.report,
  };
  return { files, resolver, meta: sortedMeta, report: p.report, extension };
}

/** DTCG has no string or boolean type. Such tokens are omitted whole. */
function omitInexpressibleTypes(p: Projection): void {
  for (const token of p.artifact.tokens) {
    if (token.type !== 'string' && token.type !== 'boolean') continue;
    p.omittedIds.add(token.id);
    reportOnce(p, {
      code: 'type_not_expressible', severity: 'warning',
      path: p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name,
      message: `DTCG has no ${token.type} type; the token was omitted.`,
      details: { id: token.id, type: token.type },
    });
  }
}

/** The `$type`/`$value`/`$description` leaf for one token in one mode, or null when omitted. */
function tokenLeaf(p: Projection, token: TokenV5, collection: CollectionV5, modeId: string): DtcgTree | null {
  const value = token.values[modeId];
  const path = p.pathById.get(token.id) ?? '';
  // The report names the mode the way the resolver contexts do, so an entry
  // about one of two same-named modes points at the file it came from.
  const mode = modeLabelOf(p, collection, modeId);
  const description: Record<string, DtcgJson> =
    token.description.length > 0 ? { $description: token.description } : {};

  if (value === undefined || value.kind === 'missing') {
    reportOnce(p, {
      code: 'value_omitted', severity: 'warning', path, mode,
      message: 'The token has no value for this mode.',
      details: { id: token.id, reason: value?.reason ?? 'no_value_for_mode' },
    });
    return null;
  }

  if (value.kind === 'alias') {
    if (value.resolved.status === 'unresolved') {
      reportOnce(p, {
        code: 'value_omitted', severity: 'warning', path, mode,
        message: `The alias could not be resolved (${value.resolved.reason}); no value was written.`,
        details: {
          id: token.id, reason: value.resolved.reason,
          target_path: value.reference.target_path.join('/'),
          ...(value.reference.target_id !== null ? { target_id: value.reference.target_id } : {}),
          ...(value.reference.source_library_name
            ? { source_library_name: value.reference.source_library_name } : {}),
        },
      });
      return null;
    }
    const targetId = value.reference.target_id;
    const targetPath = targetId !== null && !p.omittedIds.has(targetId) ? p.pathById.get(targetId) : undefined;
    if (targetPath === undefined) {
      reportOnce(p, {
        code: 'value_omitted', severity: 'warning', path, mode,
        message: 'The alias target was itself omitted from the DTCG output.',
        details: {
          id: token.id, reason: 'target_omitted',
          target_path: value.reference.target_path.join('/'),
          ...(targetId !== null ? { target_id: targetId } : {}),
          ...(value.reference.source_library_name
            ? { source_library_name: value.reference.source_library_name } : {}),
        },
      });
      return null;
    }
    const target = targetId !== null ? p.tokenById.get(targetId) : undefined;
    const hop = value.resolved.chain[0];
    if (target && hop && target.collection_id !== token.collection_id) {
      const targetCollection = p.collectionById.get(target.collection_id);
      // A single-mode target set resolves the same way in every context, so
      // nothing is lost. Only a multi-mode target can resolve differently
      // under the consumer's contexts than Figma did.
      // Compared by display NAME, because that is the mode policy Figma applied;
      // reported by LABEL, so the entry names a resolver context that exists.
      if (targetCollection !== undefined && targetCollection.modes.length > 1
        && modeName(targetCollection, hop.mode_id) !== modeName(collection, modeId)) {
        const hopMode = modeLabelOf(p, targetCollection, hop.mode_id);
        reportOnce(p, {
          code: 'mode_selection_not_expressible', severity: 'info', path, mode,
          message: `Figma resolved this alias through the target's "${hopMode}" mode; DTCG resolves it by the consumer's context.`,
          details: {
            id: token.id, target_id: targetId ?? '', target_mode: hopMode,
            resolved: asJson(value.resolved.value),
          },
        });
      }
    }
    const typed = aliasLeafType(p, token, value.resolved.chain, value.resolved.value);
    if ('omit' in typed) {
      reportOnce(p, {
        code: typed.omit, severity: 'warning', path, mode,
        message: 'The alias resolves to a value DTCG cannot state; the value was omitted.',
        details: { id: token.id, ...typed.details },
      });
      return null;
    }
    recordFact(p, token.id, mode, 'alias', typed.$value);
    return { $type: typed.$type, $value: `{${targetPath}}`, ...description };
  }

  const projected = projectedLiteral(p, token, value.value, (override) => {
    reportOnce(p, {
      code: 'unit_override_conflicts_with_scope', severity: 'warning', path,
      message: 'A unit override names this token but its scopes state a unitless number; the override was ignored.',
      details: { id: token.id, override, scopes: [...token.scopes] },
    });
  });
  const converted = projected.converted;
  if ('omit' in converted) {
    reportOnce(p, {
      code: converted.omit, severity: 'warning', path, mode,
      message: converted.omit === 'type_not_expressible'
        ? `DTCG has no ${String(converted.details.type)} type; the value was omitted.`
        : `DTCG dimensions take px or rem; a ${String(converted.details.unit)} value was omitted.`,
      details: { id: token.id, ...converted.details },
    });
    return null;
  }
  if (projected.transform !== null) recordFact(p, token.id, mode, projected.transform);
  return { $type: converted.$type, $value: converted.$value, ...description };
}

// ---------------------------------------------------------------------------
// Resolver document and export
// ---------------------------------------------------------------------------

/**
 * What one emitted file actually holds. The census reports what the projection
 * produced; `report` keeps its own job of naming what it could not produce.
 *
 * A style file carries only the three fields every file has. The token-only
 * fields are ABSENT there rather than zero, because a style leaf has no Figma
 * scopes, no code syntax and no publication state, and a zero would state
 * something this projection does not know.
 */
export interface DtcgCensusEntry {
  tokens: number;
  types: Record<string, number>;
  descriptions: { present: number; missing: number };
  aliases?: number;
  literals?: number;
  scopes?: Record<string, number>;
  code_syntax?: { present: number; missing: number };
  publication?: { published: number; hidden_from_publishing: number };
  omitted?: number;
  collided?: number;
}

export interface DtcgDocumentExtension {
  schema_version: string;
  content_hash: string;
  /** A digest of the projection options that produced this document: the
   *  value style and the unit overrides. Descriptive only. It answers whether
   *  an output changed because the design changed or because the repository
   *  changed its config, and it must never feed a canvas hash or an artifact
   *  identity. */
  config_hash: string;
  source: { provider: 'figma'; file_name?: string };
  completeness: FoundationArtifactV5['completeness'];
  code_syntax: Record<string, Record<string, string>>;
  /** Per emitted file, keyed by file name, so a reader can judge an export
   *  without walking it. */
  census: Record<string, DtcgCensusEntry>;
  report: DtcgReportEntry[];
}
export interface DtcgDocument extends DtcgResolverDocument {
  $extensions: { 'com.spec-layer': DtcgDocumentExtension };
}

/** The clipboard form: the resolver with sources inlined instead of `$ref`s. */
export function foundationDtcgDocument(artifact: FoundationArtifactV5, options: DtcgOptions = {}): DtcgDocument {
  const out = foundationDtcg(artifact, options);
  const inline = (sources: DtcgJson[]): DtcgJson[] => sources.map((s) =>
    typeof s === 'object' && s !== null && !Array.isArray(s) && typeof s.$ref === 'string'
      ? out.files[s.$ref] ?? s
      : s);
  const sets = Object.fromEntries(Object.entries(out.resolver.sets)
    .map(([k, v]) => [k, { sources: inline(v.sources) }]));
  const modifiers = Object.fromEntries(Object.entries(out.resolver.modifiers).map(([k, v]) => [k, {
    contexts: Object.fromEntries(Object.entries(v.contexts).map(([c, s]) => [c, inline(s)])),
    ...(v.default !== undefined ? { default: v.default } : {}),
  }]));
  return {
    ...out.resolver, sets, modifiers,
    $extensions: { 'com.spec-layer': out.extension },
  };
}

/** Every output as file text, two-space JSON with a trailing newline. */
export function dtcgExportFiles(out: DtcgExport): Record<string, string> {
  const text = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const files: Record<string, string> = {};
  for (const name of Object.keys(out.files).sort(compareCodeUnits)) files[name] = text(out.files[name]);
  files['resolver.json'] = text({
    ...out.resolver, $extensions: { 'com.spec-layer': out.extension },
  });
  files['spec-layer.meta.json'] = text(out.meta);
  files['report.json'] = text(out.report);
  return files;
}

/**
 * DTCG projection of a Foundation Context v5 artifact. Spec:
 * docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md.
 *
 * Design Tokens Format Module 2025.10 and Resolver Module 2025.10. This is a
 * presentation profile over a validated artifact, like aiContext.ts: it never
 * feeds a hash, never mutates its input, and anything the format cannot state
 * is omitted and written to the report rather than approximated.
 */
import { SCHEMA_VERSION, type FoundationArtifactV5 } from './canonical';
import { compareCodeUnits } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, EffectV5, StyleProperty, TokenV5, TypographyStyleV5,
} from './entities';
import { canonicalNumber } from './precision';
import type { ColorValue, DimensionValue, TypedValue } from './value';

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
  | 'duplicate_code_syntax';

export interface DtcgReportEntry {
  code: DtcgReportCode;
  severity: 'error' | 'warning' | 'info';
  /** DTCG path, collection first, dot-joined. */
  path: string;
  mode?: string;
  message: string;
  details: Record<string, DtcgJson>;
}

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

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';

/** `<collection>.<mode>.json`, with `-2`, `-3` on a slug collision. */
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
  collectionById: Map<string, CollectionV5>;
  /** token id -> dot-joined DTCG path, for every token that survived collision. */
  pathById: Map<string, string>;
  /** token id -> segments including the collection head. */
  segmentsById: Map<string, string[]>;
  omittedIds: Set<string>;
  report: DtcgReportEntry[];
}

function reportOnce(p: Projection, entry: DtcgReportEntry): void {
  const key = JSON.stringify([entry.code, entry.path, entry.mode ?? null, entry.details]);
  const seen = p.report.some((r) => JSON.stringify([r.code, r.path, r.mode ?? null, r.details]) === key);
  if (!seen) p.report.push(entry);
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

/** Mode labels unique within a collection: the name alone, or name plus id when a name repeats. */
function modeLabels(collection: CollectionV5): Map<string, string> {
  const counts = new Map<string, number>();
  for (const m of collection.modes) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  return new Map(collection.modes.map((m) => [m.id, counts.get(m.name) === 1 ? m.name : `${m.name} [${m.id}]`]));
}

function asJson(value: unknown): DtcgJson {
  return JSON.parse(JSON.stringify(value)) as DtcgJson;
}

function metaEntry(p: Projection, token: TokenV5, collection: CollectionV5): DtcgMetaEntry {
  const labels = modeLabels(collection);
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

/** A style property as a DTCG composite member: a reference when bound to a
 *  surviving token, else the converted literal; `null` when nothing truthful fits. */
function styleMember(
  p: Projection, property: StyleProperty, scopes: string[], path: string, name: string,
): { value: DtcgJson } | { extension: DtcgJson } | null {
  if (property.source.kind === 'alias' && property.source.target_id !== null
    && !p.omittedIds.has(property.source.target_id)) {
    const target = p.pathById.get(property.source.target_id);
    if (target !== undefined) return { value: `{${target}}` };
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
    const member = styleMember(p, style.properties[key], scopes, path, name);
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
    const labels = modeLabels(collection);
    if (own.length === 1) {
      sets[collection.name] = { sources: [{ $ref: own[0].file }] };
      order.push({ $ref: `#/sets/${pointer(collection.name)}` });
      continue;
    }
    const contexts: Record<string, DtcgJson[]> = {};
    for (const plan of own) contexts[labels.get(plan.modeId) ?? plan.modeId] = [{ $ref: plan.file }];
    const def = labels.get(collection.default_mode_id);
    modifiers[collection.name] = { contexts, ...(def !== undefined ? { default: def } : {}) };
    order.push({ $ref: `#/modifiers/${pointer(collection.name)}` });
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

export function foundationDtcg(artifact: FoundationArtifactV5, options: DtcgOptions = {}): DtcgExport {
  const p: Projection = {
    artifact,
    options: { values: options.values ?? 'standard', ...(options.units ? { units: options.units } : {}) },
    collectionById: new Map(artifact.collections.map((c) => [c.id, c])),
    pathById: new Map(),
    segmentsById: new Map(),
    omittedIds: new Set(),
    report: [],
  };
  indexPaths(p);
  omitInexpressibleTypes(p);
  reportDuplicateCodeSyntax(p);

  const files: Record<string, DtcgTree> = {};
  const plans: FilePlan[] = [];
  const taken = new Set<string>();
  for (const collection of artifact.collections) {
    for (const mode of collection.modes) {
      const tree: DtcgTree = {};
      for (const token of artifact.tokens) {
        if (token.collection_id !== collection.id || p.omittedIds.has(token.id)) continue;
        const leaf = tokenLeaf(p, token, collection, mode.id);
        if (leaf) setLeaf(tree, p.segmentsById.get(token.id) ?? [], leaf);
      }
      annotateGroups(p, tree, collection);
      const file = fileNameFor(collection, mode, taken);
      plans.push({ collection, modeId: mode.id, file });
      files[file] = sortTree(tree) as DtcgTree;
    }
  }
  const styles = styleFiles(p);
  Object.assign(files, styles);
  const resolver = buildResolver(p, plans, Object.keys(styles).sort(compareCodeUnits));
  p.report.sort((a, b) => compareCodeUnits(a.path, b.path)
    || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.mode ?? '', b.mode ?? ''));

  const meta: Record<string, DtcgMetaEntry> = {};
  for (const token of artifact.tokens) {
    const collection = p.collectionById.get(token.collection_id);
    if (!collection) continue;
    const path = p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name;
    meta[path] = metaEntry(p, token, collection);
  }
  const sortedMeta = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => compareCodeUnits(a, b)));

  return { files, resolver, meta: sortedMeta, report: p.report };
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
  const mode = modeName(collection, modeId);
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
    const target = p.artifact.tokens.find((t) => t.id === targetId);
    const hop = value.resolved.chain[0];
    if (target && hop && target.collection_id !== token.collection_id) {
      const targetCollection = p.collectionById.get(target.collection_id);
      const hopMode = targetCollection ? modeName(targetCollection, hop.mode_id) : hop.mode_id;
      if (hopMode !== mode) {
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
    const typed = dtcgLiteral(value.resolved.value, token.scopes, p.options.values);
    if ('omit' in typed) {
      reportOnce(p, {
        code: typed.omit, severity: 'warning', path, mode,
        message: 'The alias resolves to a value DTCG cannot state; the value was omitted.',
        details: { id: token.id, ...typed.details },
      });
      return null;
    }
    return { $type: typed.$type, $value: `{${targetPath}}`, ...description };
  }

  const override = unitOverrideFor(p, token, collection);
  let literal: TypedValue = value.value;
  if (override !== undefined && literal.type === 'number') {
    if (token.scopes.some((s) => STATED_NUMBER_SCOPES.includes(s))) {
      reportOnce(p, {
        code: 'unit_override_conflicts_with_scope', severity: 'warning', path,
        message: 'A unit override names this token but its scopes state a unitless number; the override was ignored.',
        details: { id: token.id, override, scopes: [...token.scopes] },
      });
    } else {
      literal = { type: 'dimension', number: literal.value, unit: override };
    }
  }
  const converted = dtcgLiteral(literal, token.scopes, p.options.values);
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
  return { $type: converted.$type, $value: converted.$value, ...description };
}

// ---------------------------------------------------------------------------
// Resolver document and export
// ---------------------------------------------------------------------------

export interface DtcgDocumentExtension {
  schema_version: string;
  content_hash: string;
  source: { provider: 'figma'; file_name?: string };
  completeness: FoundationArtifactV5['completeness'];
  code_syntax: Record<string, Record<string, string>>;
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
  const codeSyntax: Record<string, Record<string, string>> = {};
  for (const [path, entry] of Object.entries(out.meta)) {
    if (entry.code_syntax) codeSyntax[path] = entry.code_syntax;
  }
  const fileName = artifact.spec_layer.source.file_name;
  return {
    ...out.resolver, sets, modifiers,
    $extensions: {
      'com.spec-layer': {
        schema_version: SCHEMA_VERSION,
        content_hash: artifact.spec_layer.export.content_hash,
        source: {
          provider: 'figma',
          ...(typeof fileName === 'string' && fileName.length > 0 ? { file_name: fileName } : {}),
        },
        completeness: artifact.completeness,
        code_syntax: codeSyntax,
        report: out.report,
      },
    },
  };
}

/** Every output as file text, two-space JSON with a trailing newline. */
export function dtcgExportFiles(out: DtcgExport): Record<string, string> {
  const text = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const files: Record<string, string> = {};
  for (const name of Object.keys(out.files).sort(compareCodeUnits)) files[name] = text(out.files[name]);
  files['resolver.json'] = text(out.resolver);
  files['spec-layer.meta.json'] = text(out.meta);
  files['report.json'] = text(out.report);
  return files;
}

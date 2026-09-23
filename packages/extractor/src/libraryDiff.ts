/**
 * libraryDiff.ts: the typed diff between two published library bundles, and
 * the semantic version bump it requires.
 *
 * Figma-free and deterministic. The proxy runs it on every publish and stores
 * the result, so two machines must produce byte-identical output for the same
 * pair of bundles: every sort here uses compareCodeUnits, never localeCompare.
 *
 * Only Figma facts feed the diff: component properties, variant axes and their
 * options, states, anatomy parts, token bindings, layout and effect values,
 * foundation collections, modes, tokens and their per-mode values, and
 * styles. Prose, descriptions, diagnostics, completeness, the export envelope,
 * the AI projections and the bundle's file and plugin metadata are never read.
 * Token bindings are compared per variant when both bundles carry a variants
 * list, and by rule identity otherwise.
 *
 * Built on `diffKeyed` from diff.ts. `diff.ts` explains changes to a designer
 * on the Library screen; this module explains them to a version number and a
 * history pane, so its output is structured rather than prose.
 */
import { diffKeyed, axisModel, comboKey, coverConditions, describeScope, type Combo } from './diff';
import { matchesVariant } from './resolve';
import { canonicalJson } from './v5/canonical';
import { compareCodeUnits } from './v5/diagnostics';
import type { LibraryBundleV1 } from './libraryBundle';
import type { CanonicalValue, TypedValue } from './v5/value';

export type ChangeKind = 'added' | 'removed' | 'renamed' | 'changed';

/**
 * The v5 component artifact carries variant axes and their options but no
 * variant instance list, so there is no `variant` entity: an added option is
 * the observable event when a variant appears.
 */
export type ChangeEntity =
  | 'component' | 'property' | 'option' | 'variant_axis'
  | 'state' | 'anatomy_part' | 'binding' | 'value'
  | 'collection' | 'mode' | 'token' | 'token_value' | 'style';

export type Bump = 'major' | 'minor' | 'patch';

export interface LibraryChange {
  kind: ChangeKind;
  entity: ChangeEntity;
  /** Component display name after the change, null for foundation changes. */
  component: string | null;
  /** Stable identity within its scope. */
  id: string;
  /** Display name after the change. */
  name: string;
  /** Rendered previous value, when meaningful. */
  from: string | null;
  /** Rendered new value, when meaningful. */
  to: string | null;
  /** Variant condition or mode, when meaningful. */
  scope: string | null;
  bump: Bump;
}

export interface LibraryDiff {
  /** Sorted with compareChanges; deterministic. */
  changes: LibraryChange[];
  /** The highest bump across changes; null when changes is empty. */
  minimumBump: Bump | null;
  counts: { major: number; minor: number; patch: number };
}

/**
 * Entities whose removal or rename breaks a consumer and whose addition is a
 * compatible extension. Everything else is a value and moves the patch number.
 * A style is structural: code that applies a text or effect style by name
 * breaks when it is removed or renamed, just as it does for a token.
 */
const STRUCTURAL: ReadonlySet<ChangeEntity> = new Set<ChangeEntity>([
  'component', 'property', 'option', 'variant_axis', 'state', 'anatomy_part',
  'collection', 'mode', 'token', 'style',
]);

export function bumpFor(entity: ChangeEntity, kind: ChangeKind): Bump {
  if (!STRUCTURAL.has(entity)) return 'patch';
  if (kind === 'removed' || kind === 'renamed') return 'major';
  if (kind === 'added') return 'minor';
  return 'patch';
}

const BUMP_RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export function compareBump(a: Bump, b: Bump): number {
  return BUMP_RANK[a] - BUMP_RANK[b];
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Three dotted integers. No prerelease, no build metadata, no leading `v`. */
export function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/** `null` means no version yet, and the first version is always 1.0.0. */
export function nextVersion(current: string | null, bump: Bump): string {
  if (current === null) return '1.0.0';
  const match = SEMVER_RE.exec(current);
  if (!match) throw new RangeError(`Not a semantic version: ${current}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Foundation first (null component sorts before any name), then by component, entity, id, scope, kind, from, to. */
export function compareChanges(a: LibraryChange, b: LibraryChange): number {
  return compareCodeUnits(a.component ?? '', b.component ?? '')
    || compareCodeUnits(a.entity, b.entity)
    || compareCodeUnits(a.id, b.id)
    || compareCodeUnits(a.scope ?? '', b.scope ?? '')
    || compareCodeUnits(a.kind, b.kind)
    || compareCodeUnits(a.from ?? '', b.from ?? '')
    || compareCodeUnits(a.to ?? '', b.to ?? '');
}

/**
 * The version log a published library carries, declared here beside the
 * change type because three packages read it: the proxy writes it, the plugin's
 * history pane renders it, and the CLI will read it. Same reasoning as the
 * bundle contract in libraryBundle.ts.
 */
export interface VersionRecord {
  version: string;
  publishedAt: string;
  /** The applied bump. `initial` for the first versioned publish. */
  bump: Bump | 'initial';
  /** What the rules required; null on a first publish, where there is no baseline. */
  minimumBump: Bump | null;
  /** Publisher note, trimmed, at most 500 characters. */
  note: string | null;
  /** libraryBundleContentHash of the stored bundle. */
  contentHash: string;
  /** sha256 of the stored bytes, the pull ETag. */
  bundleHash: string;
  extractorVersion: string;
  pluginVersion: string;
  /** Always the full diff's counts, even when `changes` is truncated. */
  counts: { major: number; minor: number; patch: number };
  changes: LibraryChange[];
  changesTruncated: boolean;
}

/** Newest record first. */
export interface VersionLog { v: 1; records: VersionRecord[] }

function summarize(changes: LibraryChange[]): LibraryDiff {
  const sorted = [...changes].sort(compareChanges);
  const counts = { major: 0, minor: 0, patch: 0 };
  let minimumBump: Bump | null = null;
  for (const change of sorted) {
    counts[change.bump] += 1;
    if (minimumBump === null || compareBump(change.bump, minimumBump) > 0) minimumBump = change.bump;
  }
  return { changes: sorted, minimumBump, counts };
}

// ---------------------------------------------------------------------------
// Tolerant readers. A stored bundle may come from an older plugin, so every
// read tolerates a missing or misshapen field and reads it as absent.
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** `size Large, tone Brand or Neutral`, axes sorted by code unit; null when unconditioned. */
function formatWhen(when: Record<string, string[]> | null): string | null {
  if (when === null) return null;
  const entries = Object.entries(when).sort(([a], [b]) => compareCodeUnits(a, b));
  if (entries.length === 0) return null;
  return entries.map(([axis, values]) => `${axis} ${[...values].sort(compareCodeUnits).join(' or ')}`).join(', ');
}

function readWhen(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string[]> = {};
  for (const [axis, values] of Object.entries(value)) {
    out[axis] = asArray(values).map(String);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Value rendering. One formatter per v5 value shape so `from` and `to` read
// the same in every change. Nothing is invented: an unresolved alias names its
// reason and never a guessed number.
// ---------------------------------------------------------------------------

export function formatTyped(value: TypedValue): string {
  switch (value.type) {
    case 'color':
      return value.alpha < 1 ? `${value.hex} at ${Math.round(value.alpha * 100)}%` : value.hex;
    case 'dimension':
    case 'duration':
      return `${value.number}${value.unit}`;
    case 'number':
      return String(value.value);
    case 'string':
    case 'font_family':
      return value.value;
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'cubic_bezier':
      return `cubic-bezier(${value.value.join(', ')})`;
  }
}

export function formatCanonicalValue(value: CanonicalValue): string {
  switch (value.kind) {
    case 'literal':
      return formatTyped(value.value);
    case 'alias': {
      const reference = `{${value.reference.target_path.join('/')}}`;
      return value.resolved.status === 'resolved'
        ? `${reference} resolving to ${formatTyped(value.resolved.value)}`
        : `${reference} unresolved (${value.resolved.reason})`;
    }
    case 'missing':
      return `missing (${value.reason})`;
  }
}

// ---------------------------------------------------------------------------
// Component facts
// ---------------------------------------------------------------------------

interface AxisFact { name: string; options: string[]; default: string | null }
interface PropertyFact { name: string; kind: string; default: string | null; options: string[] | null }
/** Keyed by `path`, not `name`: a part name repeats across anatomy branches
 *  (e.g. two containers each with a `Label`), and pairing by name alone would
 *  let `diffKeyed`'s positional matching fabricate a `changed` between two
 *  unrelated nodes, or swallow a real add/remove. */
interface PartFact { path: string; name: string; type: string; shownBy: string | null; component: string | null }
interface BindingFact { path: string; property: string; when: Record<string, string[]> | null; sourceId: string }
interface ValueFact { id: string; value: string }
interface VariantFact { name: string; values: Record<string, string> }

interface ComponentFacts {
  id: string;
  name: string;
  axes: AxisFact[];
  properties: PropertyFact[];
  states: string[];
  parts: PartFact[];
  bindings: BindingFact[];
  values: ValueFact[];
  /** From the bundle entry, not the artifact; empty when the bundle predates it. */
  variants: VariantFact[];
  /** source_id to display name, from `references.used`. */
  tokenNames: Record<string, string>;
}

function flattenAnatomy(nodes: unknown[], out: PartFact[]): void {
  for (const node of nodes) {
    const record = asRecord(node);
    const name = asString(record.part);
    const path = asString(record.path);
    if (name !== null && path !== null) {
      out.push({
        path,
        name,
        type: asString(record.type) ?? 'unknown',
        shownBy: asString(record.shown_by),
        component: asString(record.component),
      });
    }
    flattenAnatomy(asArray(record.children), out);
  }
}

function formatProperty(fact: PropertyFact): string {
  const parts = [fact.kind];
  if (fact.default !== null) parts.push(`default ${fact.default}`);
  if (fact.options !== null) parts.push(`options ${fact.options.join(', ')}`);
  return parts.join(', ');
}

function formatPart(fact: PartFact): string {
  const parts = [fact.type];
  if (fact.shownBy !== null) parts.push(`shown by ${fact.shownBy}`);
  if (fact.component !== null) parts.push(`component ${fact.component}`);
  return parts.join(', ');
}

function readComponentFacts(entry: LibraryBundleV1['components'][number]): ComponentFacts {
  const artifact = asRecord(entry.artifact);
  const source = asRecord(asRecord(artifact.spec_layer).source);
  const id = asString(source.component_key) ?? asString(source.node_id) ?? entry.name;
  const name = asString(source.node_name) ?? entry.name;
  const api = asRecord(artifact.api);

  const axes: AxisFact[] = Object.entries(asRecord(api.variants)).map(([axis, def]) => {
    const record = asRecord(def);
    const fallback = asString(record.default);
    return { name: axis, options: asArray(record.options).map(String), default: fallback };
  });

  const properties: PropertyFact[] = [];
  for (const [prop, def] of Object.entries(asRecord(api.booleans))) {
    const record = asRecord(def);
    properties.push({
      name: prop, kind: 'boolean',
      default: typeof record.default === 'boolean' ? String(record.default) : null,
      options: null,
    });
  }
  for (const [prop, def] of Object.entries(asRecord(api.slots))) {
    const record = asRecord(def);
    properties.push({
      name: prop,
      kind: asString(record.type) ?? 'slot',
      default: record.default === undefined || record.default === null ? null : String(record.default),
      options: Array.isArray(record.options) ? record.options.map(String) : null,
    });
  }

  const states = asArray(api.states).map(String);

  const parts: PartFact[] = [];
  flattenAnatomy(asArray(artifact.anatomy), parts);

  const references = asRecord(artifact.references);
  const tokenNames: Record<string, string> = {};
  for (const used of asArray(references.used)) {
    const record = asRecord(used);
    const sourceId = asString(record.source_id);
    const label = asString(record.name);
    if (sourceId !== null && label !== null) tokenNames[sourceId] = label;
  }
  const bindings: BindingFact[] = [];
  for (const binding of asArray(references.bindings)) {
    const record = asRecord(binding);
    const path = asString(record.path);
    const property = asString(record.property);
    const sourceId = asString(record.source_id);
    if (path === null || property === null || sourceId === null) continue;
    bindings.push({ path, property, when: readWhen(record.when), sourceId });
  }

  const values: ValueFact[] = [];
  for (const item of asArray(asRecord(artifact.layout).items)) {
    const record = asRecord(item);
    const path = asString(record.path);
    if (path === null) continue;
    const summary = asString(record.summary) ?? '';
    values.push({ id: `layout:${path}`, value: record.values === undefined ? summary : `${summary}; ${canonicalJson(record.values)}` });
  }
  for (const item of asArray(artifact.effects_inline)) {
    const record = asRecord(item);
    const path = asString(record.path);
    if (path === null) continue;
    values.push({ id: `effects:${path}`, value: canonicalJson(record.layers ?? null) });
  }
  for (const item of asArray(artifact.unbound)) {
    const record = asRecord(item);
    const path = asString(record.path);
    const property = asString(record.property);
    const key = path !== null && property !== null ? `${path} / ${property}` : canonicalJson(item);
    values.push({ id: `unbound:${key}`, value: canonicalJson(item) });
  }

  const variants: VariantFact[] = (entry.variants ?? []).map((v) => ({ name: v.name, values: { ...v.values } }));

  return { id, name, axes, properties, states, parts, bindings, values, variants, tokenNames };
}

const bindingKey = (b: BindingFact): string =>
  JSON.stringify([b.path, b.property, formatWhen(b.when)]);

function change(
  partial: Omit<LibraryChange, 'bump'>,
): LibraryChange {
  return { ...partial, bump: bumpFor(partial.entity, partial.kind) };
}

/**
 * Bindings compared per variant, not per rule, the way the Library screen's
 * diff does (tokenItems in diff.ts): the minimizer recomputes every rule's
 * condition over the whole grid, so adding one variant rewrites the
 * condition on every existing binding, and a diff keyed by condition reads
 * that as one removal plus additions per binding. Both sides are expanded
 * over the variants they share and compared cell by cell; cells that moved
 * the same way share one change, scoped by the fewest conditions that
 * select exactly them. Variants on one side only are the option and axis
 * changes' story and are not compared here.
 */
function diffBindingsPerVariant(before: ComponentFacts, after: ComponentFacts, out: LibraryChange[]): void {
  const component = after.name;
  const beforeKeys = new Set(before.variants.map((v) => comboKey(v.values)));
  const seen = new Set<string>();
  const shared: Combo[] = [];
  for (const variant of after.variants) {
    const k = comboKey(variant.values);
    if (beforeKeys.has(k) && !seen.has(k)) {
      seen.add(k);
      shared.push(variant.values);
    }
  }
  if (shared.length === 0) return;
  const axes = axisModel(after.axes.map((a) => ({ prop: a.name, values: a.options })), shared);
  const defaults = new Map<string, string>();
  for (const axis of after.axes) if (axis.default !== null) defaults.set(axis.name, axis.default);

  // property key -> variant key -> sorted token names bound there.
  const cells = (facts: ComponentFacts): Map<string, Map<string, string[]>> => {
    const sets = new Map<string, Map<string, Set<string>>>();
    for (const combo of shared) {
      const vk = comboKey(combo);
      for (const binding of facts.bindings) {
        if (!matchesVariant(binding.when ?? {}, combo)) continue;
        const pk = `${binding.path} / ${binding.property}`;
        let byVariant = sets.get(pk);
        if (!byVariant) sets.set(pk, (byVariant = new Map()));
        const name = facts.tokenNames[binding.sourceId] ?? binding.sourceId;
        const tokens = byVariant.get(vk);
        if (tokens) tokens.add(name);
        else byVariant.set(vk, new Set([name]));
      }
    }
    const result = new Map<string, Map<string, string[]>>();
    for (const [pk, byVariant] of sets) {
      result.set(pk, new Map([...byVariant].map(([vk, tokens]) => [vk, [...tokens].sort(compareCodeUnits)])));
    }
    return result;
  };
  const b = cells(before);
  const a = cells(after);
  const properties = [...new Set([...a.keys(), ...b.keys()])].sort(compareCodeUnits);
  for (const pk of properties) {
    const buckets = new Map<string, { kind: ChangeKind; from: string | null; to: string | null; combos: Combo[] }>();
    for (const combo of shared) {
      const vk = comboKey(combo);
      const from = b.get(pk)?.get(vk) ?? [];
      const to = a.get(pk)?.get(vk) ?? [];
      const lost = from.filter((t) => !to.includes(t));
      const gained = to.filter((t) => !from.includes(t));
      if (lost.length === 0 && gained.length === 0) continue;
      const movement: { kind: ChangeKind; from: string | null; to: string | null } = lost.length > 0 && gained.length > 0
        ? { kind: 'changed', from: lost.join(', '), to: gained.join(', ') }
        : gained.length > 0
          ? { kind: 'added', from: null, to: gained.join(', ') }
          : { kind: 'removed', from: lost.join(', '), to: null };
      const key = JSON.stringify([movement.kind, movement.from, movement.to]);
      const bucket = buckets.get(key);
      if (bucket) bucket.combos.push(combo);
      else buckets.set(key, { ...movement, combos: [combo] });
    }
    for (const { kind, from, to, combos } of buckets.values()) {
      for (const { conditions, count } of coverConditions(combos, shared, axes)) {
        out.push(change({
          kind, entity: 'binding', component, id: pk, name: pk, from, to,
          scope: describeScope(conditions, count, shared.length, axes.size, defaults) ?? null,
        }));
      }
    }
  }
}

/** Changes inside one component that exists on both sides. */
function diffComponentPair(before: ComponentFacts, after: ComponentFacts, out: LibraryChange[]): void {
  const component = after.name;
  if (before.name !== after.name) {
    out.push(change({ kind: 'renamed', entity: 'component', component, id: after.id, name: after.name, from: before.name, to: after.name, scope: null }));
  }

  const axes = diffKeyed(before.axes, after.axes, (a) => a.name, sameJson);
  for (const axis of axes.added) out.push(change({ kind: 'added', entity: 'variant_axis', component, id: axis.name, name: axis.name, from: null, to: axis.options.join(', '), scope: null }));
  for (const axis of axes.removed) out.push(change({ kind: 'removed', entity: 'variant_axis', component, id: axis.name, name: axis.name, from: axis.options.join(', '), to: null, scope: null }));
  for (const { before: b, after: a } of axes.changed) {
    if (b.default !== a.default) {
      out.push(change({ kind: 'changed', entity: 'variant_axis', component, id: a.name, name: a.name, from: b.default, to: a.default, scope: null }));
    }
    const options = diffKeyed(b.options, a.options, (o) => o);
    for (const option of options.added) out.push(change({ kind: 'added', entity: 'option', component, id: `${a.name}/${option}`, name: option, from: null, to: null, scope: a.name }));
    for (const option of options.removed) out.push(change({ kind: 'removed', entity: 'option', component, id: `${a.name}/${option}`, name: option, from: null, to: null, scope: a.name }));
  }

  const properties = diffKeyed(before.properties, after.properties, (p) => p.name, sameJson);
  for (const p of properties.added) out.push(change({ kind: 'added', entity: 'property', component, id: p.name, name: p.name, from: null, to: p.kind, scope: null }));
  for (const p of properties.removed) out.push(change({ kind: 'removed', entity: 'property', component, id: p.name, name: p.name, from: p.kind, to: null, scope: null }));
  for (const { before: b, after: a } of properties.changed) {
    out.push(change({ kind: 'changed', entity: 'property', component, id: a.name, name: a.name, from: formatProperty(b), to: formatProperty(a), scope: null }));
  }

  const states = diffKeyed(before.states, after.states, (s) => s);
  for (const s of states.added) out.push(change({ kind: 'added', entity: 'state', component, id: s, name: s, from: null, to: null, scope: null }));
  for (const s of states.removed) out.push(change({ kind: 'removed', entity: 'state', component, id: s, name: s, from: null, to: null, scope: null }));

  const parts = diffKeyed(before.parts, after.parts, (p) => p.path, sameJson);
  for (const p of parts.added) out.push(change({ kind: 'added', entity: 'anatomy_part', component, id: p.path, name: p.name, from: null, to: formatPart(p), scope: null }));
  for (const p of parts.removed) out.push(change({ kind: 'removed', entity: 'anatomy_part', component, id: p.path, name: p.name, from: formatPart(p), to: null, scope: null }));
  for (const { before: b, after: a } of parts.changed) {
    out.push(change({ kind: 'changed', entity: 'anatomy_part', component, id: a.path, name: a.name, from: formatPart(b), to: formatPart(a), scope: null }));
  }

  if (before.variants.length > 0 && after.variants.length > 0) {
    diffBindingsPerVariant(before, after, out);
  } else {
    // Rule identity: the only comparison possible for a bundle that predates
    // the variants list. Reads a re-expressed condition as remove plus add.
    const tokenName = (facts: ComponentFacts, sourceId: string): string => facts.tokenNames[sourceId] ?? sourceId;
    const bindings = diffKeyed(before.bindings, after.bindings, bindingKey, (x, y) => x.sourceId === y.sourceId);
    const bindingId = (b: BindingFact): string => `${b.path} / ${b.property}`;
    for (const b of bindings.added) out.push(change({ kind: 'added', entity: 'binding', component, id: bindingId(b), name: bindingId(b), from: null, to: tokenName(after, b.sourceId), scope: formatWhen(b.when) }));
    for (const b of bindings.removed) out.push(change({ kind: 'removed', entity: 'binding', component, id: bindingId(b), name: bindingId(b), from: tokenName(before, b.sourceId), to: null, scope: formatWhen(b.when) }));
    for (const { before: b, after: a } of bindings.changed) {
      out.push(change({ kind: 'changed', entity: 'binding', component, id: bindingId(a), name: bindingId(a), from: tokenName(before, b.sourceId), to: tokenName(after, a.sourceId), scope: formatWhen(a.when) }));
    }
  }

  const values = diffKeyed(before.values, after.values, (v) => v.id, (x, y) => x.value === y.value);
  for (const v of values.added) out.push(change({ kind: 'added', entity: 'value', component, id: v.id, name: v.id, from: null, to: v.value, scope: null }));
  for (const v of values.removed) out.push(change({ kind: 'removed', entity: 'value', component, id: v.id, name: v.id, from: v.value, to: null, scope: null }));
  for (const { before: b, after: a } of values.changed) {
    out.push(change({ kind: 'changed', entity: 'value', component, id: a.id, name: a.id, from: b.value, to: a.value, scope: null }));
  }
}

function diffComponents(before: LibraryBundleV1, after: LibraryBundleV1, out: LibraryChange[]): void {
  const beforeFacts = before.components.map(readComponentFacts);
  const afterFacts = after.components.map(readComponentFacts);
  const components = diffKeyed(beforeFacts, afterFacts, (c) => c.id, sameJson);
  for (const c of components.added) out.push(change({ kind: 'added', entity: 'component', component: c.name, id: c.id, name: c.name, from: null, to: null, scope: null }));
  for (const c of components.removed) out.push(change({ kind: 'removed', entity: 'component', component: c.name, id: c.id, name: c.name, from: null, to: null, scope: null }));
  for (const { before: b, after: a } of components.changed) diffComponentPair(b, a, out);
}

// ---------------------------------------------------------------------------
// Foundation facts
// ---------------------------------------------------------------------------

interface ModeFact { id: string; name: string }
interface CollectionFact { id: string; name: string; modes: ModeFact[] }
interface TokenFact {
  id: string;
  name: string;
  type: string;
  scopes: string[];
  collectionId: string;
  /** mode id to rendered value. */
  values: Record<string, string>;
}
interface StyleFact { id: string; name: string; summary: string; body: string }

interface FoundationFacts {
  collections: CollectionFact[];
  tokens: TokenFact[];
  styles: StyleFact[];
  /** collection id to name, and `${collectionId}/${modeId}` to mode name. */
  names: Record<string, string>;
}

function formatTypography(properties: Record<string, unknown>): string {
  const resolved = (key: string): string => {
    const property = asRecord(properties[key]);
    const value = property.resolved;
    return isRecord(value) && typeof value.type === 'string' ? formatTyped(value as unknown as TypedValue) : 'unknown';
  };
  return `${resolved('font_family')} ${resolved('font_weight')} ${resolved('font_size')}/${resolved('line_height')}`;
}

/** The names the canvas draws for each v5 effect kind (foundationSpecimens.ts). */
const EFFECT_LABEL: Record<string, string> = {
  drop_shadow: 'Drop shadow',
  inner_shadow: 'Inner shadow',
  layer_blur: 'Layer blur',
  background_blur: 'Background blur',
};

/**
 * Display only. `summary` is compared only against the other side's summary,
 * formatted the same way in the same run, and the style's full body decides
 * whether it changed, so a label never hides or invents a change. A kind this
 * map does not know keeps its own name rather than a guessed one.
 */
function formatEffects(effects: unknown[]): string {
  if (effects.length === 0) return 'no layers';
  return effects.map((effect) => {
    const record = asRecord(effect);
    const type = asString(record.type);
    const label = type === null ? 'Effect' : EFFECT_LABEL[type] ?? type;
    return record.visible === false ? `${label} (hidden)` : label;
  }).join(', ');
}

function readFoundationFacts(entry: LibraryBundleV1['foundation']): FoundationFacts {
  const names: Record<string, string> = {};
  if (entry === null) return { collections: [], tokens: [], styles: [], names };
  const artifact = asRecord(entry.artifact);

  const collections: CollectionFact[] = [];
  for (const raw of asArray(artifact.collections)) {
    const record = asRecord(raw);
    const id = asString(record.id);
    if (id === null) continue;
    const name = asString(record.name) ?? id;
    names[id] = name;
    const modes: ModeFact[] = [];
    for (const rawMode of asArray(record.modes)) {
      const mode = asRecord(rawMode);
      const modeId = asString(mode.id);
      if (modeId === null) continue;
      const modeName = asString(mode.name) ?? modeId;
      names[`${id}/${modeId}`] = modeName;
      modes.push({ id: modeId, name: modeName });
    }
    collections.push({ id, name, modes });
  }

  const tokens: TokenFact[] = [];
  for (const raw of asArray(artifact.tokens)) {
    const record = asRecord(raw);
    const id = asString(record.id);
    if (id === null) continue;
    const values: Record<string, string> = {};
    for (const [modeId, value] of Object.entries(asRecord(record.values))) {
      values[modeId] = isRecord(value) && typeof value.kind === 'string'
        ? formatCanonicalValue(value as unknown as CanonicalValue)
        : canonicalJson(value);
    }
    tokens.push({
      id,
      name: asString(record.name) ?? id,
      type: asString(record.type) ?? 'unknown',
      scopes: asArray(record.scopes).map(String),
      collectionId: asString(record.collection_id) ?? '',
      values,
    });
  }

  const styles: StyleFact[] = [];
  const styleGroups = asRecord(artifact.styles);
  for (const raw of asArray(styleGroups.typography)) {
    const record = asRecord(raw);
    const id = asString(record.id);
    if (id === null) continue;
    const properties = asRecord(record.properties);
    styles.push({ id, name: asString(record.name) ?? id, summary: formatTypography(properties), body: canonicalJson(properties) });
  }
  for (const raw of asArray(styleGroups.effects)) {
    const record = asRecord(raw);
    const id = asString(record.id);
    if (id === null) continue;
    const effects = asArray(record.effects);
    styles.push({
      id, name: asString(record.name) ?? id, summary: formatEffects(effects),
      body: canonicalJson({ effects, bindings: record.bindings ?? null, mode_id: record.mode_id ?? null }),
    });
  }

  return { collections, tokens, styles, names };
}

function formatTokenShape(token: TokenFact, names: Record<string, string>): string {
  const collection = names[token.collectionId] ?? token.collectionId;
  const scopes = token.scopes.length > 0 ? token.scopes.join(', ') : 'none';
  return `${token.type} in ${collection}, scopes ${scopes}`;
}

function diffFoundation(before: LibraryBundleV1, after: LibraryBundleV1, out: LibraryChange[]): void {
  const b = readFoundationFacts(before.foundation);
  const a = readFoundationFacts(after.foundation);
  const modeName = (collectionId: string, modeId: string): string =>
    a.names[`${collectionId}/${modeId}`] ?? b.names[`${collectionId}/${modeId}`] ?? modeId;

  const collections = diffKeyed(b.collections, a.collections, (c) => c.id, sameJson);
  for (const c of collections.added) out.push(change({ kind: 'added', entity: 'collection', component: null, id: c.id, name: c.name, from: null, to: null, scope: null }));
  for (const c of collections.removed) out.push(change({ kind: 'removed', entity: 'collection', component: null, id: c.id, name: c.name, from: null, to: null, scope: null }));
  for (const { before: cb, after: ca } of collections.changed) {
    if (cb.name !== ca.name) {
      out.push(change({ kind: 'renamed', entity: 'collection', component: null, id: ca.id, name: ca.name, from: cb.name, to: ca.name, scope: null }));
    }
    const modes = diffKeyed(cb.modes, ca.modes, (m) => m.id, sameJson);
    for (const m of modes.added) out.push(change({ kind: 'added', entity: 'mode', component: null, id: `${ca.id}/${m.id}`, name: m.name, from: null, to: null, scope: ca.name }));
    for (const m of modes.removed) out.push(change({ kind: 'removed', entity: 'mode', component: null, id: `${ca.id}/${m.id}`, name: m.name, from: null, to: null, scope: ca.name }));
    for (const { before: mb, after: ma } of modes.changed) {
      out.push(change({ kind: 'renamed', entity: 'mode', component: null, id: `${ca.id}/${ma.id}`, name: ma.name, from: mb.name, to: ma.name, scope: ca.name }));
    }
  }

  const tokens = diffKeyed(b.tokens, a.tokens, (t) => t.id, sameJson);
  for (const t of tokens.added) out.push(change({ kind: 'added', entity: 'token', component: null, id: t.id, name: t.name, from: null, to: formatTokenShape(t, a.names), scope: null }));
  for (const t of tokens.removed) out.push(change({ kind: 'removed', entity: 'token', component: null, id: t.id, name: t.name, from: formatTokenShape(t, b.names), to: null, scope: null }));
  for (const { before: tb, after: ta } of tokens.changed) {
    if (tb.name !== ta.name) {
      out.push(change({ kind: 'renamed', entity: 'token', component: null, id: ta.id, name: ta.name, from: tb.name, to: ta.name, scope: null }));
    }
    const shapeBefore = formatTokenShape(tb, b.names);
    const shapeAfter = formatTokenShape(ta, a.names);
    if (shapeBefore !== shapeAfter) {
      out.push(change({ kind: 'changed', entity: 'token', component: null, id: ta.id, name: ta.name, from: shapeBefore, to: shapeAfter, scope: null }));
    }
    const values = diffKeyed(Object.entries(tb.values), Object.entries(ta.values), ([modeId]) => modeId, ([, x], [, y]) => x === y);
    for (const [modeId, value] of values.added) out.push(change({ kind: 'added', entity: 'token_value', component: null, id: ta.id, name: ta.name, from: null, to: value, scope: modeName(ta.collectionId, modeId) }));
    for (const [modeId, value] of values.removed) out.push(change({ kind: 'removed', entity: 'token_value', component: null, id: ta.id, name: ta.name, from: value, to: null, scope: modeName(ta.collectionId, modeId) }));
    for (const { before: [modeId, from], after: [, to] } of values.changed) {
      out.push(change({ kind: 'changed', entity: 'token_value', component: null, id: ta.id, name: ta.name, from, to, scope: modeName(ta.collectionId, modeId) }));
    }
  }

  const styles = diffKeyed(b.styles, a.styles, (s) => s.id, sameJson);
  for (const s of styles.added) out.push(change({ kind: 'added', entity: 'style', component: null, id: s.id, name: s.name, from: null, to: s.summary, scope: null }));
  for (const s of styles.removed) out.push(change({ kind: 'removed', entity: 'style', component: null, id: s.id, name: s.name, from: s.summary, to: null, scope: null }));
  for (const { before: sb, after: sa } of styles.changed) {
    // A rename is its own change, as it is for a token: it breaks code that
    // applies the style by name. The body is compared separately, so a rename
    // with the same values moves no patch line.
    if (sb.name !== sa.name) {
      out.push(change({ kind: 'renamed', entity: 'style', component: null, id: sa.id, name: sa.name, from: sb.name, to: sa.name, scope: null }));
    }
    if (sb.summary === sa.summary && sb.body === sa.body) continue;
    const readable = sb.summary !== sa.summary;
    out.push(change({ kind: 'changed', entity: 'style', component: null, id: sa.id, name: sa.name, from: readable ? sb.summary : null, to: readable ? sa.summary : null, scope: null }));
  }
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export function libraryDiff(before: LibraryBundleV1, after: LibraryBundleV1): LibraryDiff {
  const changes: LibraryChange[] = [];
  diffFoundation(before, after, changes);
  diffComponents(before, after, changes);
  return summarize(changes);
}

/**
 * brief.ts: the component YAML brief projection.
 *
 * Component Context v5 (`v5/componentContext.ts`) takes `component`, `api` and
 * `unbound` from `componentBrief`. A PROJECTION, not a dump: internal ids,
 * minimized conditions and rendering concerns stay inside, so the shape stays
 * stable while the internals change.
 */

import type { EffectLayer } from './effects';
import { knownFileKey } from './fileKey';
import { EXTRACTOR_VERSION } from './version';
import type { YamlValue } from './yaml';
import type { IntermediateSpec } from './extract';
import type { AnatomyPart } from './anatomy';
import type { ProseDrafts } from './prose/prompt';
import { tokensFor, type TokenRule } from './tokens';
import type { RefIdentity } from './tree';
import { detectStateMatrix, stateAxisProps } from './statesMatrix';
import { validate } from './validate';
import { resolutionOf } from './resolution';

/**
 * Brief schema version, bumped when the brief's shape or field meanings change.
 * 2: split `source` and `api`, condition-based `bindings`, `validation`.
 * 3: foundation `contrast` removed; contrast lives on the canvas frame.
 * 4: `tokens.used` is a list carrying `kind` and `resolution`; `text-style`
 *    kind; `effects`, `effects_inline`, `scope`; absent, not empty.
 *
 * Nothing keys "rebuild needed" on this (that reads EXTRACTOR_VERSION), so a
 * bump does not restate every committed doc.
 */
export const BRIEF_VERSION = 4;

function envelope(kind: 'component', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/** The `file_key` entry for a source block, or nothing when there is no real key. */
function fileKeyOf(fileKey: string): { file_key?: string } {
  const key = knownFileKey(fileKey);
  return key ? { file_key: key } : {};
}

/**
 * Effect layers with each field binding projected to its token NAME; the
 * RefIdentity's id, `remote` and `collectionId` stay inside. A bare name, not
 * `{ token, kind }` as in `tokens.bindings`, because an effect field binding is
 * always a variable (`EffectField` is `VariableBindableEffectField`). Every
 * other field passes through untouched.
 */
function projectEffectLayers(layers: EffectLayer[]): YamlValue {
  return layers.map((layer) => {
    const raw = layer as unknown as Record<string, unknown>;
    const bindings = raw.bindings as Record<string, RefIdentity> | undefined;
    if (!bindings) return layer as unknown as YamlValue;
    const projected: Record<string, string> = {};
    for (const [field, ref] of Object.entries(bindings)) projected[field] = ref.name;
    return { ...raw, bindings: projected } as unknown as YamlValue;
  }) as unknown as YamlValue;
}

export interface ComponentBriefOptions {
  generatedAt: string;
  /** Guidelines read from storage. Never generated here. */
  prose?: ProseDrafts | null;
}

/** An anatomy node under construction: `children` always exists, and `stripEmptyChildren` drops an empty one. */
interface AnatomyBuildNode {
  part: string;
  type: string;
  component?: string;
  /** Present only on a part hidden by default: the boolean property that shows it. */
  shown_by?: string;
  children: AnatomyBuildNode[];
}

function stripEmptyChildren(n: AnatomyBuildNode): YamlValue {
  return {
    part: n.part,
    type: n.type,
    component: n.component,
    shown_by: n.shown_by,
    children: n.children.length > 0 ? n.children.map(stripEmptyChildren) : undefined,
  };
}

/**
 * Rebuild the depth-encoded flat anatomy list as a tree: a part at depth N+1
 * becomes a child of the latest part at depth N. The stack is keyed on each
 * frame's own depth, so popping while top depth >= incoming depth handles
 * siblings and multi-level jumps alike, and a non-zero first depth is a root.
 */
function nestAnatomy(parts: AnatomyPart[]): YamlValue[] {
  const roots: AnatomyBuildNode[] = [];
  const stack: { depth: number; node: AnatomyBuildNode }[] = [];
  for (const p of parts) {
    const node: AnatomyBuildNode = {
      part: p.name, type: p.type, component: p.component, shown_by: p.shownBy, children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].depth >= p.depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: p.depth, node });
  }
  return roots.map(stripEmptyChildren);
}

/**
 * Guidelines from storage, passed through verbatim in snake_case.
 *
 * `origin` leads the block: this prose is the only content not extracted, so
 * one marked block is the whole boundary. It reads 'authored' when a person
 * typed every present field on the canvas, else 'generated', followed by
 * `authored` (the person-written fields, in block order) when only some were.
 * With nothing authored the block is byte-identical to before authorship existed.
 *
 * An empty string or array reads as absent. Whether the block exists is decided
 * on the built fields, excluding `origin` and `authored`, because a stored
 * ProseDrafts can be a truthy object with every field empty.
 */
function guidelinesOf(prose: ProseDrafts | null | undefined): YamlValue | undefined {
  if (!prose) return undefined;
  const fields: Record<string, YamlValue | undefined> = {
    definition: prose.definition || undefined,
    accessibility: prose.accessibility || undefined,
    interactions: prose.interactions || undefined,
    variants_summary: prose.variantsSummary || undefined,
    anatomy_summary: prose.anatomySummary || undefined,
    design_considerations: prose.designConsiderations || undefined,
    content_considerations: prose.contentConsiderations || undefined,
    dos: prose.dos.length > 0 ? prose.dos : undefined,
    donts: prose.donts.length > 0 ? prose.donts : undefined,
  };
  const present = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (present.length === 0) return undefined;
  const byPerson = new Set(Array.isArray(prose.authored) ? prose.authored : []);
  const authored = present.filter((k) => byPerson.has(k));
  if (authored.length === 0) return { origin: 'generated', ...fields };
  if (authored.length === present.length) return { origin: 'authored', ...fields };
  return { origin: 'generated', authored, ...fields };
}

/**
 * Identity of a RULE, not a resolved binding: rules differing only in
 * `conditions` both survive. Conditions are canonicalized over sorted axis
 * names. The separator is a space, never a NUL byte, which no check can see.
 */
function ruleKey(t: TokenRule): string {
  const axes = Object.keys(t.conditions).sort();
  const canon = JSON.stringify(axes.map((a) => [a, t.conditions[a]]));
  return `${t.path} ${t.property} ${t.name} ${canon}`;
}

/**
 * Token definitions once, bindings by condition. `conditions` is already
 * minimal (the minimizer in tokens.ts): a map from axis name to the values the
 * binding holds for. An absent `when` means every variant.
 */
/** (name, kind) joins `used` and `bindings`: two references sharing a name are two entries. */
const usedKey = (r: TokenRule): string => JSON.stringify([r.kind, r.name]);

function tokensOf(spec: IntermediateSpec): YamlValue {
  const seen = new Set<string>();
  const rules: TokenRule[] = [];
  for (const t of spec.tokens) {
    const key = ruleKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(t);
  }

  // A LIST, not a map: a map keyed by name cannot hold a variable and an effect
  // style that share one. First-use order introduces a reference before the
  // bindings that name it.
  const used: YamlValue[] = [];
  const usedSeen = new Set<string>();
  for (const r of rules) {
    const key = usedKey(r);
    if (usedSeen.has(key)) continue;
    usedSeen.add(key);

    // The brief has no foundation to read, so every entry states why it carries
    // no definition (resolution.ts, from recorded facts only). Component
    // Context v5 carries the resolved values in `references`.
    used.push({ token: r.name, kind: r.kind, resolution: resolutionOf(undefined, r) as unknown as YamlValue });
  }

  return {
    used,
    bindings: rules.map((r) => ({
      path: r.path,
      property: r.property,
      token: r.name,
      // Joins to `used` on (token, kind), not on a name two references can share.
      kind: r.kind,
      ...(Object.keys(r.conditions).length > 0 ? { when: r.conditions } : {}),
    })),
  };
}

/**
 * The component's API: configurable variants, interaction states, boolean
 * toggles, and slots; every prop lands in exactly one. `stateAxisProps` (shared
 * with the canvas Variants and States sections) decides states, and a boolean
 * is a state only when it is also a claimed variant axis. `slots` is defined by
 * exclusion, so a new `PropKind` surfaces here instead of vanishing.
 */
function apiOf(spec: IntermediateSpec): YamlValue | undefined {
  const stateProps = stateAxisProps(spec.variants);
  const matrix = detectStateMatrix(spec.variants);

  const variants: Record<string, YamlValue> = {};
  for (const axis of spec.variants) {
    if (stateProps.has(axis.prop)) continue;
    const declared = spec.props.find((p) => p.name === axis.prop);
    variants[axis.prop] = { options: axis.values, default: declared?.default };
  }

  const booleans: Record<string, YamlValue> = {};
  const slots: Record<string, YamlValue> = {};
  for (const p of spec.props) {
    if (stateProps.has(p.name)) continue;
    if (p.kind === 'variant') continue; // handled via spec.variants above
    if (p.kind === 'boolean') {
      booleans[p.name] = { default: p.default };
    } else {
      slots[p.name] = { type: p.kind, default: p.default, options: p.options };
    }
  }

  // Under the flags encoding 'Default' is a baseline column detectStateMatrix
  // synthesizes, not a declared state, so it is dropped. Under the enum
  // encoding every label is declared, and 'Default' can be a real state.
  const states = (matrix?.columns ?? [])
    .map((c) => c.label)
    .filter((label) => matrix?.encoding !== 'flags' || label.toLowerCase() !== 'default');

  // Keys are added conditionally, never set to `undefined`, here and in every
  // optional block below: `'states' in obj` is true for an undefined value, and
  // callers check presence before the YAML round trip would drop it.
  const result: Record<string, YamlValue> = {};
  if (Object.keys(variants).length > 0) result.variants = variants;
  if (states.length > 0) result.states = states;
  if (Object.keys(booleans).length > 0) result.booleans = booleans;
  if (Object.keys(slots).length > 0) result.slots = slots;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Every text style this component binds, each with the resolution saying why no
 * definition follows: the brief has no foundation, and Component Context v5
 * carries definitions in `references.foundation.styles`.
 */
function typographyOf(spec: IntermediateSpec): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.kind === 'text-style').map((t) => t.name));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    // Looked up rather than reconstructed from the name, so the resolution
    // reads Figma's own `remote` and reports `external` where that is the cause.
    const ref = spec.tokens.find((t) => t.kind === 'text-style' && t.name === name)!;
    out[name] = { resolution: resolutionOf(undefined, ref) as unknown as YamlValue };
  }
  return out;
}

/** Every effect style this component binds, as `typography` does. Node-level layers are in `effects_inline`. */
function effectsOf(spec: IntermediateSpec): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.kind === 'effect-style').map((t) => t.name));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const ref = spec.tokens.find((t) => t.kind === 'effect-style' && t.name === name)!;
    out[name] = { resolution: resolutionOf(undefined, ref) as unknown as YamlValue };
  }
  return out;
}

/** The public component brief, a projection of the internal IntermediateSpec (see the file header). */
export function componentBrief(rawSpec: IntermediateSpec, opts: ComponentBriefOptions): YamlValue {
  // Rules for a part hidden by default are dropped: v5 `conditions` cover
  // variant axes only, so such a rule would read as always holding. Anatomy
  // parts export with `shown_by`; carrying it onto rules is a schema 5.3.0
  // change. Filtering here keeps every existing artifact and its
  // semanticContentHash byte-identical.
  const spec: IntermediateSpec = {
    ...rawSpec,
    tokens: tokensFor(rawSpec.tokens, { includeHidden: false }),
  };
  const api = apiOf(spec);
  // A gap and a binding can name the same path and property (a part can be
  // hardcoded in one variant and bound in another); the binding is the
  // stronger evidence, so it wins. Computed over the UNFILTERED rules, or a
  // hidden bound layer would be falsely reported as having no binding.
  const bound = new Set(rawSpec.tokens.map((t) => `${t.path} ${t.property}`));
  const unbound = spec.gaps
    .filter((g) => !bound.has(`${g.path} ${g.property}`))
    .map((g) => ({
      path: g.path, property: g.property, issue: g.issue,
      ...(g.value !== undefined ? { value: g.value } : {}),
    }));
  const typography = typographyOf(spec);
  const effects = effectsOf(spec);
  // Joined to `unbound` and `bindings` on (path, property): one node has several rows.
  const effectsInline = spec.nodeEffects.map((n) => ({
    path: n.path,
    // Inline, since a node-level effect has no style name; see projectEffectLayers.
    layers: projectEffectLayers(n.effects),
  }));
  const guidelines = guidelinesOf(opts.prose);
  // No resolved numbers here, so validate's geometry-token-mismatch rule cannot
  // fire. Fresh literals, not `Finding[]`: TypeScript will not assign a declared
  // interface to YamlValue's index-signature branch.
  const validation = validate(spec, new Map<string, number>()).map((f) => ({
    id: f.id,
    severity: f.severity,
    ...(f.path !== undefined ? { path: f.path } : {}),
    ...(f.property !== undefined ? { property: f.property } : {}),
    message: f.message,
    ...(f.when !== undefined ? { when: f.when } : {}),
  }));
  return {
    spec_layer: envelope('component', opts.generatedAt),
    source: {
      // An unavailable key is omitted, never the string 'unknown'.
      ...fileKeyOf(spec.figmaFile),
      ...(spec.figmaFileName ? { file_name: spec.figmaFileName } : {}),
      node_id: spec.figmaNode,
      node_name: spec.name,
      ...(spec.figmaKey ? { component_key: spec.figmaKey } : {}),
    },
    component: {
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      related: spec.related.length > 0 ? spec.related : undefined,
    },
    ...(api !== undefined ? { api } : {}),
    anatomy: nestAnatomy(spec.anatomy),
    layout: spec.layout.length > 0
      // `path`, not `part`: every other block names nodes by path, and the
      // root's `part` is the raw variant name, which joins to nothing.
      ? spec.layout.map((l) => ({ path: l.path, summary: l.summary }))
      : undefined,
    tokens: tokensOf(spec),
    ...(effectsInline.length > 0 ? { effects_inline: effectsInline } : {}),
    ...(unbound.length > 0 ? { unbound } : {}),
    ...(typography !== undefined ? { typography } : {}),
    ...(effects !== undefined ? { effects } : {}),
    ...(validation.length > 0 ? { validation } : {}),
    ...(guidelines !== undefined ? { guidelines } : {}),
  };
}

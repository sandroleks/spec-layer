/**
 * brief.ts: the component YAML brief projection.
 *
 * Component Context v5 (`v5/componentContext.ts`) takes `component`, `api` and
 * `unbound` from `componentBrief` and builds the rest of its artifact itself.
 * This is deliberately a PROJECTION of the internal types rather than a dump
 * of them: internal ids stay inside, minimized token conditions and rendering
 * concerns stay inside, and the shape stays stable while the extractor's
 * internals change. The foundation half of this file (the v4 foundation
 * brief) was removed on 2026-09-23; a Foundation exports as a DTCG resolver
 * document from the Foundation Context v5 artifact.
 */

import type { EffectLayer } from './effects';
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
 * Brief schema version. Bumped when the brief's shape or field meanings change,
 * independently of EXTRACTOR_VERSION.
 *
 * 2: the v2 brief. `source` split into
 * file_key/file_name/node_id/node_name/component_key,
 * with an unavailable key now absent rather than the string 'unknown'; `api`
 * split into variants/states/booleans/slots; `tokens` restructured into `used`
 * plus condition-based `bindings` instead of a per-variant expansion;
 * `typography` carrying structured metrics instead of a display string; a
 * `validation` block added; and the component-level `contrast` block removed.
 *
 * 3: the foundation brief's `contrast` block removed too. A WCAG check is
 * measured over the colour variables, so its failure list grew with the file
 * and dominated a payload whose whole job is to hand an agent a token
 * vocabulary. Contrast is a thing to LOOK at, so it lives on the foundation
 * frame (`includeContrast`), which still draws its matrices; nothing about it
 * reaches the clipboard.
 *
 * 4: reference identity reaches the payload. Every entry in `tokens.used`
 * carries a `kind`, and one that cannot be resolved carries a `resolution`
 * with one of six statuses instead of a bare `{}`. `used` is a LIST, because a
 * map keyed by name cannot hold a variable and an effect style that share one.
 * `kind: 'typography'` became `kind: 'text-style'`, so the style kinds share a
 * vocabulary. New blocks: `effects` (effect style definitions, beside
 * `typography`), `effects_inline` (node-level effect layers with their
 * per-field bindings), `effect_styles` on the foundation brief, and `scope` on
 * a narrowed copy. A foundation brief's external aliases name their target
 * collection; colour alpha rounds to four decimals; `source`, `text_styles`
 * and `effect_styles` are absent rather than empty.
 *
 * Distinct from the doc drift baseline: nothing keys "rebuild needed" on this
 * number (that reads EXTRACTOR_VERSION), so bumping it does not restate every
 * committed doc.
 */
export const BRIEF_VERSION = 4;

function envelope(kind: 'component', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/**
 * The `file_key` entry for a source block, or nothing at all.
 *
 * `resolveFileKey` (plugin `fileKey.ts`) returns the literal string 'unknown'
 * when Figma exposes no file key and the user set no override. A consumer
 * cannot tell that apart from a real key, so an unavailable key is emitted as
 * an ABSENT key rather than as a placeholder value.
 */
function fileKeyOf(fileKey: string): { file_key?: string } {
  return fileKey && fileKey !== 'unknown' ? { file_key: fileKey } : {};
}

/**
 * Effect layers, projected for emission: every field-level binding becomes
 * its token NAME instead of the `RefIdentity` Figma gave it. `RefIdentity.id`
 * (tree.ts) is explicit that the legacy component-v4 brief keeps internal ids
 * inside, and `remote`/`collectionId` are provenance a consumer acting on that
 * brief has no use for -- so a `bindings.<field>` entry projects down to a bare
 * string, matching this block's own design-spec example.
 *
 * A bare name, not `{ token, kind }` the way `tokens.bindings` (see
 * `tokensOf`) does it. `tokens.bindings` carries `kind` alongside `token`
 * because its `token` field can name a variable OR a style, and two
 * references that share a name are only safely joined back to `tokens.used`
 * by pairing name with kind. An effect field's binding has no such
 * ambiguity: `EffectField` (effects.ts) is defined as exactly
 * `VariableBindableEffectField`, and every caller that builds `bindings`
 * (`serialize.ts`) resolves each id through `resolver.variable` alone -- a
 * `bindings.<field>` entry is always a variable and never a style. Restating
 * `kind: 'variable'` on every single entry here would be constant noise, not
 * information a consumer can act on.
 *
 * Every non-binding field -- geometry, colour, `visible`, `blendMode`,
 * `figma_type` on an unknown layer -- passes through untouched; only the
 * `bindings` key, when present, is rewritten.
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

/** One node of the anatomy tree while it is still being built: `children`
 *  always exists (possibly empty) so the stack-building loop below never has
 *  to special-case "does this node have a children array yet". `stripEmpty`
 *  turns it into the public shape, where an empty `children` becomes an
 *  absent key rather than `[]`. */
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
 * Rebuild the depth-encoded flat anatomy list (see AnatomyPart.depth) as a
 * tree: a part at depth N+1 becomes a child of the most recently seen part at
 * depth N. A straightforward single-pass build with an explicit ancestor
 * stack, rather than the non-enumerable-property sketch this replaced — a
 * stack keyed on each frame's own depth (not the stack's length) is what
 * makes depth jumps, a non-zero first depth, and same-depth siblings all fall
 * out correctly without special-casing any of them:
 * - Popping while the top frame's depth >= the incoming depth handles both a
 *   same-depth sibling (pop the previous sibling, attach to its parent) and a
 *   multi-level jump back (pop every frame deeper than or equal to the new
 *   depth in one pass).
 * - A first part whose depth isn't 0 simply starts with an empty stack, so it
 *   becomes a root like any part with no valid ancestor on the stack.
 * - A childless node's `children` array stays empty and is stripped by
 *   stripEmptyChildren, so it never emits a `children: []` key.
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
 * Guidelines read from storage, passed through verbatim. Renamed to the
 * brief's snake_case convention; nothing here is written by this function.
 *
 * `origin: 'generated'` leads the block. The prose in here is the only
 * model-written content in the brief, so one marked block is the whole
 * generated-content boundary and a consumer needs no per-field annotation to
 * find it.
 *
 * Every field applies the same empty-string-means-absent guard (`|| undefined`
 * for strings, a length check for the two string arrays) so a field that
 * `parseProseResponse` resolved to `''` (permitted for any non-required key,
 * see prose/prompt.ts) reads as missing rather than as a present-but-blank
 * value.
 *
 * Absence of the whole block is decided on the BUILT RESULT, not on whether
 * `prose` itself is truthy: a stored ProseDrafts can be a real object with
 * every field empty (parseProseResponse returns exactly that shape when only
 * optional sections were requested and the model omitted them), and that
 * object is truthy. Deciding on the result means such a case collapses to no
 * `guidelines` key at all, matching every other optional block in this brief,
 * rather than leaking a `guidelines: {}` line. `origin` is excluded from that
 * decision for exactly the same reason: counting it would make a brief with no
 * prose at all emit a guidelines block holding nothing but the marker.
 */
function guidelinesOf(prose: ProseDrafts | null | undefined): YamlValue | undefined {
  if (!prose) return undefined;
  const result: Record<string, YamlValue | undefined> = {
    origin: 'generated',
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
  const { origin: _origin, ...fields } = result;
  return Object.values(fields).some((v) => v !== undefined) ? result : undefined;
}

// ---------------------------------------------------------------------------
// Token bindings — definitions once, bindings by condition
// ---------------------------------------------------------------------------

/**
 * Identity of a RULE, not of a resolved binding: two rules differing only in
 * `conditions` are two real rules and must both survive. Conditions are
 * canonicalized through JSON.stringify over sorted axis names, so key order in
 * the object cannot make one rule look like two.
 *
 * The separator is a space. An earlier version of this file used a NUL byte,
 * which is invisible in a diff and evades every check in the repo.
 */
function ruleKey(t: TokenRule): string {
  const axes = Object.keys(t.conditions).sort();
  const canon = JSON.stringify(axes.map((a) => [a, t.conditions[a]]));
  return `${t.path} ${t.property} ${t.name} ${canon}`;
}

/**
 * Token definitions once, bindings by condition.
 *
 * v1 resolved every rule against every variant instance and factored the
 * result into `base` plus a `by_variant` entry per variant. The argument was
 * that a consuming model should never have to evaluate a condition; the cost
 * was that a 36-variant component repeated its geometry and colour bindings
 * 36 times, which made `tokens` roughly 2,400 of a 2,700-line brief.
 *
 * `conditions` is already minimal: the minimizer in tokens.ts collapsed each
 * rule to the smallest set of axes it actually depends on. Emitting that is
 * not asking the reader to evaluate a boolean expression, because it is not
 * one: it is a map from axis name to the values the binding holds for. An
 * absent `when` means every variant.
 *
 * `when` is built with a conditional spread rather than `when: cond ??
 * undefined` so an unconditioned rule's binding has no `when` KEY at all
 * (not merely an undefined-valued one) — the two differ for a caller that
 * inspects the raw object with `'when' in binding` instead of going through
 * the YAML round trip.
 */
/** (name, kind) is the join identity between `used` and `bindings`. Two
 *  references sharing a name are two entries; the same reference bound in five
 *  places is one. */
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

  // A LIST, not a map. A map keyed by name cannot hold a variable and an effect
  // style that share one, and a conditional key that only qualifies on collision
  // is the kind of thing that bites later.
  //
  // First-use order, so reading top to bottom introduces a reference before the
  // bindings that name it.
  const used: YamlValue[] = [];
  const usedSeen = new Set<string>();
  for (const r of rules) {
    const key = usedKey(r);
    if (usedSeen.has(key)) continue;
    usedSeen.add(key);

    // No definition is looked up here: the brief has no foundation to read,
    // so every entry states why it carries none. `no-foundation` for a local
    // reference, `external` for a library one, `not-extracted` for a paint
    // style (resolution.ts decides, from recorded facts only). Component
    // Context v5 carries the resolved values in `references`.
    used.push({ token: r.name, kind: r.kind, resolution: resolutionOf(undefined, r) as unknown as YamlValue });
  }

  return {
    used,
    bindings: rules.map((r) => ({
      path: r.path,
      property: r.property,
      token: r.name,
      // Carried so a binding joins to `used` on (token, kind) rather than on a
      // name that two references can share.
      kind: r.kind,
      ...(Object.keys(r.conditions).length > 0 ? { when: r.conditions } : {}),
    })),
  };
}

/**
 * The component's API, with configurable variants separated from interaction
 * states, boolean content toggles, and content/icon slots.
 *
 * v1 emitted this three times over: `api` as a flat prop list, `axes` as the
 * same props again, and `states` as a third view. Worse, `axes` listed each
 * boolean state prop as an independent axis, so a Button with three types,
 * two sizes and five state flags advertised 3 x 2^5 = 384 combinations
 * against 36 real variants.
 *
 * The split is not a judgement call: `stateAxisProps` already computes
 * exactly which variant props the States matrix consumes, and the canvas
 * frames have relied on it for both the Variants and the States sections.
 * Every prop lands in exactly one of the four groups below: a variant axis is
 * either a state flag (→ `states`, via `stateAxisProps`) or a configurable
 * variant (→ `variants`); a boolean prop is a state flag only when it is
 * ALSO a variant axis that `stateAxisProps` claimed, otherwise it is a
 * genuine content toggle (→ `booleans`); everything else -- `text` and
 * `instanceSwap` today -- is a content/icon slot (→ `slots`).
 *
 * `slots` is defined by exclusion (neither `variant` nor `boolean`), not by
 * naming `text`/`instanceSwap` explicitly. Naming them would silently drop any
 * fifth `PropKind` from the brief; defining the group by exclusion surfaces it
 * here instead.
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
      // Everything that isn't a variant or a boolean -- by exclusion, not by
      // naming 'text'/'instanceSwap' -- is a content/icon slot.
      slots[p.name] = { type: p.kind, default: p.default, options: p.options };
    }
  }

  // Under the flags encoding, 'Default' is a column detectStateMatrix
  // SYNTHESIZES as a baseline to compare the flags against (statesMatrix.ts:
  // `{ label: 'Default', override: {} }`) -- the component declares no such
  // state, so it must not be listed. Under the enum encoding there is no
  // synthesized column: every label is a value the axis's own Figma
  // definition declared, and 'Default' can be one of them for real (e.g.
  // chip.json's States axis literally declares 'Default' alongside 'Hover',
  // 'Focus', 'Press') -- dropping it there would delete a state the
  // component genuinely has, and could even contradict a token binding that
  // conditions on `States: ['Default']` elsewhere in the same brief.
  const states = (matrix?.columns ?? [])
    .map((c) => c.label)
    .filter((label) => matrix?.encoding !== 'flags' || label.toLowerCase() !== 'default');

  // Built by conditionally adding keys, not by assigning `undefined` to them:
  // an object literal like `{ states: undefined }` still has a `states` key
  // (`'states' in obj` is true even though the value is undefined), and the
  // callers of this function check presence directly rather than only after
  // a YAML round trip (which does drop undefined-valued keys).
  const result: Record<string, YamlValue> = {};
  if (Object.keys(variants).length > 0) result.variants = variants;
  if (states.length > 0) result.states = states;
  if (Object.keys(booleans).length > 0) result.booleans = booleans;
  if (Object.keys(slots).length > 0) result.slots = slots;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Every text style this component binds, each with the resolution that says
 * why this brief carries no definition for it: the brief has no foundation to
 * read, and Component Context v5 carries style definitions in
 * `references.foundation.styles`. The block still exists so the set of bound
 * styles is stated rather than implied by `tokens.used`. `source_name` and
 * the metrics this block once resolved were reachable only through an option
 * no shipping path passed; they went with it on 2026-09-23.
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

/**
 * Every effect style this component binds, beside `typography:` and for the
 * same reason: the set of bound styles is stated, and each entry says why no
 * definition follows. Node-level effect layers, which need no style
 * definition, are in `effects_inline`.
 */
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

/**
 * The public component brief: everything about one component, including its
 * token bindings. `spec` is the extractor's internal IntermediateSpec; this
 * is a PROJECTION of it, not a dump — see the file header.
 */
export function componentBrief(rawSpec: IntermediateSpec, opts: ComponentBriefOptions): YamlValue {
  // Rules for a part hidden by default are dropped from this contract, not
  // because they are uninteresting but because there is nowhere here to say a
  // rule is conditional on one. A v5 token rule's `conditions` cover variant
  // axes only, so emitting one would present a rule that needs
  // "Icon left = true" as one that always holds. Anatomy parts DO export with
  // `shown_by`, so the part itself is still visible to a reader; carrying the
  // same field onto token rules is a schema 5.3.0 change.
  //
  // Keeping this filter here rather than at each read also keeps every
  // existing component's artifact, and its semanticContentHash, byte-identical.
  const spec: IntermediateSpec = {
    ...rawSpec,
    tokens: tokensFor(rawSpec.tokens, { includeHidden: false }),
  };
  // Same reasoning as inside apiOf: only spread the key in when there is an
  // api block, rather than assigning `api: undefined`, so a component with
  // no props has no `api` key at all on the raw object, not merely one with
  // an undefined value.
  const api = apiOf(spec);
  // A gap and a binding can name the same path and property: gap detection
  // walks hidden subtrees that token extraction prunes, and a part can be
  // hardcoded in one variant while bound in another. Emitting both makes the
  // brief contradict itself, which is exactly what v1 did when `unbound`
  // reported ButtonLabel as having a hardcoded colour while `tokens` showed
  // the token bound on the same node. A binding is the stronger evidence, so
  // it wins.
  //
  // Computed over the UNFILTERED rules on purpose. Gap detection reaches
  // hidden subtrees, and now so does token extraction, so a hidden layer whose
  // fill is bound would otherwise be reported here as having no token binding:
  // a false diagnostic this join exists precisely to prevent. Suppressing a
  // gap adds nothing to the file and states nothing new, so it does not need
  // the schema field the rules themselves are waiting on.
  const bound = new Set(rawSpec.tokens.map((t) => `${t.path} ${t.property}`));
  const unbound = spec.gaps
    .filter((g) => !bound.has(`${g.path} ${g.property}`))
    .map((g) => ({
      path: g.path, property: g.property, issue: g.issue,
      ...(g.value !== undefined ? { value: g.value } : {}),
    }));
  const typography = typographyOf(spec);
  const effects = effectsOf(spec);
  // Joined to `unbound` and `bindings` on (path, property), never on path alone:
  // one node routinely has several rows -- fill, border, effects, spacing -- at
  // the same path.
  const effectsInline = spec.nodeEffects.map((n) => ({
    path: n.path,
    // Inline here, unlike the style entries above, because a node-level effect
    // has no style name to point at. Projected, not cast straight through:
    // a bound field carries a full RefIdentity (id, name, kind, remote,
    // collectionId) and only `name` is fit to leave the file -- see
    // projectEffectLayers.
    layers: projectEffectLayers(n.effects),
  }));
  const guidelines = guidelinesOf(opts.prose);
  // No resolved numbers: the brief has no foundation to read them from, so
  // validate's geometry-token-mismatch rule cannot fire here. validate.ts
  // keeps the rule for a caller that can supply them.
  // Projected into fresh literal objects rather than embedding `Finding[]`
  // directly: `Finding` is a declared interface, and TypeScript will not
  // assign a declared (non-literal) type to YamlValue's index-signature
  // branch even when every field is structurally a YamlValue -- the same
  // reason every other block in this file is built as a fresh object/array
  // literal rather than a typed internal shape passed through as-is.
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
      // A file KEY no longer
      // sits under a field named `file`, and an unavailable key is omitted
      // rather than emitted as the literal string 'unknown'. Conditional
      // spreads, not `key: undefined`: the YAML emitter drops undefined-valued
      // keys, but `{ file_key: undefined }` still leaves `'file_key' in source`
      // true for any consumer reading the object before it is serialized.
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
      // `path`, not `part`. Every other block that names a node uses the path
      // identity (bindings, unbound, validation), and `part` for the root is
      // the raw variant name ("type=Primary, size=Large, hover=False, ..."),
      // so a reader could not match a layout row to the `Container` its
      // bindings talk about. Joinability is the whole point of the identity.
      ? spec.layout.map((l) => ({ path: l.path, summary: l.summary }))
      : undefined,
    tokens: tokensOf(spec),
    ...(effectsInline.length > 0 ? { effects_inline: effectsInline } : {}),
    // Same reasoning as `api` above: spread the key in only when a gap
    // survived reconciliation, rather than assigning `unbound: undefined` —
    // `{ key: undefined }` still leaves `'unbound' in brief` true.
    ...(unbound.length > 0 ? { unbound } : {}),
    ...(typography !== undefined ? { typography } : {}),
    ...(effects !== undefined ? { effects } : {}),
    ...(validation.length > 0 ? { validation } : {}),
    // Conditional spread for the same reason as every optional block above:
    // guidelinesOf returns undefined when there is no prose, and
    // `{ guidelines: undefined }` still leaves `'guidelines' in brief` true for
    // a consumer reading the object before it is serialized.
    ...(guidelines !== undefined ? { guidelines } : {}),
  };
}

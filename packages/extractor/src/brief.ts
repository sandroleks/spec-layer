/**
 * brief.ts — the public YAML brief projections.
 *
 * These are the product's only export contract now that Markdown is retired,
 * so they are deliberately a PROJECTION of the internal types rather than a
 * dump of them: internal ids, minimized token conditions, and rendering
 * concerns stay inside, and the shapes here can stay stable while the
 * extractor's internals change.
 */

import type { FoundationSpec, FoundationValue, FoundationVariable } from './foundation';
import { EXTRACTOR_VERSION } from './version';
import type { YamlValue } from './yaml';
import type { IntermediateSpec } from './extract';
import type { AnatomyPart } from './anatomy';
import type { ProseDrafts } from './prose/prompt';
import type { TokenRule } from './tokens';
import { detectStateMatrix, stateAxisProps } from './statesMatrix';

/** Brief schema version. Bumped when the brief's shape or field meanings
 *  change, independently of EXTRACTOR_VERSION. */
export const BRIEF_VERSION = 1;

function envelope(kind: 'component' | 'foundation', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/** A resolved value flattened to what a consumer can act on. */
function valueOf(v: FoundationValue): YamlValue {
  switch (v.kind) {
    case 'color': return v.alpha === 1 ? v.hex : { hex: v.hex, alpha: v.alpha };
    case 'number': return v.value;
    case 'string': return v.value;
    case 'boolean': return v.value;
    case 'alias':
      return {
        alias: v.targetName,
        resolved: v.resolved ? valueOf(v.resolved) : undefined,
        external: v.external ? true : undefined,
      };
    case 'unresolved': return { unresolved: v.reason };
  }
}

function tokenOf(variable: FoundationVariable, modeName: (id: string) => string | undefined): YamlValue {
  const values: Record<string, YamlValue> = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    // A modeId with no entry in collection.modes is stale (its mode was
    // deleted after this value was recorded). Drop the column rather than
    // keying it by the raw Figma modeId: this payload's rule is that internal
    // ids stay inside, matching how unitContent() in foundation.ts drops a
    // stale mode id instead of producing a blank or id-keyed column.
    const name = modeName(modeId);
    if (name === undefined) continue;
    values[name] = valueOf(value);
  }
  const code = Object.keys(variable.codeSyntax).length > 0 ? variable.codeSyntax : undefined;
  return {
    name: variable.name,
    type: variable.resolvedType.toLowerCase(),
    description: variable.description || undefined,
    code: code as YamlValue,
    values,
  };
}

export interface FoundationBriefOptions {
  generatedAt: string;
  /**
   * AI-written group descriptions, read from the foundation doc links on canvas
   * and keyed by collection name, then folder path. Nested rather than flat
   * because two collections can each hold a folder of the same name, which a
   * flat map would silently collapse into one entry.
   *
   * Partial by nature: copyFoundationBrief deliberately covers the whole file
   * while a foundation doc may cover one scope, and a file may have no
   * foundation doc at all. Never generated here, only passed through from
   * storage.
   */
  groupDescriptions?: Record<string, Record<string, string>>;
}

export function foundationBrief(
  foundation: FoundationSpec,
  opts: FoundationBriefOptions,
): YamlValue {
  // A collection whose map is present but empty contributes nothing, and
  // letting it through would emit a guidelines block containing an empty
  // object.
  const descriptions = Object.fromEntries(
    Object.entries(opts.groupDescriptions ?? {})
      .filter(([, folders]) => Object.keys(folders).length > 0),
  );
  const hasDescriptions = Object.keys(descriptions).length > 0;
  return {
    spec_layer: envelope('foundation', opts.generatedAt),
    source: { file: foundation.fileKey },
    collections: foundation.collections.map((c) => {
      const byId = new Map(c.modes.map((m) => [m.modeId, m.name]));
      // Same staleness class as unitContent() in foundation.ts: a mode can be
      // deleted after a value or a defaultModeId referencing it was recorded.
      // Falling back to the raw modeId would leak a Figma-internal id into a
      // payload whose stated rule is that ids stay inside, so an unresolved
      // id resolves to undefined instead — dropped from `values` in tokenOf,
      // and omitted from `default_mode` here (the YAML emitter drops
      // undefined-valued keys), narrowing the brief rather than misreporting it.
      const modeName = (id: string): string | undefined => byId.get(id);
      return {
        name: c.name,
        modes: c.modes.map((m) => m.name),
        default_mode: modeName(c.defaultModeId),
        tokens: c.variables.map((v) => tokenOf(v, modeName)),
      };
    }),
    text_styles: foundation.textStyles.map((t) => ({
      name: t.name,
      font: { family: t.fontFamily, style: t.fontStyle, size: t.fontSize },
      line_height: { unit: t.lineHeight.unit, value: t.lineHeight.value },
      letter_spacing: { unit: t.letterSpacing.unit, value: t.letterSpacing.value },
    })),
    ...(hasDescriptions
      ? { guidelines: { origin: 'generated', group_descriptions: descriptions } }
      : {}),
  };
}

export interface ComponentBriefOptions {
  generatedAt: string;
  /** Resolves token names to concrete values. Absent on the drift path, which
   *  calls extract() without one; bindings then omit `resolved`, `mode` (and
   *  `code`) rather than implying the token has none. */
  foundation?: FoundationSpec;
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
  children: AnatomyBuildNode[];
}

function stripEmptyChildren(n: AnatomyBuildNode): YamlValue {
  return {
    part: n.part,
    type: n.type,
    component: n.component,
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
    const node: AnatomyBuildNode = { part: p.name, type: p.type, component: p.component, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= p.depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: p.depth, node });
  }
  return roots.map(stripEmptyChildren);
}

/**
 * Guidelines read from storage, passed through verbatim. Renamed to the
 * brief's snake_case convention; nothing here is generated.
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
 * rather than leaking a `guidelines: {}` line.
 */
function guidelinesOf(prose: ProseDrafts | null | undefined): YamlValue | undefined {
  if (!prose) return undefined;
  const result: Record<string, YamlValue | undefined> = {
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
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
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
  return `${t.path} ${t.property} ${t.token} ${canon}`;
}

/**
 * Look a token name up in the foundation, at its OWNING COLLECTION's default
 * mode. Mirrors the lookup resolveTokenColor performs in contrast.ts: walk
 * every collection's variables for a name match, then read that collection's
 * own defaultModeId (not some fixed mode) since the token can live in any
 * collection.
 *
 * Naming the mode is not decoration. `layout` reports the geometry a frame
 * actually renders, under whatever mode is applied on canvas; this reads the
 * owning collection's DEFAULT mode. On a themed file those can differ, and an
 * earlier version of this brief emitted both numbers with nothing saying they
 * were read under different conditions -- the sample Button claimed radius 4
 * in `layout` and rd-sm resolving to 8 in `tokens`, at the same time, with no
 * way for a reader to know why.
 *
 * The shape is flat -- `alias`/`resolved`/`code`/`mode` as siblings -- rather
 * than nesting `valueOf`'s own alias/scalar split inside a `value` key, since
 * that extra level carried no information: an alias already returns
 * `{ alias, resolved }` from `valueOf`, and every other kind is a bare value
 * that just needs a name (`resolved`) to sit under next to `mode` and `code`.
 * A raw value of `kind: 'alias'` is special-cased here rather than routed
 * through `valueOf` for that branch, specifically so `resolved` lands as its
 * OWN sibling key instead of nested a second time under a `value.resolved`
 * that no longer exists.
 *
 * Returns an empty object — not nulls — when there is no foundation or the
 * token isn't found, so `binding` below can spread the result straight into
 * the output and have every field come out simply absent rather than a
 * `null` that would misstate "resolved to nothing" as "no such value".
 *
 * Every optional field is added conditionally (`...(cond ? { k: v } : {})`)
 * rather than written as `{ k: v }` with `v` possibly `undefined`. Both forms
 * emit identically once run through the YAML emitter, which drops
 * `undefined`-valued keys -- but a caller that inspects the raw object
 * (`'mode' in used`, as a test below does for a deleted mode) sees a
 * genuinely-missing key only with the conditional form, since
 * `{ mode: undefined }` still satisfies `'mode' in obj`.
 */
function lookupToken(
  foundation: FoundationSpec | undefined,
  token: string,
): { alias?: string; resolved?: YamlValue; external?: boolean; code?: YamlValue; mode?: string } {
  if (!foundation) return {};
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== token) continue;
      const raw = variable.valuesByMode[collection.defaultModeId];
      const code = Object.keys(variable.codeSyntax).length > 0 ? variable.codeSyntax : undefined;
      // A modeId with no entry in collection.modes is stale (its mode was
      // deleted after this value was recorded) -- same staleness class the
      // foundation brief's tokenOf/modeName already handle. Falling back to
      // the raw Figma modeId would leak an internal id into a payload whose
      // rule is that ids stay inside, so an unresolved mode name is left out
      // of the result entirely rather than emitted blank or id-keyed.
      const modeName = collection.modes.find((m) => m.modeId === collection.defaultModeId)?.name;
      const shared: { code?: YamlValue; mode?: string } = {
        ...(code !== undefined ? { code: code as YamlValue } : {}),
        ...(modeName !== undefined ? { mode: modeName } : {}),
      };
      if (!raw) return shared;
      if (raw.kind === 'alias') {
        const resolved = raw.resolved ? valueOf(raw.resolved) : undefined;
        return {
          alias: raw.targetName,
          ...(resolved !== undefined ? { resolved } : {}),
          ...(raw.external ? { external: true } : {}),
          ...shared,
        };
      }
      return { resolved: valueOf(raw), ...shared };
    }
  }
  return {};
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
function tokensOf(spec: IntermediateSpec, foundation: FoundationSpec | undefined): YamlValue {
  const seen = new Set<string>();
  const rules: TokenRule[] = [];
  for (const t of spec.tokens) {
    const key = ruleKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(t);
  }

  // First-use order, so reading top to bottom introduces a token before the
  // bindings that reference it.
  const used: Record<string, YamlValue> = {};
  for (const r of rules) {
    if (r.token in used) continue;
    used[r.token] = lookupToken(foundation, r.token) as YamlValue;
  }

  return {
    used,
    bindings: rules.map((r) => ({
      path: r.path,
      property: r.property,
      token: r.token,
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
 * naming `text`/`instanceSwap` explicitly: an earlier version of this
 * function did name them explicitly and silently dropped both from the
 * brief (both `button.json` and `chip.json` declare a `text` prop named
 * `Label` that vanished as a result). Defining the fourth group by exclusion
 * means a future fifth `PropKind` surfaces here too, instead of vanishing
 * the same way.
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
 * Every text style this component binds, resolved to the metrics an
 * implementation needs.
 *
 * v1 emitted only the display string, which made typography the one binding
 * shape that carried no value and no code: nothing downstream could act on
 * it, and an implementation could not produce CSS from a string like
 * "Button/L : 14px Medium".
 *
 * `source_name` keeps the raw Figma style name, stray double spaces
 * included, because that string is what a designer searches for in the
 * file — it is never normalised.
 *
 * Known gap: `font_style` is a Figma style name ("Medium", "Bold"), not a
 * numeric weight. A consumer that needs a numeric CSS `font-weight` has to
 * map the name itself; this block does not do that mapping.
 *
 * `line_height.value` is added conditionally, not assigned `undefined`:
 * `lineHeight.unit` can be `AUTO` with no numeric value at all (the style
 * inherits the renderer's default line height from the font), and a
 * fabricated 0 or a silently-dropped-by-YAML `undefined` would both misstate
 * that as a real, measured value. Leaving the key off entirely is the
 * truthful reading: "this style does not specify a line height", which is
 * exactly what AUTO means.
 */
function typographyOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.property === 'typography').map((t) => t.token));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const style = foundation?.textStyles.find((s) => s.name === name);
    if (!style) {
      // Bound in the file but absent from this dump: a published library
      // style, or a foundation read that did not cover it. Unresolved, never
      // absent -- dropping it would make the brief claim the label has no
      // typography at all.
      out[name] = { unresolved: 'not in this file' };
      continue;
    }
    out[name] = {
      source_name: style.name,
      font_family: style.fontFamily,
      font_style: style.fontStyle,
      font_size: style.fontSize,
      line_height: {
        unit: style.lineHeight.unit,
        ...(style.lineHeight.value !== undefined ? { value: style.lineHeight.value } : {}),
      },
      letter_spacing: { unit: style.letterSpacing.unit, value: style.letterSpacing.value },
    };
  }
  return out;
}

/**
 * The public component brief: everything about one component, including its
 * token bindings. `spec` is the extractor's internal IntermediateSpec; this
 * is a PROJECTION of it, not a dump — see the file header.
 */
export function componentBrief(spec: IntermediateSpec, opts: ComponentBriefOptions): YamlValue {
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
  const bound = new Set(spec.tokens.map((t) => `${t.path} ${t.property}`));
  const unbound = spec.gaps
    .filter((g) => !bound.has(`${g.path} ${g.property}`))
    .map((g) => ({
      path: g.path, property: g.property, issue: g.issue,
      ...(g.value !== undefined ? { value: g.value } : {}),
    }));
  const typography = typographyOf(spec, opts.foundation);
  return {
    spec_layer: envelope('component', opts.generatedAt),
    source: {
      file: spec.figmaFile,
      node: spec.figmaNode,
      component_key: spec.figmaKey || undefined,
    },
    component: {
      name: spec.name,
      related: spec.related.length > 0 ? spec.related : undefined,
    },
    ...(api !== undefined ? { api } : {}),
    anatomy: nestAnatomy(spec.anatomy),
    layout: spec.layout.length > 0
      ? spec.layout.map((l) => ({ part: l.part, summary: l.summary }))
      : undefined,
    tokens: tokensOf(spec, opts.foundation),
    // Same reasoning as `api` above: spread the key in only when a gap
    // survived reconciliation, rather than assigning `unbound: undefined` —
    // `{ key: undefined }` still leaves `'unbound' in brief` true.
    ...(unbound.length > 0 ? { unbound } : {}),
    ...(typography !== undefined ? { typography } : {}),
    guidelines: guidelinesOf(opts.prose),
  };
}

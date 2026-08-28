/**
 * brief.ts — the public YAML brief projections.
 *
 * These are the product's only export contract now that Markdown is retired,
 * so they are deliberately a PROJECTION of the internal types rather than a
 * dump of them: the legacy component/foundation-v4 projections keep internal
 * ids, minimized token conditions, and rendering concerns inside, and their
 * shapes stay stable while the extractor's internals change. Foundation v5 is
 * a separate direct export whose contract intentionally includes stable ids.
 */

import type { FoundationSpec, FoundationValue, FoundationVariable } from './foundation';
import { roundN } from './effects';
import type { EffectLayer } from './effects';
import { EXTRACTOR_VERSION } from './version';
import type { YamlValue } from './yaml';
import type { IntermediateSpec } from './extract';
import type { AnatomyPart } from './anatomy';
import type { ProseDrafts } from './prose/prompt';
import type { TokenRule } from './tokens';
import type { RefIdentity, RefKind } from './tree';
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

function envelope(kind: 'component' | 'foundation', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/**
 * The `file_key` entry for a source block, or nothing at all.
 *
 * `resolveFileKey` (plugin `fileKey.ts`) returns the literal string 'unknown'
 * when Figma exposes no file key and the user set no override. A consumer
 * cannot tell that apart from a real key, so an unavailable key is emitted as
 * an ABSENT key rather than as a placeholder value. Shared by both briefs so
 * the two source blocks cannot drift apart on what "unavailable" means.
 */
function fileKeyOf(fileKey: string): { file_key?: string } {
  return fileKey && fileKey !== 'unknown' ? { file_key: fileKey } : {};
}

/** A resolved value flattened to what a consumer can act on. */
function valueOf(v: FoundationValue): YamlValue {
  switch (v.kind) {
    case 'color':
      // Four decimals on alpha. Figma stores it as a double derived from a
      // percentage input, so 4% arrives as 0.03999999910593033 and an agent
      // reproduces that verbatim in generated CSS. Two decimals is not enough:
      // 0.04, 0.08 and 0.12 survive it, but Figma's own percent field can
      // express 0.125.
      return v.alpha === 1 ? v.hex : { hex: v.hex, alpha: roundN(v.alpha, 4) };
    case 'number': return v.value;
    case 'string': return v.value;
    case 'boolean': return v.value;
    case 'alias':
      return {
        alias: v.targetName,
        // Conditional spreads throughout, not plain `key: cond ? x : undefined`
        // assignments: a test inspects this raw object with `'key' in value`
        // before any YAML round trip (the emitter would drop an undefined value
        // either way, but the raw object would still have the key), so only the
        // spread form leaves an absent field genuinely absent.
        ...(v.resolved ? { resolved: valueOf(v.resolved) } : {}),
        ...(v.external ? { external: true } : {}),
        // The alias's target collection, on EXTERNAL aliases only. An external
        // alias prints a name that may also exist locally as a different token,
        // with nothing to separate them; a local alias already resolves, so
        // naming its collection adds a line without adding information.
        // Omitted when readCollectionName yielded '', because a blank name is
        // not a name.
        ...(v.external && v.targetCollection ? { collection: v.targetCollection } : {}),
      };
    case 'unresolved': return { unresolved: v.reason };
  }
}

function tokenOf(variable: FoundationVariable, modeName: (id: string) => string | undefined): YamlValue {
  const values: Record<string, YamlValue> = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    // A modeId with no entry in collection.modes is stale (its mode was
    // deleted after this value was recorded). Drop the column rather than
    // keying it by the raw Figma modeId: this legacy foundation-v4 payload's
    // rule is that internal ids stay inside, matching how unitContent() in
    // foundation.ts drops a stale id instead of producing an id-keyed column.
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

/**
 * What a narrowed copy covers, stated rather than implied by an empty container.
 *
 * Derived from `narrowedTo`, which narrowFoundation stamps, so
 * copyFoundationBriefForScope gets a scope block and copyFoundationBrief does
 * not without either caller passing anything extra. Neither changes WHAT it
 * covers: copyFoundationBrief still deliberately ignores the scope selection
 * that document generation respects.
 */
function scopeOf(foundation: FoundationSpec): YamlValue | undefined {
  const target = foundation.narrowedTo;
  if (!target) return undefined;
  if (target.target === 'textStyles') {
    return { collections: 'excluded', text_styles: 'included', effect_styles: 'excluded' };
  }
  return {
    collections: foundation.collections.map((c) => c.name),
    text_styles: 'excluded',
    effect_styles: 'excluded',
  };
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
  const source = fileKeyOf(foundation.fileKey);
  const scope = scopeOf(foundation);
  return {
    spec_layer: envelope('foundation', opts.generatedAt),
    // Omitted ENTIRELY when Figma exposes no file key. fileKeyOf already refuses
    // to emit the literal 'unknown'; spreading its empty result into a key
    // anyway produced `source: {}`, and an empty container reads as a measured
    // verdict rather than as an absence.
    ...(Object.keys(source).length > 0 ? { source } : {}),
    // Present only on a narrowed copy. A whole-file copy covers everything, so
    // there is nothing to state.
    ...(scope !== undefined ? { scope } : {}),
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
    // Omitted when empty, for the reason `source` is: `text_styles: []` reads as
    // "this file has no text styles" when it means "this copy does not cover
    // them", and narrowFoundation sets exactly that on every scoped copy.
    ...(foundation.textStyles.length > 0
      ? { text_styles: foundation.textStyles.map((t) => ({
          name: t.name,
          font: { family: t.fontFamily, style: t.fontStyle, size: t.fontSize },
          line_height: { unit: t.lineHeight.unit, value: t.lineHeight.value },
          letter_spacing: { unit: t.letterSpacing.unit, value: t.letterSpacing.value },
        })) }
      : {}),
    ...(foundation.effectStyles.length > 0
      ? { effect_styles: foundation.effectStyles.map((s) => ({
          name: s.name,
          description: s.description || undefined,
          // Style layers are never resolved with bindings today (see
          // RawEffectStyle in foundation.ts), so this is a no-op in practice --
          // routed through the same projection as effects_inline anyway, since
          // the type still allows a `bindings` key and the id-leak rule admits
          // no exceptions.
          effects: projectEffectLayers(s.effects),
        })) }
      : {}),
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
 * brief's snake_case convention; nothing here is written by this function.
 *
 * `origin: 'generated'` leads the block, the same marker foundationBrief
 * stamps on its own guidelines. The prose in here is the only model-written
 * content in either brief, so one marked block is the whole generated-content
 * boundary and a consumer needs no per-field annotation to find it.
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
  ref: RefIdentity,
): { alias?: string; resolved?: YamlValue; external?: boolean; code?: YamlValue; mode?: string } {
  // Variables only. A style name has no entry in any collection, so walking
  // them for one was the lookup whose empty result used to be emitted as `{}`.
  if (!foundation || ref.kind !== 'variable') return {};
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== ref.name) continue;
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
/** (name, kind) is the join identity between `used` and `bindings`. Two
 *  references sharing a name are two entries; the same reference bound in five
 *  places is one. */
const usedKey = (r: TokenRule): string => JSON.stringify([r.kind, r.name]);

function tokensOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
  definedNames: (kind: RefKind) => Set<string>,
): YamlValue {
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

    // A style entry is a POINTER, not a copy: the definitions live in
    // `typography:` and `effects:`, so restating them here would give the brief
    // two owners for the same values.
    if (r.kind === 'text-style' || r.kind === 'effect-style') {
      used.push(definedNames(r.kind).has(r.name)
        ? { token: r.name, kind: r.kind }
        : { token: r.name, kind: r.kind, resolution: resolutionOf(foundation, r) as unknown as YamlValue });
      continue;
    }

    const looked = lookupToken(foundation, r);
    used.push(Object.keys(looked).length > 0
      ? { token: r.name, kind: r.kind, ...looked }
      : { token: r.name, kind: r.kind, resolution: resolutionOf(foundation, r) as unknown as YamlValue });
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
    spec.tokens.filter((t) => t.kind === 'text-style').map((t) => t.name));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const style = foundation?.textStyles.find((s) => s.name === name);

    if (!style) {
      // Restated in the resolution vocabulary rather than as its own ad-hoc
      // sentence, so `typography` and `tokens.used` cannot disagree about what
      // "not in this file" means. The rule is looked up rather than
      // reconstructed from the name, so the resolution reads Figma's own
      // `remote` and reports `external` where that is the real cause.
      const ref = spec.tokens.find((t) => t.kind === 'text-style' && t.name === name)!;
      out[name] = { resolution: resolutionOf(foundation, ref) as unknown as YamlValue };
      continue;
    }
    out[name] = {
      source_name: style.name,
      font_family: style.fontFamily,
      font_style: style.fontStyle,
      font_size: roundN(style.fontSize, 2),
      line_height: {
        unit: style.lineHeight.unit,
        ...(style.lineHeight.value !== undefined ? { value: roundN(style.lineHeight.value, 2) } : {}),
      },
      letter_spacing: { unit: style.letterSpacing.unit, value: roundN(style.letterSpacing.value, 2) },
    };
  }
  return out;
}

/**
 * Every effect style this component binds, resolved to its layers.
 *
 * Beside `typography:` and for the same reason: `tokens.used` carries the kind
 * and this block carries the definition, so the brief has exactly one owner for
 * the values. Keyed by style name, which is the join key `used` and `bindings`
 * both carry.
 *
 * `source_name` keeps the raw Figma style name, stray double spaces included,
 * because that string is what a designer searches for in the file.
 */
function effectsOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.kind === 'effect-style').map((t) => t.name));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const style = foundation?.effectStyles.find((s) => s.name === name);
    if (!style) {
      const ref = spec.tokens.find((t) => t.kind === 'effect-style' && t.name === name)!;
      out[name] = { resolution: resolutionOf(foundation, ref) as unknown as YamlValue };
      continue;
    }
    out[name] = {
      source_name: style.name,
      description: style.description || undefined,
      // Same source as foundationBrief's effect_styles (foundation.effectStyles),
      // so bindings is never populated here either -- projected anyway for the
      // same reason: the type allows it, and the id-leak rule admits no
      // exceptions.
      layers: projectEffectLayers(style.effects),
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
  const effects = effectsOf(spec, opts.foundation);
  // The definitions this brief actually carries, so `tokens.used` knows whether
  // a style entry is a pointer to something real or needs a resolution instead.
  const definedNames = (kind: RefKind): Set<string> => new Set(
    kind === 'text-style'
      ? (opts.foundation?.textStyles ?? []).map((s) => s.name)
      : (opts.foundation?.effectStyles ?? []).map((s) => s.name),
  );
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
  // The geometry-token-mismatch finding needs each bound token's resolved
  // NUMBER, at the same mode `tokens.used` already reports it under (via
  // lookupToken) -- not re-resolved by validate.ts itself, so the finding and
  // the brief's own `tokens` block can never disagree about what a token
  // resolves to.
  const resolved = new Map<string, number>();
  for (const t of spec.tokens) {
    const looked = lookupToken(opts.foundation, t);
    const v = looked.resolved;
    if (typeof v === 'number') {
      resolved.set(t.name, v);
    } else if (v && typeof v === 'object' && 'resolved' in v
               && typeof (v as { resolved?: unknown }).resolved === 'number') {
      // One level of alias-of-alias: lookupToken flattens a single alias hop
      // into a bare number, but a chain (alias -> alias -> number) still
      // leaves one nested `resolved` key here.
      resolved.set(t.name, (v as { resolved: number }).resolved);
    }
  }
  // Projected into fresh literal objects rather than embedding `Finding[]`
  // directly: `Finding` is a declared interface, and TypeScript will not
  // assign a declared (non-literal) type to YamlValue's index-signature
  // branch even when every field is structurally a YamlValue -- the same
  // reason every other block in this file is built as a fresh object/array
  // literal rather than a typed internal shape passed through as-is.
  const validation = validate(spec, resolved).map((f) => ({
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
      // Same two fixes as foundationBrief's source above: a file KEY no longer
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
    tokens: tokensOf(spec, opts.foundation, definedNames),
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

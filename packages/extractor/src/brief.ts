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

function tokenOf(variable: FoundationVariable, modeName: (id: string) => string): YamlValue {
  const values: Record<string, YamlValue> = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    values[modeName(modeId)] = valueOf(value);
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

export function foundationBrief(foundation: FoundationSpec, generatedAt: string): YamlValue {
  return {
    spec_layer: envelope('foundation', generatedAt),
    source: { file: foundation.fileKey },
    collections: foundation.collections.map((c) => {
      const byId = new Map(c.modes.map((m) => [m.modeId, m.name]));
      const modeName = (id: string) => byId.get(id) ?? id;
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
  };
}

export interface ComponentBriefOptions {
  generatedAt: string;
  /** Resolves token names to concrete values. Absent on the drift path, which
   *  calls extract() without one; bindings then omit `value` rather than
   *  implying the token has none. Unused until Task 7 wires token bindings
   *  into this brief; kept on the options shape now so callers don't need to
   *  change their call site when that lands. */
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

/**
 * The public component brief: everything about one component except its
 * token bindings (Task 7 adds those). `spec` is the extractor's internal
 * IntermediateSpec; this is a PROJECTION of it, not a dump — see the file
 * header.
 */
export function componentBrief(spec: IntermediateSpec, opts: ComponentBriefOptions): YamlValue {
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
    api: spec.props.map((p) => ({
      name: p.name,
      kind: p.kind,
      options: p.options,
      default: p.default,
    })),
    axes: spec.variants.length > 0
      ? spec.variants.map((v) => ({ prop: v.prop, values: v.values }))
      : undefined,
    states: spec.states.length > 0 ? spec.states : undefined,
    anatomy: nestAnatomy(spec.anatomy),
    layout: spec.layout.length > 0
      ? spec.layout.map((l) => ({ part: l.part, summary: l.summary }))
      : undefined,
    unbound: spec.gaps.length > 0
      ? spec.gaps.map((g) => ({ part: g.part, issue: g.issue }))
      : undefined,
    // Emitted unconditionally, even when findings is empty: `measured` and
    // `skipped` are what distinguish "checked and clean" from "could not
    // check anything", so omitting the block on empty findings would erase
    // that distinction. `evaluated` is renamed to `measured` for readers of
    // the brief, consistently with every other field here.
    contrast: {
      measured: spec.contrast.evaluated,
      skipped: spec.contrast.skipped,
      findings: spec.contrast.findings.map((f) => ({
        part: f.part,
        variant: f.variant,
        foreground: f.foreground,
        background: f.background,
        background_part: f.backgroundPart,
        ratio: f.ratio,
        required: f.required,
      })),
    },
    guidelines: guidelinesOf(opts.prose),
  };
}

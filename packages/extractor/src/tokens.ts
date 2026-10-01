import type { SerializedNode, TokenRef, RefIdentity } from './tree';
import { defaultVariant, hiddenPartRules } from './anatomy';
import { parseVariantName, cleanPartName, walkParts } from './naming';

/**
 * A minimized token rule: `name` applies to `part.property` whenever every
 * conditioned axis matches one of its listed values (empty: every variant).
 * Only axes that determine the value are named.
 */
export interface TokenRule extends RefIdentity {
  part: string;
  /** The join key every consumer uses; `part` is for display only. */
  path: string;
  property: string;
  /** axis -> matching values, axes in variant-name order, values in axis order. */
  conditions: Record<string, string[]>;
  /** The boolean property that shows a part hidden by default; absent, never
   *  undefined, otherwise (as `AnatomyPart.shownBy`). Consumers route through
   *  `tokensFor` rather than reading `spec.tokens` directly. */
  shownBy?: string;
}

/** Stable ids, not prose; the measured number lives in `Gap.value`. */
export type GapIssue = 'hardcoded-value' | 'hardcoded-color' | 'missing-token-binding';

export interface Gap {
  part: string;
  path: string;
  property: string;
  issue: GapIssue;
  value?: number | string;
}

export interface VariantAxisModel {
  variants: SerializedNode[];
  /** Per-variant axis -> value, index-aligned with `variants`. */
  combos: Record<string, string>[];
}

/**
 * The shared axis model for a component (set). If any variant name is not
 * "Axis=Value, ..." shaped, or the axis key-sets disagree, EVERY variant falls
 * back to a pseudo-axis "Variant" holding the raw name.
 *
 * extract() passes one model to extractTokens and toVariantInstances, so rule
 * conditions agree with variant instance `values` and resolveTokensForVariant
 * can match them.
 */
export function variantAxisModel(root: SerializedNode): VariantAxisModel {
  const isInSet = root.type === 'COMPONENT_SET';
  const variants = isInSet ? (root.children ?? []).filter((c) => c.type === 'COMPONENT') : [root];
  if (!isInSet) return { variants, combos: variants.map(() => ({})) };

  const parsed = variants.map((v) => parseVariantName(v.name));
  const first = parsed[0];
  const consistent =
    first != null &&
    parsed.every(
      (p) =>
        p !== null &&
        Object.keys(p).length === Object.keys(first).length &&
        Object.keys(first).every((k) => k in p),
    );
  return {
    variants,
    combos: consistent
      ? (parsed as Record<string, string>[])
      : variants.map((v) => ({ Variant: v.name })),
  };
}

/** "Type=Secondary · Tertiary, State=Hover", or "—" when unconditioned. */
export function formatConditions(conditions: Record<string, string[]>): string {
  const entries = Object.entries(conditions);
  if (!entries.length) return '—';
  return entries.map(([axis, values]) => `${axis}=${values.join(' · ')}`).join(', ');
}

// ---------------------------------------------------------------------------
// Per-node binding normalization
// ---------------------------------------------------------------------------

/**
 * Figma binding property -> CSS-like name. Anything absent passes through
 * unchanged, so a new non-CSS Figma binding target belongs here.
 *
 * Only UNAMBIGUOUS mappings belong. Two must stay out, passed through raw
 * rather than guessed:
 * - `effects`: may be a shadow (`box-shadow`) or a blur (`filter: blur()`),
 *   and this static map cannot see the effect type.
 * - `counterAxisSpacing`: `row-gap` or `column-gap` depending on
 *   `layoutMode`, which is not serialized.
 */
const SIMPLE_PROPERTY_MAP: Record<string, string> = {
  fills: 'fill',
  strokes: 'border',
  cornerRadius: 'border-radius',
  itemSpacing: 'gap',
  fontSize: 'font-size',
  fontFamily: 'font-family',
  fontWeight: 'font-weight',
  fontStyle: 'font-style',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  strokeWeight: 'border-width',
  strokeTopWeight: 'border-top-width',
  strokeRightWeight: 'border-right-width',
  strokeBottomWeight: 'border-bottom-width',
  strokeLeftWeight: 'border-left-width',
  maxWidth: 'max-width',
  minWidth: 'min-width',
  maxHeight: 'max-height',
  minHeight: 'min-height',
};

const RADIUS_PROPS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
const RADIUS_INDIVIDUAL_MAP: Record<string, string> = {
  topLeftRadius: 'border-top-left-radius',
  topRightRadius: 'border-top-right-radius',
  bottomLeftRadius: 'border-bottom-left-radius',
  bottomRightRadius: 'border-bottom-right-radius',
};

/** One binding on any of these means the radius is tokenised. Shared with
 *  rawValues.ts so the gap report and the raw-value table agree. */
export const RADIUS_BINDINGS: ReadonlySet<string> = new Set([
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
]);

const PADDING_RAW_PROPS = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding',
]);

/** Suppressed when a composite `typography` is bound on the same node. */
const TYPOGRAPHY_SUBPROPS = new Set(['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']);

/** The one rename both `normalizeBindings` and `extractGaps` route through,
 *  so a binding and a hardcoded value share one property vocabulary. */
const simpleProperty = (raw: string): string => SIMPLE_PROPERTY_MAP[raw] ?? raw;

/**
 * `padding` when all four sides agree, `padding-x`/`padding-y` when a pair
 * agrees, else the individual sides. Shared by `normalizeBindings` (refs) and
 * `extractGaps` (numbers) so a gap and a binding on the same shape land on the
 * same property name.
 */
function paddingSides<T>(
  top: T[], right: T[], bottom: T[], left: T[],
  key: (v: T) => string = String,
): Array<{ property: string; value: T }> {
  const single = (xs: T[]): T | null => (xs.length === 1 ? xs[0] : null);
  const sameKey = (a: T[], b: T[]): boolean => {
    const x = single(a), y = single(b);
    return x !== null && y !== null && key(x) === key(y);
  };
  const sides = [top, right, bottom, left];
  const out: Array<{ property: string; value: T }> = [];
  // Compared through `key`: four sides bound to ONE variable are four objects.
  if (sides.every((s) => single(s) !== null)
      && new Set(sides.map((s) => key(single(s)!))).size === 1) {
    out.push({ property: 'padding', value: single(top)! });
    return out;
  }
  if (left.length && sameKey(left, right)) {
    out.push({ property: 'padding-x', value: single(left)! });
  } else {
    for (const t of left) out.push({ property: 'padding-left', value: t });
    for (const t of right) out.push({ property: 'padding-right', value: t });
  }
  if (top.length && sameKey(top, bottom)) {
    out.push({ property: 'padding-y', value: single(top)! });
  } else {
    for (const t of top) out.push({ property: 'padding-top', value: t });
    for (const t of bottom) out.push({ property: 'padding-bottom', value: t });
  }
  return out;
}

/**
 * Normalize one node's raw bindings:
 * - 4 corner radii sharing a token collapse to `border-radius`
 * - paddings collapse via paddingSides
 * - typography sub-properties are dropped under a composite `typography`
 * - everything else is renamed via SIMPLE_PROPERTY_MAP
 */
function normalizeBindings(raw: TokenRef[]): TokenRef[] {
  // Keyed on (kind, id), not name: two resources sharing a name are two bindings.
  const byProp = new Map<string, TokenRef[]>();
  for (const b of raw) {
    const refs = byProp.get(b.property) ?? [];
    if (!refs.some((r) => r.kind === b.kind && r.id === b.id)) refs.push(b);
    byProp.set(b.property, refs);
  }

  const out: TokenRef[] = [];
  const emit = (property: string, ref: TokenRef) => {
    if (out.some((o) => o.property === property && o.kind === ref.kind && o.id === ref.id)) return;
    // Only the PROPERTY is renamed; the ref keeps its identity.
    out.push({ ...ref, property });
  };

  const radii = RADIUS_PROPS.filter((p) => byProp.has(p));
  const radiusRefs = radii.flatMap((p) => byProp.get(p)!);
  const distinctRadius = new Set(radiusRefs.map((r) => `${r.kind}|${r.id}`));
  if (radii.length === RADIUS_PROPS.length && distinctRadius.size === 1) {
    emit('border-radius', radiusRefs[0]);
  } else {
    for (const p of radii) for (const r of byProp.get(p)!) emit(RADIUS_INDIVIDUAL_MAP[p], r);
  }

  const sideRefs = (...props: string[]) => props.flatMap((p) => byProp.get(p) ?? []);
  for (const { property, value } of paddingSides(
    sideRefs('paddingTop', 'verticalPadding'),
    sideRefs('paddingRight', 'horizontalPadding'),
    sideRefs('paddingBottom', 'verticalPadding'),
    sideRefs('paddingLeft', 'horizontalPadding'),
    (r) => `${r.kind}|${r.id}`,
  )) {
    emit(property, value);
  }

  const hasTypography = byProp.has('typography');
  for (const [prop, refs] of byProp) {
    if (RADIUS_PROPS.includes(prop) || PADDING_RAW_PROPS.has(prop)) continue;
    if (hasTypography && TYPOGRAPHY_SUBPROPS.has(prop)) continue;
    const mapped = simpleProperty(prop);
    for (const r of refs) emit(mapped, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule minimization
// ---------------------------------------------------------------------------

/** What makes two bindings the same: kind and id, never the name, which two
 *  resources (a variable and an effect style both "Elevation/1") can share. */
const refKey = (r: RefIdentity): string => `${r.kind}|${r.id}`;

/**
 * "This part/property does not exist in this variant", backfilled so absence
 * takes part in difference-detection; dropped before output. A plain word, not
 * a control character (see check:nul), and safe because a refKey always has a
 * `|`.
 */
const ABSENT_KEY = 'absent';

/** In the variant `combo`, the part/property carries the references `keys`. */
interface Cell {
  combo: Record<string, string>;
  keys: string[]; // sorted refKeys, or exactly [ABSENT_KEY]
}

/** One reference plus conditioned axes mapped to accepted value sets. */
interface DraftRule {
  key: string;
  values: Map<string, Set<string>>;
}

export function extractTokens(root: SerializedNode, model?: VariantAxisModel): TokenRule[] {
  const isInSet = root.type === 'COMPONENT_SET';
  // Shared with toVariantInstances; see variantAxisModel.
  const { variants, combos } = model ?? variantAxisModel(root);
  if (!variants.length) return [];

  const axisOrder: string[] = [];
  const observedValues = new Map<string, string[]>();
  for (const combo of combos) {
    for (const [axis, value] of Object.entries(combo)) {
      let vals = observedValues.get(axis);
      if (!vals) {
        axisOrder.push(axis);
        observedValues.set(axis, (vals = []));
      }
      if (!vals.includes(value)) vals.push(value);
    }
  }
  // Declared variantOptions order when available, else first-seen order.
  const axisValues = new Map<string, string[]>();
  for (const axis of axisOrder) {
    const obs = observedValues.get(axis)!;
    const declared = root.propertyDefinitions?.[axis]?.variantOptions;
    axisValues.set(
      axis,
      declared ? [...declared.filter((v) => obs.includes(v)), ...obs.filter((v) => !declared.includes(v))] : obs,
    );
  }

  // --- Collect the observation grid ----------------------------------------
  // Grouped by (path, property): `part` is unique only among siblings. The key
  // is JSON, not separator-joined: a safe separator would have to be a NUL or
  // SOH, invisible in a diff. JSON escapes its components.
  const gridKey = (path: string, property: string): string => JSON.stringify([path, property]);

  const cellsByPathProp = new Map<string, Cell[]>();
  const pathOrder: string[] = [];
  const propOrder = new Map<string, string[]>();
  const partByPath = new Map<string, string>();
  /** path -> the boolean property that reveals it. First observation wins:
   *  the visibility binding lives on the set, so every variant agrees. */
  const shownByPath = new Map<string, string>();
  // "Hidden but documentable", shared with anatomy.ts: the walk prunes only
  // subtrees no boolean property could reveal.
  const hidden = hiddenPartRules(root);
  /** Every reference seen, by refKey, to rebuild a rule's full identity at
   *  emit time. Overwriting is a no-op: same (kind, id), same resource. */
  const refsByKey = new Map<string, RefIdentity>();

  variants.forEach((variant, idx) => {
    const combo = combos[idx];
    // Outer key gridKey, inner key refKey.
    const variantRefs = new Map<string, Map<string, RefIdentity>>();
    // Which property reveals each node in THIS variant, inherited down the
    // tree: a visible glyph inside a hidden container is hidden in practice.
    // Resolved by node, not path prefix, to avoid re-parsing escaped paths.
    const shownByNode = new Map<SerializedNode, string>();
    const markHidden = (n: SerializedNode, inherited: string | undefined): void => {
      const own = hidden.shownBy(n) ?? inherited;
      if (own !== undefined) shownByNode.set(n, own);
      for (const child of n.children ?? []) markHidden(child, own);
    };
    for (const child of variant.children ?? []) markHidden(child, undefined);

    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part, path) => {
      const shownBy = shownByNode.get(n);
      if (shownBy !== undefined && !shownByPath.has(path)) shownByPath.set(path, shownBy);
      for (const ref of normalizeBindings(n.bindings ?? [])) {
        const key = gridKey(path, ref.property);
        partByPath.set(path, part);
        // Without `property`: toTokenRule spreads this after setting its own
        // `property`, and a leftover one would win the spread.
        const { property: _property, ...identity } = ref;
        let inner = variantRefs.get(key);
        if (!inner) variantRefs.set(key, (inner = new Map()));
        const rk = refKey(ref);
        inner.set(rk, identity);
        refsByKey.set(rk, identity);
      }
    }, hidden.prune);
    for (const [key, inner] of variantRefs) {
      let cells = cellsByPathProp.get(key);
      if (!cells) {
        cellsByPathProp.set(key, (cells = []));
        const [path, prop] = JSON.parse(key) as [string, string];
        if (!propOrder.has(path)) {
          pathOrder.push(path);
          propOrder.set(path, []);
        }
        propOrder.get(path)!.push(prop);
      }
      cells.push({ combo, keys: [...inner.keys()].sort() });
    }
  });

  // Presence is JOINT over a full combo: a part absent at (X=1,Y=p) can still
  // span every value per axis, which relevantAxes' per-axis test cannot see,
  // so the rule would claim a binding on a variant without the part. An
  // explicit ABSENT cell makes absence just another value. Cells hold combo
  // objects from `combos` by reference, so identity works here.
  for (const cells of cellsByPathProp.values()) {
    const present = new Set(cells.map((c) => c.combo));
    for (const combo of combos) {
      if (!present.has(combo)) cells.push({ combo, keys: [ABSENT_KEY] });
    }
  }

  // --- Minimize each (part, property) grid into rules -----------------------
  // JSON keys, as for gridKey: an axis value is whatever a designer typed.
  const cellKey = (c: Cell) => JSON.stringify(c.keys);
  const projKey = (combo: Record<string, string>, axes: string[]) =>
    JSON.stringify(axes.map((a) => combo[a]));

  /** Axes whose value (or whose presence pattern) affects this property. */
  const relevantAxes = (cells: Cell[]): string[] => {
    const relevant: string[] = [];
    for (const axis of axisOrder) {
      // Presence: the part/property only exists for a subset of this axis's values.
      const present = new Set(cells.map((c) => c.combo[axis]));
      if (present.size < axisValues.get(axis)!.length) {
        relevant.push(axis);
        continue;
      }
      // Value difference: two variants differing only in this axis carry different tokens.
      const others = axisOrder.filter((a) => a !== axis);
      const groups = new Map<string, string>();
      for (const c of cells) {
        const gk = projKey(c.combo, others);
        const tk = cellKey(c);
        const prev = groups.get(gk);
        if (prev === undefined) groups.set(gk, tk);
        else if (prev !== tk) {
          relevant.push(axis);
          break;
        }
      }
    }
    return relevant;
  };

  const hasConflict = (cells: Cell[], axes: string[]): boolean => {
    const m = new Map<string, string>();
    for (const c of cells) {
      const k = projKey(c.combo, axes);
      const tk = cellKey(c);
      const prev = m.get(k);
      if (prev === undefined) m.set(k, tk);
      else if (prev !== tk) return true;
    }
    return false;
  };

  const buildRules = (cellsIn: Cell[]): DraftRule[] => {
    let cells = cellsIn;
    let relevant = relevantAxes(cells);
    // Sparse grids can hide pairwise differences: add axes until the
    // projection is unambiguous.
    for (const axis of axisOrder) {
      if (!hasConflict(cells, relevant)) break;
      if (!relevant.includes(axis)) relevant = axisOrder.filter((a) => relevant.includes(a) || a === axis);
    }

    // A conflict surviving every axis means two variants parse to the SAME
    // combo. Unioning them would invent a binding, so keep the first cell per
    // combo under fully-specific conditions.
    if (hasConflict(cells, relevant)) {
      relevant = [...axisOrder];
      const byCombo = new Map<string, Cell>();
      for (const c of cells) {
        const k = projKey(c.combo, axisOrder);
        if (!byCombo.has(k)) byCombo.set(k, c);
      }
      cells = [...byCombo.values()];
    }

    const groups = new Map<string, { combo: Record<string, string>; keys: Set<string> }>();
    for (const c of cells) {
      const k = projKey(c.combo, relevant);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { combo: c.combo, keys: new Set() }));
      c.keys.forEach((t) => g!.keys.add(t));
    }

    // One candidate rule per (projected combo, key), singleton value sets.
    let rules: DraftRule[] = [];
    for (const g of groups.values()) {
      for (const key of [...g.keys].sort()) {
        rules.push({ key, values: new Map(relevant.map((a) => [a, new Set([g.combo[a]])])) });
      }
    }

    // Merge rules with the same key and identical conditions on every other axis.
    const conditionKey = (r: DraftRule, excludeAxis: string | null) =>
      JSON.stringify(axisOrder
        .filter((a) => a !== excludeAxis)
        .map((a) => (r.values.has(a) ? [...r.values.get(a)!].sort() : null)));
    for (const axis of relevant) {
      const merged = new Map<string, DraftRule>();
      for (const r of rules) {
        const k = JSON.stringify([r.key, conditionKey(r, axis)]);
        const prev = merged.get(k);
        if (prev && prev.values.has(axis) && r.values.has(axis)) {
          r.values.get(axis)!.forEach((v) => prev.values.get(axis)!.add(v));
        } else if (!merged.has(k)) {
          merged.set(k, r);
        }
      }
      rules = [...merged.values()];
    }

    // Drop an axis whose values cover every value observed alongside the
    // rule's other conditions, checked against variants that exist (the grid
    // is sparse), so no nonexistent combo is ever claimed.
    for (const r of rules) {
      for (const axis of [...r.values.keys()]) {
        const vals = r.values.get(axis)!;
        const observed = new Set<string>();
        for (const combo of combos) {
          const matchesOthers = [...r.values.entries()].every(
            ([a, vs]) => a === axis || vs.has(combo[a]),
          );
          if (matchesOthers) observed.add(combo[axis]);
        }
        if ([...observed].every((v) => vals.has(v))) r.values.delete(axis);
      }
    }

    // Dedupe, then drop rules subsumed by a strictly more general rule.
    const seen = new Map<string, DraftRule>();
    for (const r of rules) {
      const k = JSON.stringify([r.key, conditionKey(r, null)]);
      if (!seen.has(k)) seen.set(k, r);
    }
    rules = [...seen.values()];
    rules = rules.filter(
      (r) =>
        !rules.some(
          (other) =>
            other !== r &&
            other.key === r.key &&
            other.values.size < r.values.size &&
            [...other.values.entries()].every(
              ([a, vs]) => r.values.has(a) && [...r.values.get(a)!].every((v) => vs.has(v)),
            ),
        ),
    );
    return rules;
  };

  // --- Finalize: canonical ordering, public shape ----------------------------
  const defaultCombo = combos[0];
  const toTokenRule = (path: string, property: string, r: DraftRule): TokenRule => {
    const conditions: Record<string, string[]> = {};
    for (const axis of axisOrder) {
      const vs = r.values.get(axis);
      if (!vs) continue;
      conditions[axis] = axisValues.get(axis)!.filter((v) => vs.has(v));
    }
    const shownBy = shownByPath.get(path);
    return {
      part: partByPath.get(path)!, path, property, conditions,
      ...refsByKey.get(r.key)!,
      // Absent, never undefined, so `'shownBy' in rule` is a reliable test.
      ...(shownBy !== undefined ? { shownBy } : {}),
    };
  };

  /**
   * Sort fields compared one at a time; a joined key would sort by how the
   * separator compares. Field 4 is the reference's NAME, as a reader expects;
   * field 5, the refKey, breaks ties between references sharing a name.
   */
  const ruleSortKey = (r: DraftRule): string[] => {
    const matchesDefault = [...r.values.entries()].every(([a, vs]) => vs.has(defaultCombo[a]));
    const axisBits = axisOrder
      .map((a, i) => {
        const vs = r.values.get(a);
        if (!vs) return '';
        const indices = axisValues.get(a)!
          .map((v, vi) => (vs.has(v) ? String(vi).padStart(3, '0') : ''))
          .filter(Boolean)
          .join('.');
        return `${i}:${indices}`;
      })
      .filter(Boolean)
      .join('|');
    return [
      matchesDefault ? '0' : '1',
      String(r.values.size).padStart(3, '0'),
      axisBits,
      // An absent rule has no reference and sorts first; it is dropped below.
      refsByKey.get(r.key)?.name ?? '',
      r.key,
    ];
  };

  const compareKeys = (a: string[], b: string[]): number => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };

  const out: TokenRule[] = [];
  for (const path of pathOrder) {
    for (const prop of propOrder.get(path)!) {
      const cells = cellsByPathProp.get(gridKey(path, prop))!;
      const rules = buildRules(cells);
      rules.sort((a, b) => compareKeys(ruleSortKey(a), ruleSortKey(b)));
      for (const r of rules) {
        if (r.key === ABSENT_KEY) continue;
        out.push(toTokenRule(path, prop, r));
      }
    }
  }
  return out;
}

export interface TokensOptions {
  /** Include rules marked `shownBy`. The canvas model and hash pass the doc's
   *  `includeHidden`; the v5 export passes false, having no field to say a
   *  rule is conditional. */
  includeHidden: boolean;
}

/** The one filter every canvas consumer and the canvas hash use. Like
 *  `anatomyFor`, returns the same array when nothing is filtered. */
export function tokensFor(tokens: TokenRule[], options: TokensOptions): TokenRule[] {
  return options.includeHidden ? tokens : tokens.filter((t) => t.shownBy === undefined);
}

// ---------------------------------------------------------------------------
// Extraction gaps (default variant only)
// ---------------------------------------------------------------------------

/** Any of these bound means a TEXT node's typography is governed. */
const TYPOGRAPHY_PROPS = ['typography', 'fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing'];
const PADDING_PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding'];

export function extractGaps(root: SerializedNode): Gap[] {
  const out: Gap[] = [];
  const seenGaps = new Set<string>();
  // Separator is a SPACE, never a NUL byte (see check:nul).
  const pushGap = (part: string, path: string, property: string,
                    issue: GapIssue, value?: number | string) => {
    // Keyed on path, not part, which is unique only among siblings.
    const key = `${path} ${property} ${issue}`;
    if (seenGaps.has(key)) return;
    seenGaps.add(key);
    out.push({ part, path, property, issue, ...(value !== undefined ? { value } : {}) });
  };
  const isInSet = root.type === 'COMPONENT_SET';
  const def = defaultVariant(root);
  walkParts(def, isInSet ? 'Container' : cleanPartName(def.name), (n, part, path) => {
    const bound = new Set((n.bindings ?? []).map((b) => b.property));
    // Property names go through `simpleProperty`, as real bindings do.
    if (n.hasUnboundPaint) {
      pushGap(part, path, simpleProperty('fills'), 'hardcoded-color', n.unboundFill);
    }
    if (n.hasUnboundStroke) {
      pushGap(part, path, simpleProperty('strokes'), 'hardcoded-color', n.unboundStroke);
    }
    if (n.hasUnboundGradient) {
      // No single hex to report for a gradient or image fill.
      pushGap(part, path, simpleProperty('fills'), 'missing-token-binding');
    }
    if (n.hasUnboundEffect) {
      pushGap(part, path, simpleProperty('effects'), 'missing-token-binding');
    }
    if (n.opacity !== undefined && n.opacity !== 1 && !bound.has('opacity')) {
      // Rounded here too, not only in serialize.ts: this is hashed, and node
      // JSON may come from elsewhere. Figma's float32 prints 30% as
      // 0.30000001192092896.
      pushGap(part, path, simpleProperty('opacity'), 'hardcoded-value', Math.round(n.opacity * 10000) / 10000);
    }
    if (n.type === 'TEXT' && !TYPOGRAPHY_PROPS.some((p) => bound.has(p))) {
      pushGap(part, path, simpleProperty('typography'), 'missing-token-binding');
    }
    const l = n.layout;
    if (!l) return;
    if (l.itemSpacing !== undefined && !bound.has('itemSpacing')) {
      pushGap(part, path, simpleProperty('itemSpacing'), 'hardcoded-value', l.itemSpacing);
    }
    if (l.cornerRadius !== undefined && ![...RADIUS_BINDINGS].some((p) => bound.has(p))) {
      pushGap(part, path, simpleProperty('cornerRadius'), 'hardcoded-value', l.cornerRadius);
    }
    if (!PADDING_PROPS.some((p) => bound.has(p))) {
      const side = (v: number | undefined): number[] => (v !== undefined ? [v] : []);
      // Equal numbers stand in for "the same token"; see paddingSides.
      for (const { property, value } of paddingSides(
        side(l.paddingTop), side(l.paddingRight), side(l.paddingBottom), side(l.paddingLeft),
      )) {
        pushGap(part, path, property, 'hardcoded-value', value);
      }
    }
  });
  return out;
}

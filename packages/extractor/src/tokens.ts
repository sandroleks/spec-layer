import type { SerializedNode, TokenRef } from './tree';
import { defaultVariant } from './anatomy';
import { parseVariantName, cleanPartName, walkParts } from './naming';

/**
 * A minimized token rule: `token` applies to `part.property` whenever every
 * conditioned axis matches one of its listed values. An empty `conditions`
 * object means the rule applies to every variant. Conditions only name the
 * axes that actually determine the value — axes that never affect it are
 * never mentioned.
 */
export interface TokenRule {
  part: string;
  property: string;
  /** axis -> matching values, axes in variant-name order, values in axis order. */
  conditions: Record<string, string[]>;
  token: string;
}

export interface Gap { part: string; issue: string }

/** The physical variant nodes of a component (set) plus each one's axis combo. */
export interface VariantAxisModel {
  variants: SerializedNode[];
  /** Per-variant axis -> value, index-aligned with `variants`. */
  combos: Record<string, string>[];
}

/**
 * Compute the shared axis model once for the whole component (set).
 *
 * Variant names parse into axis combos. If any name is not "Axis=Value, ..."
 * shaped (or the axis key-sets disagree across variants), EVERY variant falls
 * back to a single pseudo-axis "Variant" whose value is the raw variant name.
 *
 * Both extractTokens and toVariantInstances (in extract.ts) consume this same
 * model — extract() computes it once and passes it to both — so the
 * conditions on emitted token rules always agree with the `values` recorded on
 * variant instances (and resolveTokensForVariant can match them).
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

/** Render conditions for display: "Type=Secondary · Tertiary, State=Hover", or "—" when unconditioned. */
export function formatConditions(conditions: Record<string, string[]>): string {
  const entries = Object.entries(conditions);
  if (!entries.length) return '—';
  return entries.map(([axis, values]) => `${axis}=${values.join(' · ')}`).join(', ');
}

// ---------------------------------------------------------------------------
// Per-node binding normalization (Figma property names → CSS-like, structural collapses)
// ---------------------------------------------------------------------------

/**
 * Figma binding property -> CSS-like name used in the spec. Anything absent
 * passes through unchanged, which is correct for names that are already CSS
 * (`opacity`, `width`, `height`) and wrong for anything else, so new Figma
 * binding targets belong here rather than leaking a camelCase name into docs.
 *
 * A name earns a place in this table only when the Figma property maps
 * UNAMBIGUOUSLY to one CSS property, with no further information needed to
 * pick it. Two properties that look like they qualify do not, and must stay
 * out:
 * - `effects`: a binding here can carry a drop/inner shadow OR a layer/
 *   background blur. Shadows are `box-shadow`; blurs need `filter: blur()`,
 *   which is a different property entirely. This table is a static string
 *   map with no access to the effect's actual type, so it cannot tell which
 *   one it is looking at, and mislabeling a blur as `box-shadow` tells a
 *   developer to implement the wrong thing.
 * - `counterAxisSpacing`: this is the gap on the axis perpendicular to
 *   `itemSpacing`, which is `row-gap` for a HORIZONTAL auto-layout but
 *   `column-gap` for a VERTICAL one. The answer depends on the node's
 *   `layoutMode`, which this table cannot see (and which isn't even
 *   captured on the serialized node today).
 * Passing these two through as their raw Figma names is less polished but
 * never actively wrong, unlike guessing.
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

const PADDING_RAW_PROPS = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding',
]);

/** Sub-properties of a composite `typography` binding — suppressed when `typography` is bound on the same node. */
const TYPOGRAPHY_SUBPROPS = new Set(['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']);

/**
 * Normalize one node's raw bindings:
 * - 4 corner radii sharing a token collapse to `border-radius`
 * - paddings collapse to `padding` (all 4 equal) or `padding-x`/`padding-y` (pairs equal)
 * - typography sub-properties are dropped when a composite `typography` binding exists
 * - everything else is renamed via SIMPLE_PROPERTY_MAP
 */
function normalizeBindings(raw: TokenRef[]): TokenRef[] {
  const byProp = new Map<string, string[]>();
  for (const b of raw) {
    const tokens = byProp.get(b.property) ?? [];
    if (!tokens.includes(b.token)) tokens.push(b.token);
    byProp.set(b.property, tokens);
  }

  const out: TokenRef[] = [];
  const emit = (property: string, token: string) => {
    if (!out.some((o) => o.property === property && o.token === token)) out.push({ property, token });
  };

  // Corner radii
  const radii = RADIUS_PROPS.filter((p) => byProp.has(p));
  const radiusTokens = new Set(radii.flatMap((p) => byProp.get(p)!));
  if (radii.length === RADIUS_PROPS.length && radiusTokens.size === 1) {
    emit('border-radius', [...radiusTokens][0]);
  } else {
    for (const p of radii) for (const t of byProp.get(p)!) emit(RADIUS_INDIVIDUAL_MAP[p], t);
  }

  // Padding
  const sideTokens = (...props: string[]) => props.flatMap((p) => byProp.get(p) ?? []);
  const top = sideTokens('paddingTop', 'verticalPadding');
  const bottom = sideTokens('paddingBottom', 'verticalPadding');
  const left = sideTokens('paddingLeft', 'horizontalPadding');
  const right = sideTokens('paddingRight', 'horizontalPadding');
  const single = (xs: string[]) => (xs.length === 1 ? xs[0] : null);
  const sides = [top, right, bottom, left];
  if (sides.every((s) => single(s) !== null) && new Set(sides.map((s) => s[0])).size === 1) {
    emit('padding', top[0]);
  } else {
    if (left.length && single(left) !== null && single(left) === single(right)) {
      emit('padding-x', left[0]);
    } else {
      for (const t of left) emit('padding-left', t);
      for (const t of right) emit('padding-right', t);
    }
    if (top.length && single(top) !== null && single(top) === single(bottom)) {
      emit('padding-y', top[0]);
    } else {
      for (const t of top) emit('padding-top', t);
      for (const t of bottom) emit('padding-bottom', t);
    }
  }

  // Everything else
  const hasTypography = byProp.has('typography');
  for (const [prop, tokens] of byProp) {
    if (RADIUS_PROPS.includes(prop) || PADDING_RAW_PROPS.has(prop)) continue;
    if (hasTypography && TYPOGRAPHY_SUBPROPS.has(prop)) continue;
    const mapped = SIMPLE_PROPERTY_MAP[prop] ?? prop;
    for (const t of tokens) emit(mapped, t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule minimization
// ---------------------------------------------------------------------------

/**
 * Marks "this part/property does not exist in this variant". Backfilled into
 * every grid so absence participates in difference-detection like any other
 * value. Never escapes extractTokens: sentinel rules are dropped when the
 * public shape is built.
 *
 * The SOH prefix makes it unspellable as a Figma variable name. It deliberately
 * avoids the NUL that joins composite keys in this file (`${part}\0${property}`
 * and `tokens.join('\0')`), so the sentinel can never be mistaken for a
 * multi-token cell.
 */
const ABSENT = 'ABSENT';

/** One observed data point: in the variant identified by `combo`, the part/property carries `tokens`. */
interface Cell {
  combo: Record<string, string>;
  tokens: string[]; // sorted
}

/** Work-in-progress rule: conditioned axes mapped to accepted value sets. */
interface DraftRule {
  token: string;
  values: Map<string, Set<string>>;
}

export function extractTokens(root: SerializedNode, model?: VariantAxisModel): TokenRule[] {
  const isInSet = root.type === 'COMPONENT_SET';
  // Shared with toVariantInstances — see variantAxisModel's comment for why this
  // isn't just a perf optimization: extract() passes one model to both so the
  // conditions on emitted rules structurally agree with the `values` recorded
  // on variant instances, which resolveTokensForVariant relies on to match them.
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
  // Canonical value order: the component set's declared variantOptions order
  // when available, falling back to first-seen order.
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
  const cellsByPartProp = new Map<string, Cell[]>();
  const partOrder: string[] = [];
  const propOrder = new Map<string, string[]>();

  variants.forEach((variant, idx) => {
    const combo = combos[idx];
    const variantTokens = new Map<string, Set<string>>(); // "part\0prop" -> tokens
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part) => {
      for (const { property, token } of normalizeBindings(n.bindings ?? [])) {
        const key = `${part}\0${property}`;
        let set = variantTokens.get(key);
        if (!set) variantTokens.set(key, (set = new Set()));
        set.add(token);
      }
    }, true);
    for (const [key, tokens] of variantTokens) {
      let cells = cellsByPartProp.get(key);
      if (!cells) {
        cellsByPartProp.set(key, (cells = []));
        const part = key.slice(0, key.indexOf('\0'));
        const prop = key.slice(key.indexOf('\0') + 1);
        if (!propOrder.has(part)) {
          partOrder.push(part);
          propOrder.set(part, []);
        }
        propOrder.get(part)!.push(prop);
      }
      cells.push({ combo, tokens: [...tokens].sort() });
    }
  });

  // Presence is a JOINT property of a variant's full combo, not a marginal one
  // per axis: a part can be absent at (X=1,Y=p) while X still spans {1,2} and Y
  // still spans {p,q} across the cells that DO exist. relevantAxes' per-axis
  // presence test cannot see that, so both conditions get dropped and the rule
  // claims a binding on a variant with no such part. Backfilling an explicit
  // ABSENT cell for every missing combo turns absence into just another token
  // value, which the difference-detection below already handles correctly.
  // Cells hold combo objects by reference from `combos`, so identity works here.
  for (const cells of cellsByPartProp.values()) {
    const present = new Set(cells.map((c) => c.combo));
    for (const combo of combos) {
      if (!present.has(combo)) cells.push({ combo, tokens: [ABSENT] });
    }
  }

  // --- Minimize each (part, property) grid into rules -----------------------
  const tokensKey = (c: Cell) => c.tokens.join('\0');
  const projKey = (combo: Record<string, string>, axes: string[]) => axes.map((a) => combo[a]).join('\0');

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
        const tk = tokensKey(c);
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
      const tk = tokensKey(c);
      const prev = m.get(k);
      if (prev === undefined) m.set(k, tk);
      else if (prev !== tk) return true;
    }
    return false;
  };

  const buildRules = (cellsIn: Cell[]): DraftRule[] => {
    let cells = cellsIn;
    let relevant = relevantAxes(cells);
    // Sparse grids can hide pairwise differences (no two variants differ in just
    // one axis) — repair by adding axes until the projection is unambiguous.
    for (const axis of axisOrder) {
      if (!hasConflict(cells, relevant)) break;
      if (!relevant.includes(axis)) relevant = axisOrder.filter((a) => relevant.includes(a) || a === axis);
    }

    // Backstop. If a conflict survives adding every axis, two variants parse to
    // the SAME combo (hand-edited variant names do this). Unioning their token
    // sets below would invent a binding no variant carries, so fall back to
    // fully-specific conditions and keep only the first cell per combo.
    if (hasConflict(cells, relevant)) {
      relevant = [...axisOrder];
      const byCombo = new Map<string, Cell>();
      for (const c of cells) {
        const k = projKey(c.combo, axisOrder);
        if (!byCombo.has(k)) byCombo.set(k, c);
      }
      cells = [...byCombo.values()];
    }

    // Project cells onto the relevant axes.
    const groups = new Map<string, { combo: Record<string, string>; tokens: Set<string> }>();
    for (const c of cells) {
      const k = projKey(c.combo, relevant);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { combo: c.combo, tokens: new Set() }));
      c.tokens.forEach((t) => g!.tokens.add(t));
    }

    // One candidate rule per (projected combo, token), singleton value sets.
    let rules: DraftRule[] = [];
    for (const g of groups.values()) {
      for (const token of [...g.tokens].sort()) {
        rules.push({ token, values: new Map(relevant.map((a) => [a, new Set([g.combo[a]])])) });
      }
    }

    // Merge along each axis: rules with the same token and identical conditions
    // on every other axis combine their value lists.
    const conditionKey = (r: DraftRule, excludeAxis: string | null) =>
      axisOrder
        .filter((a) => a !== excludeAxis)
        .map((a) => (r.values.has(a) ? [...r.values.get(a)!].sort().join(',') : '*'))
        .join('\0');
    for (const axis of relevant) {
      const merged = new Map<string, DraftRule>();
      for (const r of rules) {
        const k = `${r.token}\0${conditionKey(r, axis)}`;
        const prev = merged.get(k);
        if (prev && prev.values.has(axis) && r.values.has(axis)) {
          r.values.get(axis)!.forEach((v) => prev.values.get(axis)!.add(v));
        } else if (!merged.has(k)) {
          merged.set(k, r);
        }
      }
      rules = [...merged.values()];
    }

    // Drop an axis from a rule when its values cover every value observed in
    // combination with the rule's remaining conditions. Critically, coverage is
    // checked against the variants that actually exist (the grid is sparse):
    // e.g. Danger=true never co-exists with Disabled=true, so a Danger=true
    // rule drops its Disabled=false condition — without ever claiming combos
    // that don't exist.
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

    // Dedupe, then remove rules subsumed by a strictly more general rule.
    const seen = new Map<string, DraftRule>();
    for (const r of rules) {
      const k = `${r.token}\0${conditionKey(r, null)}`;
      if (!seen.has(k)) seen.set(k, r);
    }
    rules = [...seen.values()];
    rules = rules.filter(
      (r) =>
        !rules.some(
          (other) =>
            other !== r &&
            other.token === r.token &&
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
  const toTokenRule = (part: string, property: string, r: DraftRule): TokenRule => {
    const conditions: Record<string, string[]> = {};
    for (const axis of axisOrder) {
      const vs = r.values.get(axis);
      if (!vs) continue;
      conditions[axis] = axisValues.get(axis)!.filter((v) => vs.has(v));
    }
    return { part, property, conditions, token: r.token };
  };

  const ruleSortKey = (r: DraftRule): string => {
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
    return `${matchesDefault ? 0 : 1}\0${String(r.values.size).padStart(3, '0')}\0${axisBits}\0${r.token}`;
  };

  const out: TokenRule[] = [];
  for (const part of partOrder) {
    for (const prop of propOrder.get(part)!) {
      const cells = cellsByPartProp.get(`${part}\0${prop}`)!;
      const rules = buildRules(cells);
      rules.sort((a, b) => {
        const ka = ruleSortKey(a), kb = ruleSortKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      for (const r of rules) {
        if (r.token === ABSENT) continue;
        out.push(toTokenRule(part, prop, r));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction gaps (default variant only)
// ---------------------------------------------------------------------------

/** Properties that indicate a TEXT node's typography is governed by a style or variable. */
const TYPOGRAPHY_PROPS = ['typography', 'fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing'];
/** Bound-variable property names that cover padding. */
const PADDING_PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding'];

export function extractGaps(root: SerializedNode): Gap[] {
  const out: Gap[] = [];
  const seenGaps = new Set<string>();
  const pushGap = (part: string, issue: string) => {
    const key = `${part}\0${issue}`;
    if (seenGaps.has(key)) return;
    seenGaps.add(key);
    out.push({ part, issue });
  };
  const isInSet = root.type === 'COMPONENT_SET';
  const def = defaultVariant(root);
  walkParts(def, isInSet ? 'Container' : cleanPartName(def.name), (n, part) => {
    const bound = new Set((n.bindings ?? []).map((b) => b.property));
    if (n.hasUnboundPaint) {
      pushGap(part, 'hardcoded color (no variable or style)');
    }
    if (n.hasUnboundStroke) {
      pushGap(part, 'hardcoded stroke color (no variable or style)');
    }
    if (n.hasUnboundGradient) {
      pushGap(part, 'hardcoded gradient or image fill (no style)');
    }
    if (n.hasUnboundEffect) {
      pushGap(part, 'hardcoded shadow or blur (no effect style)');
    }
    if (n.opacity !== undefined && n.opacity !== 1 && !bound.has('opacity')) {
      pushGap(part, `hardcoded opacity (${n.opacity})`);
    }
    if (n.type === 'TEXT' && !TYPOGRAPHY_PROPS.some((p) => bound.has(p))) {
      pushGap(part, 'no text style or typography variable');
    }
    const l = n.layout;
    if (!l) return;
    if (l.itemSpacing !== undefined && !bound.has('itemSpacing')) {
      pushGap(part, `hardcoded itemSpacing (${l.itemSpacing}px)`);
    }
    if (l.cornerRadius !== undefined && !bound.has('cornerRadius') && !bound.has('topLeftRadius')) {
      pushGap(part, `hardcoded cornerRadius (${l.cornerRadius}px)`);
    }
    const pads = [l.paddingTop, l.paddingRight, l.paddingBottom, l.paddingLeft];
    if (pads.some((p) => p !== undefined) && !PADDING_PROPS.some((p) => bound.has(p))) {
      pushGap(part, 'hardcoded padding');
    }
  });
  return out;
}

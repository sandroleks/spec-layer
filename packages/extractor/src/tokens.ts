import type { SerializedNode, TokenRef, RefIdentity } from './tree';
import { defaultVariant } from './anatomy';
import { parseVariantName, cleanPartName, walkParts } from './naming';

/**
 * A minimized token rule: `name` applies to `part.property` whenever every
 * conditioned axis matches one of its listed values. An empty `conditions`
 * object means the rule applies to every variant. Conditions only name the
 * axes that actually determine the value — axes that never affect it are
 * never mentioned.
 */
export interface TokenRule extends RefIdentity {
  part: string;
  /** Path identity from the component root. The join key every consumer uses;
   *  `part` is the leaf name and is for display only. */
  path: string;
  property: string;
  /** axis -> matching values, axes in variant-name order, values in axis order. */
  conditions: Record<string, string[]>;
}

/** Stable ids, not prose. A free-form sentence cannot drive UI, a test, or a
 *  comparison against a binding, and the measured number belongs in its own
 *  field rather than embedded in text. */
export type GapIssue = 'hardcoded-value' | 'hardcoded-color' | 'missing-token-binding';

export interface Gap {
  part: string;
  path: string;
  property: string;
  issue: GapIssue;
  /** The hardcoded value itself, where there is one to report. */
  value?: number | string;
}

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
 * The property name a real variable/style binding would carry for one raw
 * Figma property name, e.g. `fills` -> `fill`. The single source of truth for
 * that renaming: both a real binding (`normalizeBindings`) and a hardcoded
 * value with no binding at all (`extractGaps`) route through this, so the two
 * can never again land on different property vocabularies for the same
 * underlying thing.
 */
const simpleProperty = (raw: string): string => SIMPLE_PROPERTY_MAP[raw] ?? raw;

/**
 * Decide which composite padding property name(s) apply, given each side's
 * candidate value already narrowed to at most one (a real binding resolves to
 * one token per side; a hardcoded layout value resolves to one number per
 * side): `padding` when all four sides agree, `padding-x`/`padding-y` when a
 * pair agrees, or the four individual `padding-{side}` names otherwise.
 * Shared between `normalizeBindings` (values are token names) and
 * `extractGaps` (values are hardcoded numbers) so a hardcoded padding gap and
 * a real padding binding on the same shape land on the exact same property
 * name — vocabulary drift between the two is the defect this task removes.
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
  // Compared through `key`, not by identity: four sides bound to ONE variable
  // are four distinct ref objects, and a Set of them has size 4.
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
 * - paddings collapse to `padding` (all 4 equal) or `padding-x`/`padding-y` (pairs equal)
 * - typography sub-properties are dropped when a composite `typography` binding exists
 * - everything else is renamed via SIMPLE_PROPERTY_MAP
 */
function normalizeBindings(raw: TokenRef[]): TokenRef[] {
  // Keyed on the WHOLE ref, not on its name: two different resources sharing a
  // name are two bindings, and collapsing them on the name is the defect this
  // change exists to remove.
  const byProp = new Map<string, TokenRef[]>();
  for (const b of raw) {
    const refs = byProp.get(b.property) ?? [];
    if (!refs.some((r) => r.kind === b.kind && r.id === b.id)) refs.push(b);
    byProp.set(b.property, refs);
  }

  const out: TokenRef[] = [];
  const emit = (property: string, ref: TokenRef) => {
    if (out.some((o) => o.property === property && o.kind === ref.kind && o.id === ref.id)) return;
    // The ref travels through with its identity intact; only the PROPERTY is
    // renamed. Reconstructing `{ property, token }` here is what used to flatten
    // every binding back to a string one stage after it was resolved.
    out.push({ ...ref, property });
  };

  // Corner radii
  const radii = RADIUS_PROPS.filter((p) => byProp.has(p));
  const radiusRefs = radii.flatMap((p) => byProp.get(p)!);
  const distinctRadius = new Set(radiusRefs.map((r) => `${r.kind}|${r.id}`));
  if (radii.length === RADIUS_PROPS.length && distinctRadius.size === 1) {
    emit('border-radius', radiusRefs[0]);
  } else {
    for (const p of radii) for (const r of byProp.get(p)!) emit(RADIUS_INDIVIDUAL_MAP[p], r);
  }

  // Padding
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

  // Everything else
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

/**
 * The identity key for one reference: what makes two bindings the same binding.
 *
 * `${kind}|${id}`, not the name. A name is a display string and two different
 * Figma resources can share one; keying on it is what used to make a variable
 * and an effect style called "Elevation/1" a single rule.
 */
const refKey = (r: RefIdentity): string => `${r.kind}|${r.id}`;

/**
 * Marks "this part/property does not exist in this variant". Backfilled into
 * every grid so absence participates in difference-detection like any other
 * value. Never escapes extractTokens: absent rules are dropped when the public
 * shape is built.
 *
 * A plain word rather than a control-character prefix, and safe because a real
 * refKey ALWAYS contains a `|` and this never does. The previous version began
 * with a raw SOH byte, which is exactly the class of invisible source that
 * `npm run check:nul` exists to catch and that its NUL-only scan missed.
 */
const ABSENT_KEY = 'absent';

/** One observed data point: in the variant identified by `combo`, the
 *  part/property carries the references named by `keys`. */
interface Cell {
  combo: Record<string, string>;
  keys: string[]; // sorted refKeys, or exactly [ABSENT_KEY]
}

/** Work-in-progress rule: one reference plus conditioned axes mapped to accepted value sets. */
interface DraftRule {
  key: string;
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
  // Grouped by (path, property), NOT (part, property). `part` is unique only
  // among SIBLINGS, so two nodes with the same cleaned name in DIFFERENT
  // subtrees ("header > label" and "footer > label") would still share a flat
  // `part` key. `path`, threaded from walkParts, is the real identity.
  //
  // The composite key is JSON, not a separator-joined string. A separator has
  // to be a character neither component can contain, which in this repo has
  // meant a NUL or a SOH: invisible in a diff, silent under `grep`, and past
  // git's binary-detection window. JSON.stringify escapes its own components,
  // so the key is unambiguous AND readable in a debugger.
  const gridKey = (path: string, property: string): string => JSON.stringify([path, property]);

  const cellsByPathProp = new Map<string, Cell[]>();
  const pathOrder: string[] = [];
  const propOrder = new Map<string, string[]>();
  const partByPath = new Map<string, string>();
  /** Every reference seen anywhere in this component, by refKey, so a rule can
   *  be turned back into a full identity at emit time. Two refs sharing a
   *  (kind, id) are the same Figma resource, so overwriting is a no-op.
   *
   *  This REPLACES `identityByName` from the previous task, which was keyed by
   *  name and so could only ever hold one of two references that shared one.
   *  Delete that map and its two uses. */
  const refsByKey = new Map<string, RefIdentity>();

  variants.forEach((variant, idx) => {
    const combo = combos[idx];
    // Outer key path-and-property, inner key refKey, so two refs sharing a name
    // stay two refs all the way through.
    const variantRefs = new Map<string, Map<string, RefIdentity>>();
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part, path) => {
      for (const ref of normalizeBindings(n.bindings ?? [])) {
        const key = gridKey(path, ref.property);
        partByPath.set(path, part);
        // Store the identity WITHOUT `property`: toTokenRule spreads this over
        // a literal that already set `property` from the (path, property)
        // cell it is emitting, so a `property` left on here would win the
        // spread and stamp whichever property this ref was last seen under
        // onto the rule.
        const { property: _property, ...identity } = ref;
        let inner = variantRefs.get(key);
        if (!inner) variantRefs.set(key, (inner = new Map()));
        const rk = refKey(ref);
        inner.set(rk, identity);
        refsByKey.set(rk, identity);
      }
    }, true);
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

  // Presence is a JOINT property of a variant's full combo, not a marginal one
  // per axis: a part can be absent at (X=1,Y=p) while X still spans {1,2} and Y
  // still spans {p,q} across the cells that DO exist. relevantAxes' per-axis
  // presence test cannot see that, so both conditions get dropped and the rule
  // claims a binding on a variant with no such part. Backfilling an explicit
  // ABSENT cell for every missing combo turns absence into just another token
  // value, which the difference-detection below already handles correctly.
  // Cells hold combo objects by reference from `combos`, so identity works here.
  for (const cells of cellsByPathProp.values()) {
    const present = new Set(cells.map((c) => c.combo));
    for (const combo of combos) {
      if (!present.has(combo)) cells.push({ combo, keys: [ABSENT_KEY] });
    }
  }

  // --- Minimize each (part, property) grid into rules -----------------------
  // JSON, not a joined string, for the reason gridKey gives: an axis value is
  // whatever a designer typed, so no separator character is safely unavailable.
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
    // Sparse grids can hide pairwise differences (no two variants differ in just
    // one axis) — repair by adding axes until the projection is unambiguous.
    for (const axis of axisOrder) {
      if (!hasConflict(cells, relevant)) break;
      if (!relevant.includes(axis)) relevant = axisOrder.filter((a) => relevant.includes(a) || a === axis);
    }

    // Backstop. If a conflict survives adding every axis, two variants parse to
    // the SAME combo (hand-edited variant names do this). Unioning their key
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

    // Merge along each axis: rules with the same key and identical conditions
    // on every other axis combine their value lists.
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
    return { part: partByPath.get(path)!, path, property, conditions, ...refsByKey.get(r.key)! };
  };

  /**
   * Sort fields, compared one at a time. Deliberately an array rather than a
   * separator-joined string: a joined key makes ordering depend on how the
   * separator sorts against whatever the previous field's last characters were,
   * which is why the old version needed an unspellable NUL to be correct. Field
   * by field, that question does not arise.
   *
   * Field 4 is the reference's NAME, so rules still sort the way a reader
   * expects to see them. Field 5 is the refKey, which only ever breaks a tie
   * between two references that genuinely share a name.
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
      // An absent rule has no reference and sorts first, exactly as the old
      // control-character sentinel did. It is dropped below either way.
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
  // Separator is a SPACE, not a NUL byte: a NUL in source has bitten this repo
  // repeatedly and evades lint, tests and `git diff`.
  const pushGap = (part: string, path: string, property: string,
                    issue: GapIssue, value?: number | string) => {
    // Keyed on path (not part) + property + issue: `part` is unique only among
    // siblings, so two nodes with the same cleaned leaf name in different
    // subtrees ("header > label" and "footer > label") would otherwise share a
    // key and the second node's gap would silently never get pushed at all.
    // `property` is included so two distinct issues that happen to share a
    // path never collapse into one.
    const key = `${path} ${property} ${issue}`;
    if (seenGaps.has(key)) return;
    seenGaps.add(key);
    out.push({ part, path, property, issue, ...(value !== undefined ? { value } : {}) });
  };
  const isInSet = root.type === 'COMPONENT_SET';
  const def = defaultVariant(root);
  walkParts(def, isInSet ? 'Container' : cleanPartName(def.name), (n, part, path) => {
    const bound = new Set((n.bindings ?? []).map((b) => b.property));
    // Every property name below is routed through `simpleProperty` (the same
    // rename `normalizeBindings` applies to a real binding on `fills`,
    // `strokes`, etc.) rather than hand-picked, so a hardcoded value and a
    // real binding for the same raw Figma property can never land on
    // different property vocabularies.
    if (n.hasUnboundPaint) {
      pushGap(part, path, simpleProperty('fills'), 'hardcoded-color', n.unboundFill);
    }
    if (n.hasUnboundStroke) {
      pushGap(part, path, simpleProperty('strokes'), 'hardcoded-color', n.unboundStroke);
    }
    if (n.hasUnboundGradient) {
      // A gradient/image fill has no single hex to report, so there is no
      // `value` here, unlike the solid-fill and stroke cases above.
      pushGap(part, path, simpleProperty('fills'), 'missing-token-binding');
    }
    if (n.hasUnboundEffect) {
      pushGap(part, path, simpleProperty('effects'), 'missing-token-binding');
    }
    if (n.opacity !== undefined && n.opacity !== 1 && !bound.has('opacity')) {
      // Rounded here as well as in serialize.ts, because this number is inside
      // specContentHash and the extractor also runs over node JSON that did not
      // come from this repo's serializer (an uploaded dump, an older plugin
      // build). Figma's float32 opacity would otherwise print 30% as
      // 0.30000001192092896, both on the page and in the drift baseline.
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
    if (l.cornerRadius !== undefined && !bound.has('cornerRadius') && !bound.has('topLeftRadius')) {
      pushGap(part, path, simpleProperty('cornerRadius'), 'hardcoded-value', l.cornerRadius);
    }
    if (!PADDING_PROPS.some((p) => bound.has(p))) {
      const side = (v: number | undefined): number[] => (v !== undefined ? [v] : []);
      // Same collapsing `normalizeBindings` applies to real padding bindings,
      // run over the raw numbers instead of token names: equal numbers stand
      // in for "the same token" so a hardcoded padding gap lands on exactly
      // the property (`padding`, `padding-x`/`padding-y`, or an individual
      // side) that a real binding on this same shape would use.
      for (const { property, value } of paddingSides(
        side(l.paddingTop), side(l.paddingRight), side(l.paddingBottom), side(l.paddingLeft),
      )) {
        pushGap(part, path, property, 'hardcoded-value', value);
      }
    }
  });
  return out;
}

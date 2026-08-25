import type { TokenRule } from './tokens';
import { formatConditions } from './tokens';
import type { VariantAxis } from './props';

/** Which Tokens-used sub-section a property belongs to. */
export type PropertyCategory = 'color' | 'typography' | 'measurements';

const COLOR_PROPS = new Set(['fill', 'border', 'background', 'color', 'outline']);
const TYPOGRAPHY_PROPS = new Set([
  'typography', 'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'letter-spacing',
]);

export function categorize(property: string): PropertyCategory {
  if (COLOR_PROPS.has(property)) return 'color';
  if (TYPOGRAPHY_PROPS.has(property)) return 'typography';
  return 'measurements';
}

const EM_DASH = '—';
const code = (s: string) => `\`${s}\``;
/** Parts with this many rules or fewer render as one compact flat table. */
const COMPACT_THRESHOLD = 3;

/** A rule carries no conditions — it applies to every variant. */
export const isUnconditioned = (r: TokenRule) => Object.keys(r.conditions).length === 0;

/** Variant axis whose values are exactly {true, false} (case-insensitive). */
export function isModifierAxis(axis: VariantAxis): boolean {
  if (axis.values.length !== 2) return false;
  const lower = axis.values.map((v) => v.toLowerCase());
  return lower.includes('true') && lower.includes('false');
}

export function isStateAxisName(prop: string): boolean {
  const n = prop.trim().toLowerCase();
  return n === 'state' || n === 'states';
}

function findStateAxis(variants: VariantAxis[]): VariantAxis | null {
  return variants.find((v) => isStateAxisName(v.prop)) ?? null;
}

function axesUsed(rules: TokenRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) for (const k of Object.keys(r.conditions)) out.add(k);
  return out;
}

export function ruleMatchesConfig(rule: TokenRule, config: Record<string, string>): boolean {
  for (const [axis, value] of Object.entries(config)) {
    const allowed = rule.conditions[axis];
    if (allowed && !allowed.includes(value)) return false;
  }
  return true;
}

/** Render a markdown table from a header row and body rows (no surrounding blanks). */
function makeTable(header: string[], rows: string[][]): string[] {
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines;
}

/** Flat `Property | Condition | Token` rows for a set of rules (no surrounding blanks). */
function flatRows(rules: TokenRule[]): string[] {
  return makeTable(
    ['Property', 'Condition', 'Token'],
    rules.map((r) => [r.property, formatConditions(r.conditions), code(r.name)]),
  );
}

/**
 * Pivot the color rules for a single part into Material-style tables.
 *
 * Layout:
 *  - A base table plus one `**When <Modifier> = <value>**` sub-table per
 *    non-default value of each boolean (true/false) variant axis.
 *  - Within a table, rows are `(property, state)` and columns are the values of
 *    the single column axis (the non-State, non-modifier axis referenced by the
 *    most rules). The State column collapses when no rule conditions on state;
 *    the column axis collapses to a single `Token` column when unused.
 *  - Rules that condition on any other axis (e.g. a second style axis like
 *    `Size`) are pulled into a trailing `**Exceptions**` flat table so the
 *    pivot stays clean while remaining lossless.
 *
 * Cell resolution prefers the rule with the most conditioned axes (most
 * specific). Genuine ties between equally-specific rules render every claimed
 * token joined with ` · ` rather than dropping information.
 *
 * Returns markdown lines (trailing blank included), or `null` only for
 * degenerate inputs — a rule referencing an axis absent from `variants` — in
 * which case the caller renders a flat whole-part table.
 */
export function pivotColorPart(
  rules: TokenRule[],
  variants: VariantAxis[],
  defaults: Record<string, string>,
): string[] | null {
  if (!rules.length) return [];

  // A rule referencing an axis we can't enumerate defeats the pivot.
  for (const r of rules) {
    for (const a of Object.keys(r.conditions)) {
      if (!variants.some((v) => v.prop === a)) return null;
    }
  }

  // Small parts: a single compact flat table is clearer than a pivot.
  if (rules.length <= COMPACT_THRESHOLD) {
    return [...flatRows(rules), ''];
  }

  const used = axesUsed(rules);
  const stateAxis = findStateAxis(variants);
  const modifierAxes: VariantAxis[] = [];
  const otherAxes: VariantAxis[] = [];
  for (const v of variants) {
    if (!used.has(v.prop)) continue;
    if (stateAxis && v.prop === stateAxis.prop) continue;
    if (isModifierAxis(v)) modifierAxes.push(v);
    else otherAxes.push(v);
  }

  // Column axis = the non-State, non-modifier axis referenced by the most rules.
  const ruleCount = (axis: string) => rules.filter((r) => r.conditions[axis]).length;
  const colAxis = otherAxes.length
    ? [...otherAxes].sort((a, b) => ruleCount(b.prop) - ruleCount(a.prop))[0]
    : null;

  // Axes that fit inside the pivot. Any rule conditioning on something else
  // (e.g. a second style axis) is an exception.
  const pivotAxes = new Set<string>();
  if (stateAxis) pivotAxes.add(stateAxis.prop);
  if (colAxis) pivotAxes.add(colAxis.prop);
  for (const m of modifierAxes) pivotAxes.add(m.prop);

  let pivotRules: TokenRule[] = [];
  const exceptionRules: TokenRule[] = [];
  for (const r of rules) {
    (Object.keys(r.conditions).every((a) => pivotAxes.has(a)) ? pivotRules : exceptionRules).push(r);
  }

  // Base table (all modifiers at default) plus one sub-table per non-default
  // modifier value.
  const baseConfig: Record<string, string> = {};
  for (const m of modifierAxes) baseConfig[m.prop] = defaults[m.prop] ?? m.values[0];

  const subTables: { title: string | null; config: Record<string, string> }[] = [
    { title: null, config: baseConfig },
  ];
  for (const m of modifierAxes) {
    const defaultV = defaults[m.prop] ?? m.values[0];
    for (const v of m.values) {
      if (v === defaultV) continue;
      subTables.push({ title: `When ${m.prop} = ${v}`, config: { ...baseConfig, [m.prop]: v } });
    }
  }

  // Lossless guarantee: sub-tables cover only the base config and single-
  // modifier flips, so a pivot rule conditioned on two non-default modifier
  // values at once matches none of them and would silently vanish — demote any
  // such rule to the Exceptions table instead.
  const orphaned = pivotRules.filter((r) => !subTables.some((s) => ruleMatchesConfig(r, s.config)));
  if (orphaned.length) {
    pivotRules = pivotRules.filter((r) => !orphaned.includes(r));
    exceptionRules.push(...orphaned);
  }

  const propOrder: string[] = [];
  for (const r of pivotRules) if (!propOrder.includes(r.property)) propOrder.push(r.property);

  const blocks: string[][] = [];

  for (const sub of subTables) {
    const subRules = pivotRules.filter((r) => ruleMatchesConfig(r, sub.config));
    if (!subRules.length) continue;

    const subUsed = axesUsed(subRules);
    const usesState = stateAxis !== null && subUsed.has(stateAxis.prop);
    const usesCol = colAxis !== null && subUsed.has(colAxis.prop);
    const states: string[] = usesState && stateAxis ? stateAxis.values : [''];
    const cols: string[] = usesCol && colAxis ? colAxis.values : [''];

    // Resolve each (property, state, col) cell to the most-specific token(s).
    // Specificity = number of conditioned axes on the rule. Equal-specificity
    // disagreements collect every token rather than discarding any.
    type CellPick = { tokens: string[]; score: number };
    const cells = new Map<string, CellPick>();
    const cellKey = (p: string, s: string, c: string) => JSON.stringify([p, s, c]);

    for (const r of subRules) {
      const score = Object.keys(r.conditions).length;
      const stateValues = usesState && stateAxis ? (r.conditions[stateAxis.prop] ?? states) : [''];
      const colValues = usesCol && colAxis ? (r.conditions[colAxis.prop] ?? cols) : [''];
      for (const s of stateValues) {
        if (usesState && !states.includes(s)) continue;
        for (const c of colValues) {
          if (usesCol && !cols.includes(c)) continue;
          const k = cellKey(r.property, s, c);
          const prev = cells.get(k);
          if (!prev || score > prev.score) {
            cells.set(k, { tokens: [r.name], score });
          } else if (score === prev.score && !prev.tokens.includes(r.name)) {
            prev.tokens.push(r.name);
          }
        }
      }
    }

    const header = ['Property', ...(usesState ? ['State'] : []), ...(usesCol && colAxis ? colAxis.values : ['Token'])];
    const bodyRows: string[][] = [];
    for (const prop of propOrder) {
      for (const s of states) {
        const valueCells = cols.map((c) => {
          const pick = cells.get(cellKey(prop, s, c));
          return pick ? pick.tokens.map(code).join(' · ') : EM_DASH;
        });
        if (valueCells.every((v) => v === EM_DASH)) continue;
        bodyRows.push([prop, ...(usesState ? [s] : []), ...valueCells]);
      }
    }
    if (!bodyRows.length) continue;

    const table = makeTable(header, bodyRows);
    blocks.push(sub.title ? [`**${sub.title}**`, '', ...table] : table);
  }

  if (exceptionRules.length) {
    blocks.push(['**Exceptions**', '', ...flatRows(exceptionRules)]);
  }

  const out: string[] = [];
  for (const b of blocks) out.push(...b, '');
  return out;
}

/** Flat fallback shape: `| Property | Condition | Token |`, one row per rule. */
export function flatPartTable(rules: TokenRule[]): string[] {
  return [...flatRows(rules), ''];
}

/** Global flat table used for typography and measurements: includes Part. */
export function flatGlobalTable(rules: TokenRule[]): string[] {
  return [
    ...makeTable(
      ['Part', 'Property', 'Condition', 'Token'],
      rules.map((r) => [r.part, r.property, formatConditions(r.conditions), code(r.name)]),
    ),
    '',
  ];
}

/** Build the `#### Fixed` table merging parts whose rules are all unconditioned. */
export function fixedTable(entries: { part: string; rule: TokenRule }[]): string[] {
  return [
    ...makeTable(
      ['Part', 'Property', 'Token'],
      entries.map((e) => [e.part, e.rule.property, code(e.rule.name)]),
    ),
    '',
  ];
}

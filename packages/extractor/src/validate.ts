/**
 * Deterministic findings about one component, each computed from extracted
 * data. No aggregate score (a number with no defined arithmetic that licenses
 * unreviewed generation is worse than none) and no `info` severity (a finding
 * nobody should act on is not emitted).
 */
import type { IntermediateSpec } from './extract';
import type { LayoutSummary } from './layout';
import type { VariantAxis } from './props';
import { isModifierAxis, ruleMatchesConfig } from './pivot';
import { isStateLike, isStateVocabName } from './statesMatrix';

export type FindingId =
  | 'default-state-uses-state-token'
  | 'geometry-token-mismatch'
  | 'duplicate-conflicting-binding'
  | 'ambiguous-state-axis'
  | 'unbound-value';

export interface Finding {
  id: FindingId;
  severity: 'warning' | 'error';
  path?: string;
  property?: string;
  message: string;
  when?: Record<string, string[]>;
}

/** State words that, in a token name, imply a state-specific value. */
const STATE_WORDS = ['disabled', 'hover', 'hovered', 'focus', 'focused', 'press', 'pressed', 'loading', 'selected'];

/**
 * Inflections of one state, so a condition spelled "Hovered" still suppresses a
 * token named `...primary-hover`; mirrors STATE_ORDER in statesMatrix.ts.
 */
const STATE_SYNONYMS: Record<string, string[]> = {
  hover: ['hover', 'hovered'], hovered: ['hover', 'hovered'],
  focus: ['focus', 'focused'], focused: ['focus', 'focused'],
  press: ['press', 'pressed'], pressed: ['press', 'pressed'],
};

/** Whole-word match, so `compressed` does not name the press state. Cached per
 *  word (the sets are closed); no `g` flag, so `.test` keeps no lastIndex. */
const WORD_PATTERNS = new Map<string, RegExp>();
const hasWord = (haystack: string, word: string): boolean => {
  let pattern = WORD_PATTERNS.get(word);
  if (!pattern) WORD_PATTERNS.set(word, (pattern = new RegExp(`\\b${word}\\b`)));
  return pattern.test(haystack);
};

/**
 * Values that read as a boolean flag's settings. Unlike `isModifierAxis`, which
 * needs both `true` and `false`, this reads a slice like `{ Enabled: ['False'] }`,
 * so the verdict does not depend on the axis being declared in `variants`.
 */
const isBooleanValues = (values: string[]): boolean =>
  values.length > 0 && values.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false');

/**
 * Does this binding's condition restrict it to a state axis: one named after a
 * state concept (`isStateVocabName`) that is a boolean flag, not an enum? Not a
 * name-to-meaning table (`Enabled: False` -> disabled), since every entry would
 * guess at someone else's naming. Name alone would also suppress the enum
 * `{ State: ['Default'] }` this rule exists for.
 *
 * Polarity-blind: `{ Enabled: ['True'] }` on a `...disabled` token is a real
 * defect this misses, because reading polarity means guessing what `True`
 * means. The rule fires only where its message can honestly claim the state is
 * not set.
 */
function conditionsNameAStateAxis(
  conditions: Record<string, string[]>,
  variants: VariantAxis[],
): boolean {
  return Object.entries(conditions).some(([prop, values]) => {
    if (!isStateVocabName(prop)) return false;
    const declared = variants.find((v) => v.prop === prop);
    return (declared !== undefined && isModifierAxis(declared)) || isBooleanValues(values);
  });
}

/**
 * The geometry a layout entry states, from the structured `values`, never parsed
 * back out of the `summary` display string, which can be reworded.
 */
function geometryOf(l: LayoutSummary): { property: string; value: number }[] {
  const out: { property: string; value: number }[] = [];
  if (l.values.radius !== undefined) out.push({ property: 'border-radius', value: l.values.radius });
  if (l.values.gap !== undefined) out.push({ property: 'gap', value: l.values.gap });
  return out;
}

export function validate(
  spec: IntermediateSpec,
  /** token name (legacy) or stable source id (v5) -> resolved numeric value,
   * at the mode the brief reports. */
  resolved: Map<string, number>,
  resolutionKey: 'name' | 'id' = 'name',
): Finding[] {
  const findings: Finding[] = [];

  // 1. A binding whose token names a state its own condition does not. Two
  // independent suppressions:
  //  - lexical: the condition spells the state word in any inflection
  //    (STATE_SYNONYMS); catches the enum `{ State: ['Disabled'] }`.
  //  - structural: the condition restricts to a state-named boolean axis, as in
  //    `{ Enabled: ['False'] }`, whose value spells no state word.
  for (const t of spec.tokens) {
    const word = STATE_WORDS.find((w) => hasWord(t.name.toLowerCase(), w));
    if (!word) continue;
    const conditionText = Object.entries(t.conditions)
      .map(([axis, values]) => `${axis} ${values.join(' ')}`).join(' ').toLowerCase();
    const synonyms = STATE_SYNONYMS[word] ?? [word];
    if (synonyms.some((s) => hasWord(conditionText, s))) continue;
    if (conditionsNameAStateAxis(t.conditions, spec.variants)) continue;
    findings.push({
      id: 'default-state-uses-state-token', severity: 'warning',
      path: t.path, property: t.property,
      message: `${t.property} is bound to ${t.name}, which names the ${word} state, `
        + 'but this binding applies where that state is not set.',
      ...(Object.keys(t.conditions).length > 0 ? { when: t.conditions } : {}),
    });
  }

  // 2. A rendered number disagreeing with its bound token's resolved value.
  //
  // Joined on `path`, not `part`: `part` is unique only among siblings, so two
  // `Icon` nodes in different subtrees would compare one node's radius with the
  // other's token (see the grouping comment in tokens.ts). Joined on the
  // condition too: extractLayout walks the default variant only, so only rules
  // matching its combo apply (`anatomyComponentId` is the default variant's
  // node id; `ruleMatchesConfig` treats an absent axis as matching anything).
  //
  // Exactly one applicable rule is compared. Zero: nothing is bound. More than
  // one: a conflict `duplicate-conflicting-binding` reports, or a distinction on
  // an axis this cannot see, so never guess. An underivable combo is empty, so
  // every rule matches and this guard keeps a multi-variant component quiet.
  const defaultCombo =
    spec.variantInstances.find((v) => v.nodeId === spec.anatomyComponentId)?.values ?? {};
  for (const l of spec.layout) {
    for (const { property, value } of geometryOf(l)) {
      const applicable = spec.tokens.filter(
        (t) => t.path === l.path && t.property === property && ruleMatchesConfig(t, defaultCombo),
      );
      if (applicable.length !== 1) continue;
      const rule = applicable[0];
      const target = resolved.get(resolutionKey === 'id' ? rule.id : rule.name);
      if (target === undefined || target === value) continue;
      findings.push({
        id: 'geometry-token-mismatch', severity: 'warning',
        path: rule.path, property,
        message: `The frame renders ${property} ${value}, while the bound token `
          + `${rule.name} resolves to ${target}.`,
      });
    }
  }

  // 3. One path and property bound to two tokens under one condition. `path` and
  // `property` travel beside the key, never split back out of it: a part name
  // can contain a space.
  const byTarget = new Map<string, { path: string; property: string; tokens: Set<string> }>();
  for (const t of spec.tokens) {
    const key = JSON.stringify([t.path, t.property, t.conditions]);
    const entry = byTarget.get(key) ?? { path: t.path, property: t.property, tokens: new Set<string>() };
    entry.tokens.add(t.name);
    byTarget.set(key, entry);
  }
  for (const { path, property, tokens } of byTarget.values()) {
    if (tokens.size < 2) continue;
    findings.push({
      id: 'duplicate-conflicting-binding', severity: 'error',
      path, property,
      message: `${property} is bound to ${[...tokens].join(' and ')} under the same `
        + 'condition, so a consumer has no rule for choosing between them.',
    });
  }

  // 4. More than one state-like axis. detectStateMatrix takes the first silently.
  const stateAxes = spec.variants.filter(isStateLike).map((v) => v.prop);
  if (stateAxes.length > 1) {
    findings.push({
      id: 'ambiguous-state-axis', severity: 'warning',
      message: `${stateAxes.join(' and ')} each read as a state axis. Only `
        + `${stateAxes[0]} was used for the state matrix, and the rest were treated `
        + 'as ordinary variant properties.',
    });
  }

  // 5. Mirror each surviving gap, so one list carries everything actionable. A
  // gap whose path and property another variant binds is dropped, the same
  // reconciliation componentBrief's `unbound` block makes (the binding is the
  // stronger evidence), so the two blocks never disagree.
  const boundPaths = new Set(spec.tokens.map((t) => `${t.path} ${t.property}`));
  for (const g of spec.gaps) {
    if (boundPaths.has(`${g.path} ${g.property}`)) continue;
    findings.push({
      id: 'unbound-value', severity: 'warning',
      path: g.path, property: g.property,
      message: g.value !== undefined
        ? `${g.property} is a hardcoded ${g.value} rather than a bound token.`
        : `${g.property} is not bound to a token.`,
    });
  }

  return findings;
}

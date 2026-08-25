/**
 * Deterministic findings about one component.
 *
 * Every entry here is COMPUTED from extracted data. Nothing is inferred, and there
 * is deliberately no aggregate score: a number with no defined arithmetic that
 * tells an agent it may generate without human review is worse than no number.
 *
 * There is also no `info` severity. A finding nobody should act on should not be
 * emitted at all.
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

/** State words that appearing in a TOKEN name implies a state-specific value. */
const STATE_WORDS = ['disabled', 'hover', 'hovered', 'focus', 'focused', 'press', 'pressed', 'loading', 'selected'];

/**
 * Words that name the SAME interaction state under a different inflection, so a
 * condition value spelled with one form ("Hovered") still suppresses a token
 * named with the other ("...primary-hover") -- mirrors the hover/hovered and
 * focus/focused equivalence STATE_ORDER already encodes in statesMatrix.ts,
 * for the same reason: both spellings describe one ongoing condition, and
 * whichever form is used should not depend on which side of the check it's on.
 */
const STATE_SYNONYMS: Record<string, string[]> = {
  hover: ['hover', 'hovered'], hovered: ['hover', 'hovered'],
  focus: ['focus', 'focused'], focused: ['focus', 'focused'],
  press: ['press', 'pressed'], pressed: ['press', 'pressed'],
};

/** Whole-word match (not a bare substring): a plain `.includes` would flag a
 *  token like `color/surface/compressed/default` for "naming" the press
 *  state, when `press` there is only a fragment of an unrelated word. */
const hasWord = (haystack: string, word: string): boolean => new RegExp(`\\b${word}\\b`).test(haystack);

/**
 * Values that read as a boolean flag's own two settings.
 *
 * `isModifierAxis` needs exactly `true` and `false` together, so it is false
 * for a condition SLICE like `{ Enabled: ['False'] }`, which names only the one
 * value the binding is scoped to. This reads the same signal through such a
 * slice, which is what makes the verdict independent of whether the axis was
 * declared in `variants` at all.
 */
const isBooleanValues = (values: string[]): boolean =>
  values.length > 0 && values.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false');

/**
 * Does this binding's own condition restrict it to a STATE axis at all?
 *
 * Deliberately NOT a table mapping axis names to state meanings (`Enabled:
 * False` -> disabled, `Active: True` -> ...). Such a table is unbounded, every
 * entry guesses at someone else's naming, and each guess is a new way to be
 * confidently wrong. This asks only the structural question the rest of the
 * codebase already asks: is the axis named after a state concept
 * (`isStateVocabName`, the same test detectStateMatrix's flags path uses), and
 * is it a boolean flag rather than an enum? A name-only test would not do:
 * `isStateVocabName('State')` is true, so it would suppress the enum
 * `{ State: ['Default'] }` case this rule is named after.
 *
 * The consequence, accepted on purpose: this is POLARITY-BLIND. A binding
 * conditioned `{ Enabled: ['True'] }` or `{ Loading: ['True'] }` on a
 * `...disabled` token is a genuine defect and will now be missed. Reading
 * polarity means deciding what `True` means on someone else's axis, which is
 * the guessing table above. The message can only honestly claim "this binding
 * applies where that state is not set" when no state-named axis is involved at
 * all, so the rule now claims exactly that much and no more.
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
 * The geometry a layout entry states, as property name plus number.
 *
 * Reads `values`, the structured numbers extractLayout now carries. An earlier
 * draft regex-parsed `summary` ("horizontal, radius 4") instead, which is the same
 * mistake v1 made with typography: round-tripping a number through a display
 * string, so the parse breaks silently the day the sentence is reworded.
 */
function geometryOf(l: LayoutSummary): { property: string; value: number }[] {
  const out: { property: string; value: number }[] = [];
  if (l.values.radius !== undefined) out.push({ property: 'border-radius', value: l.values.radius });
  if (l.values.gap !== undefined) out.push({ property: 'gap', value: l.values.gap });
  return out;
}

export function validate(
  spec: IntermediateSpec,
  /** token name -> resolved numeric value, at the mode the brief reports. */
  resolved: Map<string, number>,
): Finding[] {
  const findings: Finding[] = [];

  // 1. A binding whose token names a state that its own condition does not.
  //
  // Two independent suppressions, neither of which subsumes the other:
  //
  //  - LEXICAL: the condition spells the state word itself. Checked against
  //    every inflection of the word the token matched (via STATE_SYNONYMS),
  //    not just that exact spelling: a condition reading `{ State: ['Hovered'] }`
  //    must still suppress a token named `...primary-hover`, and vice versa, or
  //    the two most common spellings of one state fail to recognize each other.
  //    This one catches `{ State: ['Disabled'] }`, where the axis is an enum and
  //    the structural test below says nothing.
  //  - STRUCTURAL: the condition restricts to a state-named BOOLEAN axis, whose
  //    value spells no state word at all. This one catches
  //    `{ Enabled: ['False'] }`, a very common way to model "disabled", which
  //    the lexical test reported as the exact defect the rule looks for.
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
  // Joined on `path`, not `part`. `part` is unique only among SIBLINGS, so two
  // subtrees each holding a node named `Icon` share one flat `part` key, and a
  // lookup keyed on it took the first match, so the SECOND node's rendered
  // radius was compared against the FIRST node's token and reported under the
  // FIRST node's path. Both nodes can be individually correct and still produce
  // that finding: a fabricated contradiction between two unrelated nodes,
  // attributed to the wrong path. `path` is the identity extractTokens itself
  // groups by, for exactly this reason (see the grouping comment in tokens.ts).
  //
  // Joined on the CONDITION too, not just on path and property. extractLayout
  // walks the default variant only, so a LayoutSummary states what the DEFAULT
  // variant renders. A `find` over path and property alone took whichever rule
  // came first regardless of the variants it is scoped to, so a component that
  // binds one geometry property to a different token per variant had the
  // default variant's rendered number compared against another variant's
  // token: every variant individually correct, and a confidently wrong finding
  // anyway.
  //
  // `defaultCombo` is the default variant's own axis values, already on the
  // spec: `anatomyComponentId` IS the default variant's node id, and
  // `variantInstances` carries the axis combo extractTokens conditioned its
  // rules with, from the one shared axis model. `ruleMatchesConfig` treats an
  // axis absent from a rule's conditions as matching anything, which is what an
  // unconditioned or partially conditioned rule means.
  //
  // Then, deliberately, exactly ONE surviving rule is compared:
  //  - ZERO: nothing is bound here for the default variant. Silent, as before.
  //  - MORE THAN ONE: two rules both applying to the default variant for one
  //    path and property is either a genuine conflict, which
  //    `duplicate-conflicting-binding` reports below with the right message, or
  //    a distinction on an axis this comparison cannot see. Guessing which one
  //    the frame actually used is precisely how the bug above happened, so do
  //    not guess.
  // When the combo cannot be derived at all (no variantInstance carries the
  // default variant's node id) the combo is empty, so EVERY rule matches and
  // the more-than-one guard is what stops a multi-variant component from
  // reporting nonsense.
  const defaultCombo =
    spec.variantInstances.find((v) => v.nodeId === spec.anatomyComponentId)?.values ?? {};
  for (const l of spec.layout) {
    for (const { property, value } of geometryOf(l)) {
      const applicable = spec.tokens.filter(
        (t) => t.path === l.path && t.property === property && ruleMatchesConfig(t, defaultCombo),
      );
      if (applicable.length !== 1) continue;
      const rule = applicable[0];
      const target = resolved.get(rule.name);
      if (target === undefined || target === value) continue;
      findings.push({
        id: 'geometry-token-mismatch', severity: 'warning',
        path: rule.path, property,
        message: `The frame renders ${property} ${value}, while the bound token `
          + `${rule.name} resolves to ${target}.`,
      });
    }
  }

  // 3. One path and property bound to two different tokens under one condition.
  //
  // Grouped by a string key, but `path`/`property` for the finding are carried
  // alongside it rather than recovered by splitting the key on spaces: a part
  // name containing a space ("Icon Left") would otherwise silently mangle the
  // reported path.
  const byTarget = new Map<string, { path: string; property: string; tokens: Set<string> }>();
  for (const t of spec.tokens) {
    const key = `${t.path}${t.property}${JSON.stringify(t.conditions)}`;
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
      message: `${stateAxes.join(' and ')} all read as state axes. Only `
        + `${stateAxes[0]} was used as the state matrix, and the rest were treated `
        + 'as ordinary variants.',
    });
  }

  // 5. Mirror each surviving gap, so one list carries everything actionable.
  //
  // A gap and a binding can name the same path and property: gap detection
  // walks the default variant while token extraction can see the property
  // bound in a different variant. componentBrief's own `unbound` block
  // already drops a gap in that situation because the binding is the
  // stronger evidence -- reporting `unbound-value` here anyway would put this
  // block in direct contradiction with `tokens` for the exact same fact, the
  // ButtonLabel defect the `unbound` reconciliation exists to prevent. Same
  // reconciliation, so the two blocks can never disagree.
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

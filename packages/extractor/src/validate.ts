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
import { isStateLike } from './statesMatrix';

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
  // The condition is checked against every inflection of the word the token
  // matched (via STATE_SYNONYMS), not just that exact spelling: a condition
  // reading `{ State: ['Hovered'] }` must still suppress a token named
  // `...primary-hover`, and vice versa, or the two most common spellings of
  // the same state would silently fail to recognize each other.
  for (const t of spec.tokens) {
    const word = STATE_WORDS.find((w) => hasWord(t.token.toLowerCase(), w));
    if (!word) continue;
    const conditionText = Object.entries(t.conditions)
      .map(([axis, values]) => `${axis} ${values.join(' ')}`).join(' ').toLowerCase();
    const synonyms = STATE_SYNONYMS[word] ?? [word];
    if (synonyms.some((s) => hasWord(conditionText, s))) continue;
    findings.push({
      id: 'default-state-uses-state-token', severity: 'warning',
      path: t.path, property: t.property,
      message: `${t.property} is bound to ${t.token}, which names the ${word} state, `
        + 'but this binding applies where that state is not set.',
      ...(Object.keys(t.conditions).length > 0 ? { when: t.conditions } : {}),
    });
  }

  // 2. A rendered number disagreeing with its bound token's resolved value.
  for (const l of spec.layout) {
    for (const { property, value } of geometryOf(l)) {
      const rule = spec.tokens.find((t) => t.part === l.part && t.property === property);
      if (!rule) continue;
      const target = resolved.get(rule.token);
      if (target === undefined || target === value) continue;
      findings.push({
        id: 'geometry-token-mismatch', severity: 'warning',
        path: rule.path, property,
        message: `The frame renders ${property} ${value}, while the bound token `
          + `${rule.token} resolves to ${target}.`,
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
    entry.tokens.add(t.token);
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

import type { IntermediateSpec } from '../extract';
import { formatConditions } from '../tokens';

export interface ProseDrafts {
  definition: string;
  accessibility: string;
  dos: string[];
  donts: string[];
}

/**
 * House-style system prompt for the prose pass — the distilled voice from
 * `docs/prose-style-guide.md`. Sent on every request as the `system` field, so
 * it is kept lean (this is the billed-every-call artifact). The per-component
 * schema/output contract stays in `buildProsePrompt`; this governs voice only.
 */
export const PROSE_SYSTEM_PROMPT = [
  'You write component guideline prose for a design-system specification tool.',
  "Your output fills three spec sections: Definition, Accessibility, and Do's & Don'ts,",
  'in the voice of best-in-class design systems (Atlassian, Material, Polaris, Carbon).',
  '',
  'Core rule: every guideline states the rule AND the reason it matters. A rule without its',
  'consequence reads like a lint message; the reason is what makes it useful guidance.',
  '',
  'Voice:',
  '- Imperative and verb-first ("Use...", "Keep...", "Avoid...", "Never...").',
  '- Write for people, not "the user". Say "people", "someone", or the concrete role.',
  '- Be concrete: anchor rules in real situations (forms, dialogs, toolbars), not "certain contexts".',
  "- Reference only the component's actual variants, props, and states. Never invent options it lacks.",
  '- Pair a Don\'t with its alternative (for example, "use a Toggle instead").',
  '',
  'Punctuation and formatting (this matters for readability):',
  '- Never use em dashes (the long dash) or en dashes as punctuation. Use a period, comma, colon,',
  '  or parentheses instead. A hyphen is fine in ranges like 3-5 and in compound words.',
  '- Keep sentences short. One idea per sentence. Split a long sentence into two.',
  '',
  'Sections (this is Markdown and renders as-is, so structure each one to scan at a glance):',
  '- Definition: open with a short paragraph (what it is, when to use it, the key constraint).',
  '  When the component has several meaningful variants or types, follow the paragraph with a',
  '  bulleted "when to use which" guide, one per line, with the variant name in bold:',
  '  "- **Filled**: the single most important action.".',
  '- Accessibility: a bulleted list. Give each bullet a short bold lead-in naming the topic, then',
  '  the guidance, for example "- **Keyboard:** ...". Always include a bullet flagging what the',
  '  design file cannot encode (focus order, live-region behaviour, immediate vs deferred effect).',
  '  If the list runs long (about six or more points), group the bullets under level-3 ("###")',
  '  subheadings.',
  "- Do's & Don'ts: one rule per bullet. Start each with a short bold lead-in stating the rule, then",
  '  a sentence giving the reason: "**Use one primary action per view.** Its weight tells people',
  '  where to go next." Do not add check or cross marks yourself; they are added on render.',
  '- Use Markdown structure where it helps: bold lead-ins, bullet lists, and at most level-3 ("###")',
  '  subheadings. Never use level-1 ("#") or level-2 ("##") headings.',
  '',
  'Return only the JSON object requested in the user message. No preamble and no prose outside the',
  'JSON.',
].join('\n');

/**
 * A single, hand-curated few-shot exemplar (one input→output pair) that anchors
 * length, specificity, and voice. Kept to one example to bound token cost; the
 * exemplar prompt mirrors `buildProsePrompt`'s shape and the response is a
 * house-voice `ProseDrafts` payload. Returned as prior conversation turns.
 */
const FEW_SHOT_PROMPT = [
  'Component: Button',
  '',
  'Anatomy: Container, Label, Leading icon (component)',
  '',
  'Variants:',
  '  Style: Filled · Outlined · Text',
  '',
  'States: Enabled, Hovered, Focused, Pressed, Disabled',
  '',
  'Return ONLY a JSON object with keys: definition (a short paragraph, then a bulleted "when to ' +
    'use which" guide with bold variant names when the component has several variants), ' +
    'accessibility (a bulleted list; give each bullet a short bold lead-in then the guidance; ' +
    'include one bullet flagging what cannot be known from the design file), dos (string[], 3 to 5 ' +
    'items, each starting with a bold rule summary then the reason), donts (string[], 3 to 5 items, ' +
    'same shape). Use Markdown (bold lead-ins, lists, at most "###" subheadings); never "#" or "##" ' +
    'headings. Do not use em dashes. Do not include any prose outside the JSON.',
].join('\n');

const FEW_SHOT_RESPONSE: ProseDrafts = {
  definition: [
    'A Button triggers an action when activated. Keep one Filled button per view so the main ' +
      'action stays unambiguous.',
    '',
    '**When to use each type:**',
    '- **Filled**: the single most important action in a view.',
    '- **Outlined**: secondary actions that still need a visible boundary.',
    '- **Text**: low-emphasis actions in dense layouts.',
  ].join('\n'),
  accessibility: [
    '- **Semantics:** render as a native `<button>` so keyboard and screen-reader behaviour work without extra code. Use role="button" only when a non-button element must act as one.',
    '- **Accessible name:** the label names the button. For an icon-only button, supply `aria-label`, since an icon alone announces nothing.',
    '- **Disabled vs aria-disabled:** `disabled` removes the button from the tab order, while `aria-disabled="true"` keeps it focusable to explain why it is unavailable. The design file cannot tell you which to use.',
    '- **Not in the design file:** focus order and live-region behaviour are not encoded in the design. Confirm the focus ring meets WCAG 2.1 contrast (at least 3:1) in implementation.',
  ].join('\n'),
  dos: [
    '**Use the Filled variant for the single most important action in a view.** Its weight tells people where to go next.',
    '**Keep labels to one to three words, verb first** ("Save", "Add item"). People can then scan the action without reading a sentence.',
    '**Use the Text variant in dense toolbars or dialogs.** A filled button there would add visual noise.',
  ],
  donts: [
    "**Don't place more than one Filled button in the same view.** Competing primary actions make it unclear which one matters most.",
    "**Don't use a button for plain navigation.** Screen readers announce links and buttons differently, so use a link (`<a>`) when it just goes somewhere.",
    "**Don't disable a button without explaining why.** A disabled control gives no reason and drops out of the tab order, so use inline validation instead.",
  ],
};

/** Prior conversation turns that demonstrate the target input→output mapping. */
export function proseFewShot(): Array<{ role: 'user' | 'assistant'; content: string }> {
  return [
    { role: 'user', content: FEW_SHOT_PROMPT },
    { role: 'assistant', content: JSON.stringify(FEW_SHOT_RESPONSE) },
  ];
}

/**
 * Build a compact human-readable summary of the spec for the LLM prompt.
 * Never embeds raw serialized-node JSON — only parsed, derived fields.
 */
export function buildProsePrompt(spec: IntermediateSpec): string {
  const lines: string[] = [];

  lines.push(`Component: ${spec.name}`);
  lines.push('');

  // Anatomy
  if (spec.anatomy.length) {
    const parts = spec.anatomy.map((a) => (a.nested ? `${a.name} (component)` : a.name)).join(', ');
    lines.push(`Anatomy: ${parts}`);
  }

  // Props (non-variant)
  const nonVariantProps = spec.props.filter((p) => p.kind !== 'variant');
  if (nonVariantProps.length) {
    lines.push('');
    lines.push('Props:');
    for (const p of nonVariantProps) {
      const def = p.default !== undefined ? ` (default: ${p.default})` : '';
      lines.push(`  ${p.name} [${p.kind}]${def}`);
    }
  }

  // Variant axes — format EXACTLY as "Style: Filled · Outlined"
  if (spec.variants.length) {
    lines.push('');
    lines.push('Variants:');
    for (const v of spec.variants) {
      lines.push(`  ${v.prop}: ${v.values.join(' · ')}`);
    }
  }

  // States
  if (spec.states.length) {
    lines.push('');
    lines.push(`States: ${spec.states.join(', ')}`);
  }

  // Tokens
  if (spec.tokens.length) {
    lines.push('');
    lines.push('Design tokens:');
    for (const t of spec.tokens) {
      const condition = formatConditions(t.conditions);
      const qualifier = condition === '—' ? '' : ` [${condition}]`;
      lines.push(`  ${t.part}.${t.property}${qualifier} → ${t.token}`);
    }
    if (spec.tokens.some((t) => Object.keys(t.conditions).length)) {
      lines.push(
        '  Note: a bracketed condition like [State=Hover] means the token applies only to variants matching those axis values; unbracketed lines apply to all variants.',
      );
    }
  }

  // Layout
  if (spec.layout.length) {
    lines.push('');
    lines.push('Layout (default variant):');
    for (const l of spec.layout) {
      lines.push(`  ${l.part}: ${l.summary}`);
    }
  }

  // Related
  if (spec.related.length) {
    lines.push('');
    lines.push(`Related: ${spec.related.join(', ')}`);
  }

  // Instruction
  lines.push('');
  lines.push(
    'Return ONLY a JSON object with keys: ' +
      "definition (a short paragraph specific to this component's actual props and variants, with no generic filler; when it has several meaningful variants, follow the paragraph with a bulleted \"when to use which\" guide with bold variant names), " +
      'accessibility (a bulleted list; give each bullet a short bold lead-in then the guidance; include one bullet flagging what cannot be known from the design file), ' +
      'dos (string[], 3 to 5 items, each starting with a bold rule summary then the reason), ' +
      'donts (string[], 3 to 5 items, same shape). ' +
      'Use Markdown for structure (bold lead-ins, lists, at most "###" subheadings); never use "#" or "##" headings. ' +
      'Do not include any prose outside the JSON. Do not use em dashes; keep sentences short.',
  );

  return lines.join('\n');
}

/**
 * Normalise punctuation the house style forbids. Em dashes (and spaced en
 * dashes) used as sentence punctuation are replaced with a comma, which reads
 * naturally for the appositive cases models tend to produce. Only horizontal
 * whitespace is matched, so line breaks between Accessibility bullets survive;
 * hyphens and unspaced en dashes (number ranges like 3-5) are left untouched.
 * This is a safety net — the prompt already forbids em dashes — that guarantees
 * the rule even when the model slips.
 */
function normalizeProseText(value: string): string {
  return value
    .replace(/[ \t]*—[ \t]*/g, ', ')
    .replace(/[ \t]+–[ \t]+/g, ', ');
}

/**
 * Coerce a field that should be prose text but which the model sometimes emits
 * as a JSON array of lines (common for "bulleted list" fields like
 * accessibility). Arrays are joined with `joiner`; a plain string passes
 * through; anything else yields null (caller throws).
 */
function asProseText(value: unknown, joiner: (items: string[]) => string): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
    return joiner(value as string[]);
  }
  return null;
}

/** Join free-text paragraphs (definition). */
function joinParagraphs(items: string[]): string {
  return items.join('\n\n');
}

/** Join bullet lines, adding a "- " marker to any line that lacks one. */
function joinBullets(items: string[]): string {
  return items
    .map((s) => (/^\s*(?:[-*]\s|#{1,6}\s)/.test(s) ? s : `- ${s}`))
    .join('\n');
}

/** Accept a string[] or a lone string (wrapped); otherwise null. */
function asStringArray(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
    return value as string[];
  }
  return null;
}

/**
 * Strip optional ```json … ``` fences, trim, parse, and validate the shape.
 */
export function parseProseResponse(text: string): ProseDrafts {
  // Strip code fences — also handles preamble prose before the fence block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenced ? fenced[1].trim() : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse prose response as JSON: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Prose response must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Tolerate the model emitting prose fields as JSON arrays of lines (it often
  // does for the "bulleted list" accessibility field). Only a truly missing /
  // wrong-typed field is fatal.
  const definition = asProseText(obj.definition, joinParagraphs);
  if (definition === null) {
    throw new Error('Prose response missing or invalid field: definition');
  }
  const accessibility = asProseText(obj.accessibility, joinBullets);
  if (accessibility === null) {
    throw new Error('Prose response missing or invalid field: accessibility');
  }
  const dos = asStringArray(obj.dos);
  if (dos === null) {
    throw new Error('Prose response field "dos" must be a string[]');
  }
  const donts = asStringArray(obj.donts);
  if (donts === null) {
    throw new Error('Prose response field "donts" must be a string[]');
  }

  const generatedStrings = [definition, accessibility, ...dos, ...donts];
  // Level-1/2 headings are reserved for the canonical spec sections; the model
  // may use level-3 ("###") and below for sub-structure. Reject only `#`/`##`.
  if (generatedStrings.some((value) => /^#{1,2}(?:\s|$)/m.test(value))) {
    throw new Error('Prose response must not contain level-one or level-two markdown headings (use level-three at most)');
  }

  return {
    definition: normalizeProseText(definition),
    accessibility: normalizeProseText(accessibility),
    dos: dos.map(normalizeProseText),
    donts: donts.map(normalizeProseText),
  };
}

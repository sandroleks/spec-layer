import type { IntermediateSpec } from '../extract';
import { formatConditions } from '../tokens';

/** One anatomy part's AI-supplied role description, keyed by the part name the
 *  model was shown (matched back to the extracted part by name, case-insensitive). */
export interface AnatomyPartProse { name: string; description: string }

export interface ProseDrafts {
  definition: string;
  accessibility: string;
  dos: string[];
  donts: string[];
  variantsSummary?: string;
  anatomySummary?: string;
  anatomyParts?: AnatomyPartProse[];
  interactions?: string;
  designConsiderations?: string;
  contentConsiderations?: string;
}

/** A single JSON key the prose pass can be asked to produce. Callers pass a
 *  subset (see `buildProsePrompt`/`parseProseResponse`) so unchecked doc
 *  sections cost zero output tokens. */
export type ProseKey =
  | 'definition' | 'variantsSummary' | 'anatomySummary' | 'anatomyParts'
  | 'accessibility' | 'interactions' | 'designConsiderations'
  | 'contentConsiderations' | 'dos' | 'donts';

/** Canonical emission order for prose keys (prompt + cache-key signature). */
export const PROSE_KEY_ORDER: ProseKey[] = [
  'definition', 'variantsSummary', 'anatomySummary', 'anatomyParts',
  'accessibility', 'interactions', 'designConsiderations',
  'contentConsiderations', 'dos', 'donts',
];

/** Per-key output-contract fragment. `buildProsePrompt` emits only the fragments
 *  for the requested keys, so the model returns exactly the sections in play. */
const KEY_INSTRUCTIONS: Record<ProseKey, string> = {
  definition:
    'definition (specific to this component, with no generic filler; one sentence defining what it is, then a short benefit-led overview: where it is used, the value it gives people, its role, and a guiding principle; do NOT name specific variants/styles or give a when-to-use guide)',
  variantsSummary:
    'variantsSummary (1-2 sentences on what varies across the options, the axes and their values, then a bulleted "when to use which type" guide with bold type names when it has several meaningful types)',
  anatomySummary:
    'anatomySummary (1-2 sentences describing the overall structure and the role of the key parts; omit when there is no Anatomy above)',
  anatomyParts:
    "anatomyParts (array of { name, description } where each name EXACTLY matches one of the Anatomy part names listed above and description is one concise sentence naming that part's role; omit parts you cannot meaningfully describe, and omit the key entirely when there is no Anatomy above)",
  accessibility:
    'accessibility (a bulleted list; give each bullet a short bold lead-in then the guidance; include one bullet flagging what cannot be known from the design file)',
  interactions:
    'interactions (Markdown grouped under "### Mouse", "### Keyboard", and "### Other" subheadings, 2-3 bullets each; anchor to the States listed above: Hover/Pressed states drive Mouse, a Focused state drives Keyboard (Tab reachability, Enter/Space or arrow activation as fits the component); Other covers screen readers, voice control, and touch-target size; if there is no state axis, write 1-2 bullets total and never invent states)',
  designConsiderations:
    'designConsiderations (3-4 bullets, designer-facing; anchor to the real color tokens and variant axes above: contrast obligations on the actual color tokens, visual distinguishability across the actual variants, and an explicit bullet when an expected state such as Focused is absent from the design)',
  contentConsiderations:
    'contentConsiderations (3-4 bullets; anchor to the text parts in Anatomy: label writing rules for the actual text parts, truncation/overflow behavior, and one internationalization bullet covering text expansion of roughly 30-40% and RTL)',
  dos: 'dos (string[], 3 to 5 items, each starting with a bold rule summary then the reason)',
  donts: 'donts (string[], 3 to 5 items, same shape)',
};

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
  '- Overview: open with ONE sentence defining what the component is (this becomes the header).',
  '  Then a short, benefit-led overview: where and how it is used, the value it gives people, its',
  '  role in the product, and a brief guiding principle. Do NOT name specific variants or styles',
  '  and do NOT give a "when to use which" guide; those belong to the Variants guide below.',
  '- Accessibility: a bulleted list. Give each bullet a short bold lead-in naming the topic, then',
  '  the guidance, for example "- **Keyboard:** ...". Always include a bullet flagging what the',
  '  design file cannot encode (focus order, live-region behaviour, immediate vs deferred effect).',
  '  If the list runs long (about six or more points), group the bullets under level-3 ("###")',
  '  subheadings.',
  '- Variants guide (optional): 1-2 sentences orienting the reader to what varies across the',
  "  component's options (the axes and their values). Then, when it has several meaningful types,",
  '  a bulleted "when to use which type" guide, one per line, type name in bold:',
  '  "- **Filled**: the single most important action.". Do not restate the plain definition.',
  "- Anatomy summary (optional, 1-2 sentences): orient the reader to the component's structure,",
  '  naming its key parts and what each contributes. Describe what the parts are, not how to',
  '  configure them.',
  '- Anatomy parts (optional): for each part listed in the prompt, one concise sentence naming its',
  '  role and why it exists. Match each part name exactly. Describe purpose, not styling. Skip a',
  '  part when you cannot describe it without guessing.',
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
  'Return ONLY a JSON object with keys: definition (one sentence defining what it is, then a ' +
    'short benefit-led overview: where it is used, the value it gives people, its role, and a ' +
    'guiding principle; no style names and no when-to-use guide), ' +
    'variantsSummary (1-2 sentences on what varies across the options, then a bulleted "when to ' +
    'use which type" guide with bold type names when it has several types), ' +
    'anatomySummary (1-2 sentences orienting the reader to the component structure and the role ' +
    'of its key parts), anatomyParts (array of { name, description } where each name EXACTLY ' +
    'matches one of the Anatomy part names above and description is one concise sentence naming ' +
    "that part's role), " +
    'accessibility (a bulleted list; give each bullet a short bold lead-in then the guidance; ' +
    'include one bullet flagging what cannot be known from the design file), ' +
    'interactions (Markdown under "### Mouse", "### Keyboard", "### Other" subheadings, 2-3 bullets ' +
    'each, anchored to the States above), ' +
    'designConsiderations (3-4 designer-facing bullets on contrast, state distinguishability, and ' +
    'missing-state flags), ' +
    'contentConsiderations (3-4 bullets on label writing, truncation, and internationalization), ' +
    'dos (string[], 3 to 5 ' +
    'items, each starting with a bold rule summary then the reason), donts (string[], 3 to 5 items, ' +
    'same shape). Use Markdown (bold lead-ins, lists, at most "###" subheadings); never "#" or "##" ' +
    'headings. Do not use em dashes. Do not include any prose outside the JSON.',
].join('\n');

const FEW_SHOT_RESPONSE: ProseDrafts = {
  definition:
    'A Button triggers an action when activated. Used across products to perform common actions, ' +
    'it gives people a familiar, accessible way to engage with the interface and keeps frequent ' +
    'tasks fast and predictable. It is essential for guiding people through workflows and ' +
    'performing the key actions on a screen. Create buttons that are clear, easy to identify, and ' +
    'accessible.',
  variantsSummary: [
    'Style sets the visual weight and states cover the interactive feedback; all styles share ' +
      'the same anatomy.',
    '',
    '**When to use each type:**',
    '- **Filled**: the single most important action in a view.',
    '- **Outlined**: secondary actions that still need a visible boundary.',
    '- **Text**: low-emphasis actions in dense layouts.',
  ].join('\n'),
  anatomySummary: 'A Button pairs a text label with an optional leading icon inside a single ' +
    'container. The container sets the tap target and carries the visual weight.',
  anatomyParts: [
    { name: 'Container', description: 'Holds the label and icon and defines the clickable area and visual weight.' },
    { name: 'Label', description: 'Names the action in one to three words so people know what the button does.' },
    { name: 'Leading icon', description: 'Optional glyph that reinforces the label; never the only signal of meaning.' },
  ],
  accessibility: [
    '- **Semantics:** render as a native `<button>` so keyboard and screen-reader behaviour work without extra code. Use role="button" only when a non-button element must act as one.',
    '- **Accessible name:** the label names the button. For an icon-only button, supply `aria-label`, since an icon alone announces nothing.',
    '- **Disabled vs aria-disabled:** `disabled` removes the button from the tab order, while `aria-disabled="true"` keeps it focusable to explain why it is unavailable. The design file cannot tell you which to use.',
    '- **Not in the design file:** focus order and live-region behaviour are not encoded in the design. Confirm the focus ring meets WCAG 2.1 contrast (at least 3:1) in implementation.',
  ].join('\n'),
  interactions: [
    '### Mouse',
    '- Clicking anywhere on the container activates the action; the whole button is the target, not just the label.',
    '- On hover the surface changes to signal it is interactive, and the cursor becomes a pointer.',
    '### Keyboard',
    '- Tab moves focus to the button in reading order, and a visible focus ring shows where focus landed.',
    '- Enter or Space activates the focused button.',
    '### Other',
    '- Screen readers announce the label and the button role; an icon-only button needs an explicit name.',
    '- Keep the touch target at least 44 by 44 px so it is comfortable to tap.',
  ].join('\n'),
  designConsiderations: [
    '- Keep label-to-background contrast at 4.5:1 or better in every style so the action stays legible.',
    '- Make the interactive states visually distinct from each other, so hover, focus, and pressed never look identical.',
    '- Confirm a visible focus state exists in build; focus styling is not always encoded in the design file.',
  ].join('\n'),
  contentConsiderations: [
    '- Write labels as a verb-first action in one to three words ("Save", "Add item"), not a vague "OK".',
    '- Plan for labels that wrap or truncate; do not rely on a fixed width holding every translation.',
    '- Allow for text expansion of roughly 30-40% and mirrored layout in right-to-left languages.',
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
export function buildProsePrompt(spec: IntermediateSpec, requested?: Set<ProseKey>): string {
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
      lines.push(`  ${t.part}.${t.property}${qualifier} → ${t.name}`);
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

  // Instruction — emit only the requested keys (default: all keys, in canonical
  // order) so unchecked sections cost no output tokens.
  const keys = requested
    ? PROSE_KEY_ORDER.filter((k) => requested.has(k))
    : PROSE_KEY_ORDER;
  lines.push('');
  lines.push(
    'Return ONLY a JSON object with these keys: ' +
      keys.map((k) => KEY_INSTRUCTIONS[k]).join('; ') + '. ' +
      'Use Markdown for structure (bold lead-ins, lists, at most "###" subheadings); never use "#" or "##" headings. ' +
      'Do not include any prose outside the JSON. Do not use em dashes; keep sentences short.',
  );
  // When both Accessibility and Interactions are in play, keep them from
  // duplicating each other: mechanics go to Interactions, semantics stay in
  // Accessibility.
  if (keys.includes('accessibility') && keys.includes('interactions')) {
    lines.push(
      'Note: keyboard and mouse mechanics belong to Interactions; keep accessibility to semantics, ARIA naming, and the "not in the design file" flag.',
    );
  }

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

/**
 * Validate the optional `anatomyParts` field: an array of { name, description }
 * where both are non-empty strings. Malformed entries are dropped (not fatal);
 * a non-array, or an array with no usable entries, yields undefined. Descriptions
 * are punctuation-normalised like every other prose field.
 */
function parseAnatomyParts(value: unknown): AnatomyPartProse[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AnatomyPartProse[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const description = typeof rec.description === 'string' ? rec.description.trim() : '';
    if (!name || !description) continue;
    out.push({ name, description: normalizeProseText(description) });
  }
  return out.length ? out : undefined;
}

/** Accept a string[] or a lone string (wrapped); otherwise null. */
function asStringArray(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
    return value as string[];
  }
  return null;
}

/** Keys that must be present AND well-typed when requested. The three summary
 *  keys are never hard-required (a missing/wrong-typed value yields undefined). */
const REQUIREDABLE_KEYS: ProseKey[] = [
  'definition', 'accessibility', 'interactions',
  'designConsiderations', 'contentConsiderations', 'dos', 'donts',
];

/**
 * Strip optional ```json … ``` fences, trim, parse, and validate the shape.
 *
 * `requested` makes parsing selection-aware: only requested keys are required,
 * and any key the model emits beyond the request is still parsed if valid.
 * When `requested` is omitted, the historical contract holds (definition,
 * accessibility, dos, donts required) so existing callers are unaffected.
 */
export function parseProseResponse(text: string, requested?: Set<ProseKey>): ProseDrafts {
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

  const required = new Set<ProseKey>(
    requested
      ? REQUIREDABLE_KEYS.filter((k) => requested.has(k))
      : ['definition', 'accessibility', 'dos', 'donts'],
  );

  // Tolerate the model emitting prose fields as JSON arrays of lines (it often
  // does for "bulleted list" fields). A field is fatal only when it is required
  // and missing/wrong-typed; otherwise it degrades to undefined.
  const wantString = (key: ProseKey, joiner: (items: string[]) => string): string | undefined => {
    const v = asProseText(obj[key], joiner);
    if (v === null) {
      if (required.has(key)) throw new Error(`Prose response missing or invalid field: ${key}`);
      return undefined;
    }
    return v;
  };
  const wantArray = (key: ProseKey): string[] | undefined => {
    const v = asStringArray(obj[key]);
    if (v === null) {
      if (required.has(key)) throw new Error(`Prose response field "${key}" must be a string[]`);
      return undefined;
    }
    return v;
  };

  const definition = wantString('definition', joinParagraphs);
  const accessibility = wantString('accessibility', joinBullets);
  const interactions = wantString('interactions', joinBullets);
  const designConsiderations = wantString('designConsiderations', joinBullets);
  const contentConsiderations = wantString('contentConsiderations', joinBullets);
  const dos = wantArray('dos');
  const donts = wantArray('donts');

  // variantsSummary / anatomySummary / anatomyParts are optional and non-critical:
  // missing or wrong-typed simply yields undefined rather than a thrown error.
  const rawVariantsSummary = asProseText(obj.variantsSummary, joinParagraphs);
  const variantsSummary = rawVariantsSummary === null ? undefined : rawVariantsSummary;
  const rawAnatomySummary = asProseText(obj.anatomySummary, joinParagraphs);
  const anatomySummary = rawAnatomySummary === null ? undefined : rawAnatomySummary;
  const anatomyParts = parseAnatomyParts(obj.anatomyParts);

  const generatedStrings = [
    definition, accessibility, interactions, designConsiderations, contentConsiderations,
    variantsSummary, anatomySummary,
    ...(dos ?? []), ...(donts ?? []),
    ...(anatomyParts?.map((p) => p.description) ?? []),
  ].filter((s): s is string => typeof s === 'string');
  // Level-1/2 headings are reserved for the canonical spec sections; the model
  // may use level-3 ("###") and below for sub-structure. Reject only `#`/`##`.
  if (generatedStrings.some((value) => /^#{1,2}(?:\s|$)/m.test(value))) {
    throw new Error('Prose response must not contain level-one or level-two markdown headings (use level-three at most)');
  }

  const norm = (s: string | undefined): string | undefined =>
    s === undefined ? undefined : normalizeProseText(s);

  return {
    // The historical four stay non-optional on the shape (default to empty) so
    // existing consumers keep working; they are only non-fatal when unrequested.
    definition: normalizeProseText(definition ?? ''),
    accessibility: normalizeProseText(accessibility ?? ''),
    dos: (dos ?? []).map(normalizeProseText),
    donts: (donts ?? []).map(normalizeProseText),
    ...(variantsSummary !== undefined ? { variantsSummary: normalizeProseText(variantsSummary) } : {}),
    ...(anatomySummary !== undefined ? { anatomySummary: normalizeProseText(anatomySummary) } : {}),
    ...(anatomyParts ? { anatomyParts } : {}),
    ...(norm(interactions) !== undefined ? { interactions: norm(interactions)! } : {}),
    ...(norm(designConsiderations) !== undefined ? { designConsiderations: norm(designConsiderations)! } : {}),
    ...(norm(contentConsiderations) !== undefined ? { contentConsiderations: norm(contentConsiderations)! } : {}),
  };
}

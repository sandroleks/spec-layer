/**
 * prompt.ts: the frozen v8 contract bytes, plus the text helpers the v9 path
 * shares.
 *
 * Everything named `LEGACY_*` here is the request the shipped 5.1.0 plugin
 * still sends. The proxy validates those bytes so that build keeps working
 * until 6.0.0 is live; nothing in the plugin imports them any more. Delete
 * them together with the proxy's legacy branch after the release.
 *
 * What is not legacy is shared: `replaceAround` (dash normalisation, behind
 * `v2.ts`'s `normalizeDashes`), `fencedBlock` (code-fence extraction, behind
 * `promptV2.ts`'s parser), and the `ProseDrafts` shape, which the brief, the
 * v5 component context, and stored documents still read.
 *
 * Pure: no Figma, no DOM.
 */

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

/**
 * The v8 system prompt, frozen. The shipped 5.1.0 plugin sends these exact
 * bytes and the proxy compares them byte for byte, so this is a wire contract
 * rather than a style document: editing one character stops that build
 * generating. Nothing in the plugin imports it. Delete it, the exemplar below,
 * the two caps, and the proxy's legacy branch once 6.0.0 is live.
 */
export const LEGACY_PROSE_SYSTEM_PROMPT = [
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

/** The v8 exemplar turns, frozen for the same reason as the system prompt
 *  above: the proxy compares them byte for byte against what 5.1.0 sends. */
const LEGACY_FEW_SHOT_PROMPT = [
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

const LEGACY_FEW_SHOT_RESPONSE: ProseDrafts = {
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

/** The v8 prior turns, as 5.1.0 sends them. */
export function legacyProseFewShot(): Array<{ role: 'user' | 'assistant'; content: string }> {
  return [
    { role: 'user', content: LEGACY_FEW_SHOT_PROMPT },
    { role: 'assistant', content: JSON.stringify(LEGACY_FEW_SHOT_RESPONSE) },
  ];
}

/** The v8 output caps, frozen alongside the bytes above. */
export const LEGACY_PROSE_MAX_TOKENS = 3000;
export const LEGACY_GROUP_MAX_TOKENS = 1200;

/** One character's worth of `[ \t]`. Horizontal only, so a line break between
 *  bullets survives, which is the whole reason the classes are not `\s`. */
const isHorizontalSpace = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * Replace every `separator`, together with the horizontal whitespace hugging
 * it, with `replacement`. `requireSpace` demands at least one space or tab on
 * BOTH sides, which is the only thing that distinguished the en-dash rule
 * (`[ \t]+–[ \t]+`) from the em-dash one (`[ \t]*—[ \t]*`).
 *
 * One left-to-right pass, because both of those regexes are quadratic on a run
 * of horizontal whitespace that never reaches a dash: 40k spaces measured 2.5
 * seconds for the en-dash rule. This runs on model output, which is the one
 * input here nobody in this repository controls.
 *
 * `from` is the boundary of what a previous replacement already consumed, and
 * the left scan will not cross it. That is what `lastIndex` did for the `g`
 * regexes, and it is what makes two adjacent dashes collapse the same way.
 *
 * Exported so `prose/v2.ts`'s `normalizeDashes` can call this implementation
 * instead of keeping its own copy: one algorithm, and `redos.test.ts`'s
 * fuzz and timing coverage (pinned on `normalizeDashes`) backs both callers
 * instead of only this one.
 */
export function replaceAround(
  value: string, separator: string, replacement: string, requireSpace: boolean,
): string {
  let out = '';
  let from = 0;
  let cursor = 0;
  for (;;) {
    const at = value.indexOf(separator, cursor);
    if (at === -1) break;
    let left = at;
    while (left > from && isHorizontalSpace(value[left - 1])) left--;
    const afterSeparator = at + separator.length;
    let right = afterSeparator;
    while (right < value.length && isHorizontalSpace(value[right])) right++;
    if (requireSpace && (left === at || right === afterSeparator)) {
      // The `+` on one side saw nothing, so the pattern does not match here.
      // Leave this separator and its neighbours exactly as they are.
      cursor = afterSeparator;
      continue;
    }
    out += value.slice(from, left) + replacement;
    from = right;
    cursor = right;
  }
  return out + value.slice(from);
}

/**
 * The contents of the first ```json … ``` fence, or null when the text carries
 * no closed fence.
 *
 * Replaces `text.match(/```(?:json)?\s*([\s\S]*?)```/)`, whose greedy `\s*`
 * ahead of a lazy `[\s\S]*?` is quadratic on an opened fence followed by a
 * long whitespace run that never closes: the engine gives back one whitespace
 * character at a time and rescans the rest for a closing fence each time.
 * This is model output, so an unclosed fence is a thing that actually happens.
 *
 * Deliberately the same answer the regex gave, position for position. Leftmost
 * opener, because the pattern was unanchored; `json` consumed when present,
 * because `(?:json)?` is greedy; the whitespace run consumed whole, because
 * `\s*` is greedy and is tried at its longest first; and the content ending at
 * the NEXT fence, because `[\s\S]*?` is lazy. A later opener can never win
 * where the first one loses: the first one only loses when no fence follows it
 * at all, and `json` and whitespace contain no backticks to hide one behind.
 */
export function fencedBlock(text: string): string | null {
  const open = text.indexOf('```');
  if (open === -1) return null;
  let start = open + 3;
  if (text.startsWith('json', start)) start += 4;
  while (start < text.length && FENCE_WHITESPACE.test(text[start])) start++;
  const close = text.indexOf('```', start);
  return close === -1 ? null : text.slice(start, close);
}

/** One character's worth of `\s`, for the same reason `cleanPartName` keeps
 *  its own: a per-character test cannot be made to backtrack. */
const FENCE_WHITESPACE = /\s/;

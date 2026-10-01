/**
 * The frozen v8 contract bytes, plus text helpers the v9 path shares.
 *
 * Every `LEGACY_*` is the request the 5.1.0 plugin still sends, which the
 * proxy validates byte for byte; the plugin no longer imports them. Delete them
 * with the proxy's legacy branch once 5.1.0 traffic has stopped. `replaceAround`,
 * `fencedBlock` and `ProseDrafts` are live.
 */

/** Keyed by the part name the model was shown, matched back case-insensitively. */
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
  /** The brief's snake_case `guidelines` fields a person typed on the canvas.
   *  Absent when none. Set by `proseToLegacy`, never by the model. */
  authored?: string[];
}

/** The v8 system prompt: a wire contract, so editing one character stops 5.1.0
 *  generating. */
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

/** The v8 exemplar turns, frozen like the system prompt. */
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

/** The v8 output caps, frozen. */
export const LEGACY_PROSE_MAX_TOKENS = 3000;
export const LEGACY_GROUP_MAX_TOKENS = 1200;

/** The v8 foundation group system prompt, sent by 5.1.0 under a
 *  `prose:v1:groups:` key; a frozen wire contract. The v9 client sends
 *  `FOUNDATION_SYSTEM_PROMPT`. */
export const LEGACY_FOUNDATION_SYSTEM_PROMPT = [
  'You write short descriptions of design-token groups for a design-system reference.',
  'Each description sits under a group heading in a generated documentation frame.',
  '',
  'You are given the token names in the group and their resolved values. That is ALL you know.',
  'Describe what the group is for, as its names and values actually show.',
  '',
  'Never invent: no component names the tokens do not mention, no counts, no accessibility',
  'claims, no history, no rules the names do not support. If the names are too generic to',
  'support a purpose, describe the shape of the set plainly instead and stop. A vague but true',
  'sentence is correct; a specific but invented one is a defect.',
  '',
  'Voice:',
  '- One or two sentences. Under 220 characters. No heading, no list, no markdown.',
  '- Plain and factual, the tone of a peer explaining their own file.',
  '- Say what the group is for and when to reach for it. Lead with the purpose, not "This group".',
  '- Write for people, not "the user".',
  '- Never use em dashes or en dashes. Use a period, comma, colon, or parentheses.',
  '- Do not restate the heading as a sentence ("Surface colours are colours for surfaces").',
  '',
  'Return ONLY a JSON object mapping each group key to its description string.',
  'No prose outside the JSON, no code fence.',
].join('\n');

/** Horizontal only, not `\s`, so a line break between bullets survives. */
const isHorizontalSpace = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * Replace every `separator` and the horizontal whitespace hugging it with
 * `replacement`. `requireSpace` demands a space or tab on BOTH sides (the
 * en-dash rule's `+`; the em-dash rule used `*`).
 *
 * One linear pass, because those `g` regexes are quadratic on whitespace runs
 * and this runs on model output. The left scan never crosses `from`, as
 * `lastIndex` never did, so adjacent dashes collapse the same way.
 * `redos.test.ts` pins it through `normalizeDashes` in `v2.ts`.
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
      // The `+` on one side saw nothing: no match, leave it as is.
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
 * The contents of the first ```json … ``` fence, or null with no closed fence.
 *
 * Replaces the quadratic `/```(?:json)?\s*([\s\S]*?)```/` and gives the same
 * answer position for position: leftmost opener, `json` and the whitespace run
 * consumed greedily, content ending at the NEXT fence (lazy). A later opener
 * never wins where the first loses, since `json` and whitespace hide no
 * backticks.
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

/** A per-character test cannot backtrack. */
const FENCE_WHITESPACE = /\s/;

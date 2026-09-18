/**
 * promptV2.ts: the v9 prose prompt. One structured call per component that
 * returns a `ProseV2` object (see `./v2.ts`).
 *
 * The model sees only parsed, derived facts: names, kinds, axes, states,
 * bindings and layout summaries. Never a node id, a file key, a variant
 * instance id, raw node JSON, or a hash. `promptV2.test.ts` guards that, and
 * `proseCacheKey` hashes exactly this text, so anything that reaches the
 * prompt moves the key and anything that does not cannot.
 *
 * Pure: no Figma, no DOM. Bundled into the plugin main thread and UI.
 */
import { extract, type IntermediateSpec } from '../extract';
import type { AnatomyPart } from '../anatomy';
import type { SerializedNode } from '../tree';
import { detectStateMatrix } from '../statesMatrix';
import { formatConditions } from '../tokens';
import { displayComponentName } from '../displayNames';
import { PROSE_V2_KEYS, KEYBOARD_KEYS, type ProseV2Key, type ProseV2 } from './v2';
import { fencedBlock } from './prompt';

/** The proxy anchors its final-message check on this exact string. */
export const PROMPT_RETURN_ANCHOR = '\nReturn ONLY a JSON object with these keys: ';

/**
 * A part's kind in words, from its Figma type. The model reasons better about
 * "text" and "nested component Icon" than about `TEXT` and `INSTANCE`.
 */
export function partKind(part: AnatomyPart): string {
  if (part.nested) return `nested component ${part.component ?? 'component'}`;
  switch (part.type) {
    case 'TEXT': return 'text';
    case 'VECTOR': case 'BOOLEAN_OPERATION': case 'STAR': case 'POLYGON': case 'LINE': return 'vector';
    case 'RECTANGLE': case 'ELLIPSE': return 'shape';
    case 'FRAME': case 'GROUP': case 'SECTION': case 'COMPONENT': case 'INSTANCE': return 'container';
    default: return part.type.toLowerCase();
  }
}

/**
 * Per-key output-contract fragments. Only the requested keys are emitted, so
 * an unchecked section costs no output tokens. Every fragment names the exact
 * shape and the honesty rule for that key.
 */
export const PROSE_KEY_INSTRUCTIONS: Record<ProseV2Key, string> = {
  overview:
    'overview ({ lede, body }: lede is one sentence saying what the component is and what a person does with it; body is at most one short paragraph, one or two sentences, on where it appears and what it holds; describe, never explain or justify; no option names)',
  whenToUse:
    'whenToUse (string[], 2 to 4 concrete situations where this component is the right choice; each names a task or context, never a rule about how to use it)',
  whenNotToUse:
    'whenNotToUse (string[], 2 to 3 situations where another control fits better, each phrased "For <situation>, use <alternative> instead" with the reason after a semicolon; never start with "Do not"; name another component only if it is listed under Related above)',
  variantsIntro:
    'variantsIntro (one or two sentences on what the option axes change; never mention states)',
  variantsGuide:
    'variantsGuide ({ name, guidance }[] with one entry per option value listed under Options above, name spelled exactly as listed, guidance one sentence on when to choose it; omit state values)',
  anatomySummary:
    'anatomySummary (one or two sentences on how the parts fit together)',
  anatomyParts:
    'anatomyParts ({ name, role }[] with name exactly as listed under Anatomy above and role one sentence on what the part does, not how it looks; skip a part you cannot describe without guessing)',
  properties:
    'properties ({ name, description }[] with name exactly as listed under Options, State axis or Properties above and description one sentence on what the property controls and when to change it)',
  states:
    'states ({ name, whenItApplies }[] with name exactly as listed under States above and whenItApplies one sentence on when the state applies)',
  // The vocabulary is read from KEYBOARD_KEYS rather than written out again:
  // `validateProseV2` drops a row whose key is not in that list, so a literal
  // here could ask for a key the validator then throws away, or leave out one
  // it would have accepted.
  keyboard:
    `keyboard ({ keys: string[], action }[] with each key one of ${KEYBOARD_KEYS.join(', ')}, and action one sentence; include only bindings this component really has, and leave the key out for a non-interactive component)`,
  pointer:
    'pointer (string[], 2 to 3 sentences on mouse and touch behaviour, including target size)',
  semantics:
    'semantics (string[], 3 to 4 sentences on roles, accessible names, and announcements, plus one on what the design file cannot encode)',
  content:
    'content (string[], 3 to 4 sentences on writing the text parts listed under Anatomy, on truncation, and on translation)',
  guidelines:
    'guidelines ({ do: { rule, reason }, dont: { rule, reason } }[], 3 pairs about using this component once chosen; each pair covers one topic drawn from its options, states or text parts, the dont mirrors the do, and no pair repeats a When to use or When not to use bullet; each rule one sentence, each reason one sentence)',
};

/** Default value of a variant axis, from its component property. */
function axisDefault(spec: IntermediateSpec, axis: string): string | undefined {
  const prop = spec.props.find((p) => p.name === axis && p.kind === 'variant');
  return typeof prop?.default === 'string' ? prop.default : undefined;
}

/** One character's worth of `\s`. A per-character test cannot backtrack. */
const WHITESPACE = /\s/;

/**
 * Collapse every whitespace run that contains a line break into one space, and
 * leave every other whitespace run alone. This is exactly what a global
 * replace of `\s*\n\s*` with one space did: the greedy `\s*` on either side of
 * the `\n` always swallowed the whole run. That regex is quadratic on a long run of
 * spaces that never reaches a line break, because every position in the run
 * retries the whole run looking for one, and the description it ran over is
 * typed by the designer, so its length is not this repository's to control
 * (CodeQL alert 67, `js/polynomial-redos`). One pass, pinned against the regex
 * in `redos.test.ts`.
 */
export function collapseLineBreaks(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (!WHITESPACE.test(text[i])) { out += text[i]; i += 1; continue; }
    let j = i;
    let hasBreak = false;
    while (j < text.length && WHITESPACE.test(text[j])) {
      if (text[j] === '\n') hasBreak = true;
      j += 1;
    }
    out += hasBreak ? ' ' : text.slice(i, j);
    i = j;
  }
  return out;
}

/**
 * Build the user message for one component. Only the requested keys are asked
 * for (default: every key, in `PROSE_V2_KEYS` order).
 */
export function buildProsePrompt(spec: IntermediateSpec, requested?: ReadonlySet<ProseV2Key>): string {
  const lines: string[] = [];

  const display = displayComponentName(spec.name);
  lines.push(display === spec.name ? `Component: ${spec.name}` : `Component: ${display} (layer name: ${spec.name})`);

  const description = spec.description.trim();
  if (description) {
    lines.push('');
    lines.push("Designer's description (authoritative; build on it, never contradict or restate it):");
    lines.push(`  ${collapseLineBreaks(description)}`);
  }

  if (spec.anatomy.length) {
    lines.push('');
    lines.push('Anatomy (depth-first; indent marks nesting):');
    for (const part of spec.anatomy) {
      const indent = '  '.repeat(part.depth + 1);
      const shown = part.shownBy ? `; shown by ${part.shownBy}` : '';
      lines.push(`${indent}${part.name}: ${partKind(part)}${shown}`);
    }
  }

  const matrix = detectStateMatrix(spec.variants);
  const stateAxis = matrix?.axis ?? null;
  const optionAxes = spec.variants.filter((v) => v.prop !== stateAxis);
  if (optionAxes.length) {
    lines.push('');
    lines.push('Options:');
    for (const v of optionAxes) {
      const def = axisDefault(spec, v.prop);
      lines.push(`  ${v.prop}: ${v.values.join(' · ')}${def ? ` (default ${def})` : ''}`);
    }
  }
  if (stateAxis) {
    const axis = spec.variants.find((v) => v.prop === stateAxis);
    if (axis) {
      lines.push('');
      lines.push('State axis:');
      lines.push(`  ${axis.prop}: ${axis.values.join(' · ')}`);
    }
  }

  const otherProps = spec.props.filter((p) => p.kind !== 'variant');
  if (otherProps.length) {
    lines.push('');
    lines.push('Properties:');
    for (const p of otherProps) {
      const def = p.default !== undefined ? ` (default: ${p.default})` : '';
      lines.push(`  ${p.name} [${p.kind}]${def}`);
    }
  }

  if (spec.states.length) {
    lines.push('');
    lines.push(`States: ${spec.states.join(', ')}`);
  }

  if (spec.tokens.length) {
    lines.push('');
    lines.push('Design tokens:');
    for (const t of spec.tokens) {
      const condition = formatConditions(t.conditions);
      const qualifier = condition === '—' ? '' : ` [${condition}]`;
      lines.push(`  ${t.part}.${t.property}${qualifier} → ${t.name}`);
    }
    if (spec.tokens.some((t) => Object.keys(t.conditions).length)) {
      lines.push('  Note: a bracketed condition like [State=Hover] means the token applies only to variants matching those axis values; unbracketed lines apply to all variants.');
    }
  }

  if (spec.layout.length) {
    lines.push('');
    lines.push('Layout (default variant):');
    for (const l of spec.layout) lines.push(`  ${l.part}: ${l.summary}`);
  }

  if (spec.related.length) {
    lines.push('');
    lines.push(`Related: ${spec.related.join(', ')}`);
  }

  const keys = requested ? PROSE_V2_KEYS.filter((k) => requested.has(k)) : [...PROSE_V2_KEYS];
  lines.push('');
  lines.push(
    PROMPT_RETURN_ANCHOR.trimStart() +
      keys.map((k) => PROSE_KEY_INSTRUCTIONS[k]).join('; ') + '. ' +
      'Leave out any key you cannot fill honestly. ' +
      'Markdown only as **bold** or `code` inside a sentence; no headings. ' +
      'No em dashes; keep sentences short. Return only the JSON object.',
  );
  return lines.join('\n');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A string, or a string[] with every item a string; a lone string becomes a
 *  one-item list. Anything else is null (the field is dropped). */
function asStringList(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) return value as string[];
  return null;
}

/** An array of plain objects; anything else is null. Item shapes are left to
 *  `validateProseV2`, which checks names against the spec and drops the rest. */
function asRecordList(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || !value.every(isRecord)) return null;
  return value as Record<string, unknown>[];
}

/**
 * Parse the model's text into a `ProseV2` shaped object. Strips a code fence
 * and preamble, requires a JSON object, keeps only the fourteen contract keys
 * with their declared shapes, and adds `v: 2`. Names, vocabulary, dashes,
 * headings and empties are `validateProseV2`'s job; this only decides what is
 * a string, a list or a keyed list.
 */
export function parseProseResponse(text: string): ProseV2 {
  const fenced = fencedBlock(text);
  const cleaned = fenced !== null ? fenced.trim() : text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse prose response as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(parsed)) throw new Error('Prose response must be a JSON object');

  const out: ProseV2 = { v: 2 };
  const o = parsed;

  if (isRecord(o.overview)) {
    const lede = typeof o.overview.lede === 'string' ? o.overview.lede : '';
    const body = asStringList(o.overview.body) ?? [];
    out.overview = { lede, body };
  }
  for (const key of ['whenToUse', 'whenNotToUse', 'pointer', 'semantics', 'content'] as const) {
    const list = asStringList(o[key]);
    if (list) out[key] = list;
  }
  for (const key of ['variantsIntro', 'anatomySummary'] as const) {
    if (typeof o[key] === 'string') out[key] = o[key] as string;
  }
  const variantsGuide = asRecordList(o.variantsGuide);
  if (variantsGuide) out.variantsGuide = variantsGuide as unknown as ProseV2['variantsGuide'];
  const anatomyParts = asRecordList(o.anatomyParts);
  if (anatomyParts) out.anatomyParts = anatomyParts as unknown as ProseV2['anatomyParts'];
  const properties = asRecordList(o.properties);
  if (properties) out.properties = properties as unknown as ProseV2['properties'];
  const states = asRecordList(o.states);
  if (states) out.states = states as unknown as ProseV2['states'];
  const keyboard = asRecordList(o.keyboard);
  if (keyboard) out.keyboard = keyboard as unknown as ProseV2['keyboard'];
  const guidelines = asRecordList(o.guidelines);
  if (guidelines) out.guidelines = guidelines as unknown as ProseV2['guidelines'];
  return out;
}

/** Cap on the component call. About three exemplar responses, plus the
 *  thinking tokens Sonnet 5 spends at low effort, which count against it. */
export const PROSE_MAX_TOKENS = 6000;

/** Filler the spec bans by name. The system prompt quotes each one; tests
 *  scan the exemplar and the prompt's own prose for them. */
export const BANNED_PHRASES: readonly string[] = [
  'familiar', 'essential', 'intuitive', 'seamless', 'engage with the interface',
  'clear, easy to identify', 'gives people a way to', 'plays a key role',
];

/**
 * The v9 system prompt. Billed on every call, so it is short and every line
 * is a rule the parser or the validator cannot enforce alone.
 */
export const PROSE_SYSTEM_PROMPT = [
  'You write component documentation for a design system, in the voice of a senior designer explaining their own component to a colleague.',
  '',
  'Voice:',
  '- Second person, verb first, one idea per sentence. Every rule carries its reason.',
  '- Anchor guidance in concrete situations: forms, dialogs, toolbars, lists, filters.',
  '- Write for people, not "the user".',
  '- Describe, do not argue. No sentence explains why the component reads or feels a certain way, and nothing is "rather than" something else.',
  '',
  'Facts:',
  "- Name only what the prompt lists: this component's parts, properties, option values, states, and related components. Never invent an option, a part, a state, or a component.",
  "- The designer's description, when given, is authoritative. Build on it. Never contradict it and never restate it.",
  '- States are not variants. The variants guide covers option axes only; states go in the states list.',
  '- Say each fact once. When to use and When not to use are about choosing this component over another; the guidelines are about using it well once chosen.',
  `- Keyboard rows use only these keys: ${KEYBOARD_KEYS.join(', ')}.`,
  '',
  'Words to avoid:',
  `- Do not write ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}.`,
  '- Do not restate a heading as a sentence.',
  '',
  'Format:',
  '- No em dashes and no spaced en dashes. Use a comma, a colon, or a full stop.',
  '- No headings inside strings. Markdown only as **bold** or `code` inside a sentence.',
  '- Return only the JSON object the message asks for, with only the keys it lists. Leave out a key you cannot fill honestly.',
].join('\n');

// ---------------------------------------------------------------------------
// The exemplar: a Text field, extracted from a synthetic node tree so its
// prompt is produced by the real builder and can never drift from it.
// ---------------------------------------------------------------------------

function exemplarVariant(state: string): SerializedNode {
  const bind = (property: string, name: string) => ({
    property, id: `VariableID:${name}`, name, kind: 'variable' as const, remote: false,
    collectionId: 'VariableCollectionId:exemplar',
  });
  const border = state === 'Focused' ? 'color/border/focus' : state === 'Error' ? 'color/border/error' : 'color/field/border';
  return {
    id: `x:${state}`, name: `Size=Medium, Style=Filled, State=${state}`, type: 'COMPONENT', visible: true,
    layout: { mode: 'VERTICAL', itemSpacing: 4 },
    children: [
      { id: `x:${state}:label`, name: 'Label', type: 'TEXT', visible: true, bindings: [bind('fills', 'color/text/secondary')] },
      {
        id: `x:${state}:input`, name: 'Input', type: 'FRAME', visible: true,
        layout: { mode: 'HORIZONTAL', paddingLeft: 12, paddingRight: 12, itemSpacing: 8 },
        bindings: [bind('fills', 'color/field/bg'), bind('strokes', border)],
        children: [
          { id: `x:${state}:icon`, name: 'Leading icon', type: 'INSTANCE', visible: false,
            visibleProperty: 'Show leading icon', mainComponent: { name: 'Icon', key: 'exemplar-icon' } },
          { id: `x:${state}:placeholder`, name: 'Placeholder', type: 'TEXT', visible: true, bindings: [bind('fills', 'color/text/placeholder')] },
        ],
      },
      { id: `x:${state}:helper`, name: 'Helper text', type: 'TEXT', visible: true, bindings: [bind('fills', 'color/text/secondary')] },
    ],
  };
}

/** The synthetic component set the exemplar is extracted from. Exported so a
 *  test can prove the exemplar's names are real. */
export function exemplarNode(): SerializedNode {
  return {
    id: 'x:0', name: 'Text field', type: 'COMPONENT_SET', visible: true, key: 'exemplar-text-field',
    description: 'A single-line field where people type short, free-form text.',
    propertyDefinitions: {
      Size: { type: 'VARIANT', defaultValue: 'Medium', variantOptions: ['Small', 'Medium'] },
      Style: { type: 'VARIANT', defaultValue: 'Filled', variantOptions: ['Filled', 'Outlined'] },
      State: { type: 'VARIANT', defaultValue: 'Enabled', variantOptions: ['Enabled', 'Hover', 'Focused', 'Error', 'Disabled'] },
      'Show leading icon': { type: 'BOOLEAN', defaultValue: false },
      'Show helper text': { type: 'BOOLEAN', defaultValue: true },
      Label: { type: 'TEXT', defaultValue: 'Label' },
      Placeholder: { type: 'TEXT', defaultValue: 'Placeholder' },
    },
    children: ['Enabled', 'Hover', 'Focused', 'Error', 'Disabled'].map(exemplarVariant),
  };
}

export function exemplarSpec(): IntermediateSpec {
  return extract(exemplarNode(), { figmaFile: 'exemplar' });
}

/** The exemplar's user turn: the real builder over the real extraction. */
export const EXEMPLAR_PROMPT = buildProsePrompt(exemplarSpec());

/** The exemplar's answer, in the house voice. Complete on purpose: it is the
 *  one demonstration of every key, and it is billed on every call, so every
 *  sentence has to earn its place. `promptV2.test.ts` validates it against the
 *  exemplar spec with zero drops and scans it for the banned phrases. */
export const EXEMPLAR_RESPONSE: ProseV2 = {
  v: 2,
  overview: {
    lede: 'A text field takes a short, single-line answer such as a name, an email address, or a search term.',
    body: [
      'Use it inside forms, dialogs, and filters wherever people type a value the product stores or acts on. The label says what to enter, the placeholder shows the expected shape, and the helper text explains a rule first.',
    ],
  },
  whenToUse: [
    'Collect one short value that fits on a line, such as a name, a code, or a quantity.',
    'Let people search or filter a list by typing, with results updating live.',
    'Ask for a value that must match a format, such as an email address or a postcode.',
  ],
  whenNotToUse: [
    'For long or multi-line answers, use a text area instead; a single line hides most of the text.',
    'For a fixed set of valid answers, use a select or a set of options instead; a list prevents typos.',
    'For a value people only read, use plain text instead; a field invites typing that goes nowhere.',
  ],
  variantsIntro: 'Size sets the row height for dense or relaxed layouts, and Style sets how the field meets its background.',
  variantsGuide: [
    { name: 'Filled', guidance: 'The default on light surfaces, where the fill marks the typing area.' },
    { name: 'Outlined', guidance: 'On tinted or busy surfaces, where a border reads more clearly than a fill.' },
    { name: 'Small', guidance: 'Dense forms, tables, and toolbars where vertical space is scarce.' },
    { name: 'Medium', guidance: 'Standard forms and dialogs; the comfortable default.' },
  ],
  anatomySummary: 'A label sits above an input row, and helper text sits below it. The input holds the placeholder and an optional leading icon.',
  anatomyParts: [
    { name: 'Label', role: 'Names the value people enter and stays visible while they type.' },
    { name: 'Input', role: 'The typing area; its fill and border carry the state colours.' },
    { name: 'Leading icon', role: 'An optional glyph, such as a magnifier for search, that hints at the value and is never the only cue.' },
    { name: 'Placeholder', role: 'Shows an example value and disappears once someone types.' },
    { name: 'Helper text', role: 'Explains a format rule, and carries the error message in the Error state.' },
  ],
  properties: [
    { name: 'Size', description: 'Row height: Small for dense layouts, Medium for standard forms.' },
    { name: 'Style', description: 'How the field meets its surface: a fill or an outline.' },
    { name: 'State', description: 'The interaction state the variant shows; the product sets it at runtime.' },
    { name: 'Show leading icon', description: 'Adds a glyph at the start of the input row.' },
    { name: 'Show helper text', description: 'Shows the helper text line under the field.' },
    { name: 'Label', description: 'The label text; write it as a short noun phrase.' },
    { name: 'Placeholder', description: 'An example value; never the only place the instruction lives.' },
  ],
  states: [
    { name: 'Enabled', whenItApplies: 'The field is ready for input with nothing wrong.' },
    { name: 'Hover', whenItApplies: 'The pointer is over the field, signalling it can be edited.' },
    { name: 'Focused', whenItApplies: 'The field has keyboard focus and keystrokes go into it.' },
    { name: 'Error', whenItApplies: 'Validation failed; the helper text carries the message.' },
    { name: 'Disabled', whenItApplies: 'The value cannot be edited now, but the field stays visible.' },
  ],
  keyboard: [
    { keys: ['Tab'], action: 'Moves focus into the field, then to the next control.' },
    { keys: ['Shift+Tab'], action: 'Moves focus back to the previous control.' },
    { keys: ['Enter'], action: 'Submits the form when the field is the last one.' },
    { keys: ['Escape'], action: 'Clears an in-progress search when the field filters a list.' },
  ],
  pointer: [
    'Clicking or tapping the input row places the caret and focuses the field.',
    'Clicking the label also focuses the field, so it counts toward the tap target.',
    'Keep the input row at least 44 points tall on touch screens.',
  ],
  semantics: [
    'Render as a native input with the label associated to it, so screen readers announce it on focus.',
    'Announce the error message with the field, for example through aria-describedby.',
    'Keep the placeholder out of the accessible name; many screen readers skip it.',
    'The design file does not encode the input type or autocomplete hints; set those in code.',
  ],
  content: [
    'Write the label as a short noun phrase ("Email address"), not a question.',
    'Use the placeholder for an example format ("name@example.com"), never the instruction.',
    'Write the error message as what to do next, not what went wrong in system terms.',
    'Allow for labels that run longer in translation, and for mirroring of the leading icon.',
  ],
  guidelines: [
    {
      do: { rule: 'Keep the label visible while people type.', reason: 'A label that becomes a placeholder disappears when needed most.' },
      dont: { rule: 'Do not rely on the placeholder as the only label.', reason: 'It vanishes on the first keystroke, and screen readers often skip it.' },
    },
    {
      do: { rule: 'Validate on blur or on submit, in the helper text line.', reason: 'The message appears where people already look, and layout does not jump.' },
      dont: { rule: 'Do not flag an error while someone is still typing.', reason: 'Early errors read as scolding before the format is even finished.' },
    },
    {
      do: { rule: 'Use one Size across a single form.', reason: 'Mixed heights break the vertical rhythm of the layout.' },
      dont: { rule: 'Do not mix Sizes within one form to make a field stand out.', reason: 'Emphasis by height reads as a mistake, not as a hierarchy.' },
    },
  ],
};

export type ProseContentBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
export interface ProseRequestMessage { role: 'user' | 'assistant'; content: string | ProseContentBlock[] }

/**
 * The two prior turns every request carries. The assistant turn is a content
 * block array so it can hold the one prompt-cache breakpoint: everything up to
 * and including it (system prompt, exemplar prompt, exemplar answer) is the
 * stable prefix, and the component's own message follows it uncached. Sonnet 5
 * caches prefixes from 1,024 tokens; Haiku 4.5 needs 4,096 and this prefix is
 * about 2,200, so free requests simply do not cache. That costs nothing.
 */
export function proseFewShot(): [ProseRequestMessage, ProseRequestMessage] {
  return [
    { role: 'user', content: EXEMPLAR_PROMPT },
    {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(EXEMPLAR_RESPONSE), cache_control: { type: 'ephemeral' } }],
    },
  ];
}

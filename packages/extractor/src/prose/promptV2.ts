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
import type { IntermediateSpec } from '../extract';
import type { AnatomyPart } from '../anatomy';
import { detectStateMatrix } from '../statesMatrix';
import { formatConditions } from '../tokens';
import { displayComponentName } from '../displayNames';
import { PROSE_V2_KEYS, type ProseV2Key, type ProseV2 } from './v2';
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
    'overview ({ lede, body }: lede is one sentence saying what the component is and what a person does with it; body is one to three short paragraphs on where it is used and what it gives people, with no option names)',
  whenToUse:
    'whenToUse (string[], 2 to 4 concrete situations where this component is the right choice)',
  whenNotToUse:
    'whenNotToUse (string[], 2 to 3 situations to avoid it, each saying what to do instead; name another component only if it is listed under Related above)',
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
  keyboard:
    'keyboard ({ keys: string[], action }[] with each key one of Tab, Shift+Tab, Enter, Space, Escape, Arrow Up, Arrow Down, Arrow Left, Arrow Right, Home, End, Page Up, Page Down, Delete, Backspace, and action one sentence; include only bindings this component really has, and leave the key out for a non-interactive component)',
  pointer:
    'pointer (string[], 2 to 3 sentences on mouse and touch behaviour, including target size)',
  semantics:
    'semantics (string[], 3 to 4 sentences on roles, accessible names, and announcements, plus one on what the design file cannot encode)',
  content:
    'content (string[], 3 to 4 sentences on writing the text parts listed under Anatomy, on truncation, and on translation)',
  guidelines:
    'guidelines ({ do: { rule, reason }, dont: { rule, reason } }[], 3 pairs; each rule one sentence, each reason one sentence)',
};

/** Default value of a variant axis, from its component property. */
function axisDefault(spec: IntermediateSpec, axis: string): string | undefined {
  const prop = spec.props.find((p) => p.name === axis && p.kind === 'variant');
  return typeof prop?.default === 'string' ? prop.default : undefined;
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
    lines.push(`  ${description.replace(/\s*\n\s*/g, ' ')}`);
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

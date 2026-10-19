/**
 * The prompt for one-sentence descriptions of things a designer left blank:
 * variables, styles, components and slot properties. The model sees only the
 * facts the brief carries, so those are all it may describe. A gap stays a
 * gap sooner than it takes an invented purpose.
 */
import { collapseDashes } from './foundationPrompt';

export type DescriptionGapKind = 'variable' | 'style' | 'component' | 'slot';

export interface DescriptionBrief {
  /** Stable key, echoed back as-is for matching; never shown to people. */
  key: string;
  kind: DescriptionGapKind;
  /** Token path, style name, component name, or "Component / property". */
  name: string;
  /** variable: COLOR, FLOAT, STRING, BOOLEAN, EASING, TIMING; style: typography or effect; component; slot. */
  type: string;
  /** "Light = #FFFFFF"; a style's summary; a slot's preferred components. */
  values?: string[];
  scopes?: string[];
  /** The target path when every mode aliases one token. */
  aliasOf?: string;
  /** Component: "Properties: Size, State", "Variants: 6". */
  facts?: string[];
}

export interface DescriptionDraftInput { items: DescriptionBrief[] }

export const DESCRIPTION_SYSTEM_PROMPT = [
  'You write one-sentence descriptions for design-system entries a designer left blank:',
  'variables (design tokens), text and effect styles, components, and slot properties.',
  'Each description goes into that entry\'s description field in Figma, where designers,',
  'developers and AI agents read it.',
  '',
  'You are given each entry\'s name, kind, type, and the values or facts recorded for it.',
  'That is ALL you know. Say what the entry is for and when to reach for it, as its name',
  'and values actually show.',
  '',
  'Never invent: no component names the facts do not mention, no accessibility claims, no',
  'rules the name does not support, no numbers the values do not state. If the name is too',
  'generic to support a purpose, describe what the values show plainly and stop. If nothing',
  'true can be said, leave it out of the JSON.',
  '',
  'Voice:',
  '- One sentence. Under 200 characters. No heading, no list, no markdown.',
  '- Plain and factual, the tone of a peer explaining their own file.',
  '- Lead with the purpose, not "This token" or "This component".',
  '- Write for people, not "the user".',
  '- Never use em dashes or en dashes. Use a period, comma, colon, or parentheses.',
  '- Do not restate the name as a sentence ("Surface primary is the primary surface").',
  '',
  'Return ONLY a JSON object: each key mapped to its description.',
  'No prose outside the JSON, no code fence.',
].join('\n');

/** Items per request, so a Foundation with hundreds of blanks costs a handful
 *  of generations, never one each. */
export const DESCRIPTION_CHUNK = 60;

/** The proxy checks equality, not a ceiling, so a change here needs a proxy
 *  deploy. 60 answers at about 60 tokens each sit well inside this. */
export const DESCRIPTION_MAX_TOKENS = 4000;

/** Longer answers are dropped, not trimmed. */
export const MAX_DESCRIPTION_CHARS = 220;

export function chunkDescriptionItems(items: readonly DescriptionBrief[]): DescriptionBrief[][] {
  const out: DescriptionBrief[][] = [];
  for (let i = 0; i < items.length; i += DESCRIPTION_CHUNK) out.push(items.slice(i, i + DESCRIPTION_CHUNK));
  return out;
}

/**
 * One block per item. Opens with `Items to describe:` and ends with the
 * `Return JSON:` line; the proxy checks both, so neither may move.
 */
export function buildDescriptionPrompt(input: DescriptionDraftInput): string {
  const lines: string[] = ['Items to describe:'];
  for (const item of input.items) {
    lines.push(`  key: ${item.key}`);
    lines.push(`  kind: ${item.kind}`);
    lines.push(`  name: ${item.name}`);
    lines.push(`  type: ${item.type}`);
    if (item.values && item.values.length) lines.push(`  values: ${item.values.join('; ')}`);
    if (item.scopes && item.scopes.length) lines.push(`  scopes: ${item.scopes.join(', ')}`);
    if (item.aliasOf) lines.push(`  alias of: ${item.aliasOf}`);
    for (const fact of item.facts ?? []) lines.push(`  ${fact}`);
    lines.push('');
  }
  return `${lines.join('\n')}\nReturn JSON: { "<key>": "<one sentence>", ... } with one entry per key above, and no entry for a key you cannot describe truthfully.`;
}

const normalise = (s: string): string => collapseDashes(s.trim());

/**
 * Parse the model's JSON. Model output is untrusted: only requested keys
 * survive, and an unusable entry is dropped, never defaulted, so bad output
 * costs the draft, never the field.
 */
export function parseDescriptionDraft(text: string, keys: readonly string[]): Record<string, string> {
  const wanted = new Set(keys);
  const out: Record<string, string> = {};
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!wanted.has(key) || typeof value !== 'string') continue;
    const trimmed = normalise(value);
    if (!trimmed || trimmed.length > MAX_DESCRIPTION_CHARS) continue;
    out[key] = trimmed;
  }
  return out;
}

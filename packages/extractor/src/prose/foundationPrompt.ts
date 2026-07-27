/**
 * foundationPrompt.ts — the prompt for one-paragraph descriptions of a token
 * group ("Surface", "Blue"), shown under the group's heading in a foundation
 * frame.
 *
 * Separate from prompt.ts because the input and the output contract are
 * different: that one describes a component from its extracted structure, this
 * one describes a set of tokens from their names and resolved values. They share
 * the transport and the house voice, nothing else.
 *
 * The model sees names and values, so those are the only things it may describe.
 * Everything about this prompt is aimed at that: a design system's docs are worth
 * less than nothing if they confidently state a usage rule nobody chose.
 */
import type { FoundationVariableType } from '../foundation';

/** What the model is told about one group. */
export interface FoundationGroupBrief {
  /** Stable key, the folder path. Returned as-is so callers can match it back. */
  folder: string;
  /** The heading the frame shows, e.g. "Surface". */
  title: string;
  /** Token names in the group, already capped by the caller. */
  tokenNames: string[];
  /** One representative resolved value per token, in the same order. */
  sampleValues: string[];
  /** What kind of variable the group holds, so a colour is not described as a size. */
  resolvedType: FoundationVariableType;
}

export const FOUNDATION_SYSTEM_PROMPT = [
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

/** Cap on how many tokens of a group are shown, to bound prompt size. */
export const GROUP_SAMPLE_LIMIT = 12;
/** Cap on an accepted description, past which it is dropped rather than trimmed. */
const MAX_DESCRIPTION = 400;

export function buildGroupPrompt(
  collectionName: string, groups: FoundationGroupBrief[],
): string {
  const lines: string[] = [
    `Collection: ${collectionName}`,
    '',
    'Groups to describe:',
  ];
  for (const group of groups) {
    lines.push('');
    lines.push(`key: ${group.folder}`);
    lines.push(`heading: ${group.title}`);
    lines.push(`type: ${group.resolvedType}`);
    const shown = group.tokenNames.slice(0, GROUP_SAMPLE_LIMIT);
    for (const [i, name] of shown.entries()) {
      const value = group.sampleValues[i];
      lines.push(value ? `  ${name} = ${value}` : `  ${name}`);
    }
    if (group.tokenNames.length > shown.length) {
      lines.push(`  (and ${group.tokenNames.length - shown.length} more)`);
    }
  }
  lines.push('');
  lines.push('Return JSON: { "<key>": "<description>", ... } with one entry per key above.');
  return lines.join('\n');
}

/**
 * Parse the model's JSON into folder → description.
 *
 * Keeps only the folders that were asked for. The model's output is untrusted
 * input: an unexpected key would otherwise be rendered into the user's document,
 * and a key it invented has no block to sit under anyway. Entries that are not
 * usable strings are dropped rather than defaulted, so a bad response costs the
 * descriptions and not the frame.
 */
export function parseGroupResponse(
  text: string, folders: string[],
): Record<string, string> {
  const wanted = new Set(folders);
  const out: Record<string, string> = {};

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out; // unusable response → no descriptions, frame still renders
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!wanted.has(key)) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_DESCRIPTION) continue;
    // The voice rule is enforced here as well as asked for in the prompt: a
    // model slip should not put an em dash into the user's document.
    out[key] = trimmed.replace(/\s*[—–]\s*/g, ', ');
  }
  return out;
}

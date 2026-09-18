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
import type { AliasCount } from '../foundationOverview';

/** What the model is told about the collection as a whole. */
export interface FoundationCollectionBrief {
  collectionName: string;
  modeNames: string[];
  aliasCounts: AliasCount[];
}

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
  'The "overview" entry describes the whole collection in one paragraph: what it holds, how its modes',
  'differ, and which collections it draws from, exactly as the names, modes and alias counts show.',
  'Under 400 characters, no markdown, no invented usage. Leave it out if the names support nothing.',
  '',
  'Return ONLY a JSON object mapping each group key to its description string.',
  'No prose outside the JSON, no code fence.',
].join('\n');

/** Cap on how many tokens of a group are shown, to bound prompt size. */
export const GROUP_SAMPLE_LIMIT = 12;
/** Cap on an accepted description, past which it is dropped rather than trimmed. */
const MAX_DESCRIPTION = 400;
/** Cap on an accepted overview, past which it is dropped rather than trimmed. */
export const MAX_OVERVIEW = 400;

export function buildGroupPrompt(
  collection: FoundationCollectionBrief, groups: FoundationGroupBrief[],
): string {
  const lines: string[] = [`Collection: ${collection.collectionName}`];
  if (collection.modeNames.length) lines.push(`Modes: ${collection.modeNames.join(', ')}`);
  if (collection.aliasCounts.length) {
    lines.push(`Aliases into other collections: ${collection.aliasCounts.map((a) => `${a.collection} (${a.count})`).join(', ')}`);
  }
  lines.push('', 'Groups to describe:');
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
  lines.push('Return JSON: { "overview": "<one paragraph about the whole collection>", "<key>": "<description>", ... } with one entry per key above.');
  return lines.join('\n');
}

export interface GroupDraft { descriptions: Record<string, string>; overview: string | null }

// The existing dash regex stays as it was in this file; it runs over one short
// string per key, and MAX_DESCRIPTION/MAX_OVERVIEW bound it. Do not replace it
// with replaceAround in this task.
const normalise = (s: string): string => s.trim().replace(/\s*[—–]\s*/g, ', ');

/**
 * Parse the model's JSON into the group descriptions and the collection
 * overview. `overview` is reserved: it is never a folder key, and it is kept
 * only as a non-empty string under `MAX_OVERVIEW` characters.
 *
 * Only the folders that were asked for survive. The model's output is
 * untrusted input: an unexpected key would otherwise be rendered into the
 * user's document, and a key it invented has no block to sit under anyway.
 * Entries that are not usable strings are dropped rather than defaulted, so
 * unusable output costs the prose, never the frame.
 */
export function parseGroupDraft(text: string, folders: string[]): GroupDraft {
  const wanted = new Set(folders.filter((f) => f !== 'overview'));
  const out: GroupDraft = { descriptions: {}, overview: null };

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
    if (typeof value !== 'string') continue;
    const trimmed = normalise(value);
    if (key === 'overview') {
      if (trimmed && trimmed.length <= MAX_OVERVIEW) out.overview = trimmed;
      continue;
    }
    if (!wanted.has(key)) continue;
    if (!trimmed || trimmed.length > MAX_DESCRIPTION) continue;
    // The voice rule is enforced here as well as asked for in the prompt: a
    // model slip should not put an em dash into the user's document.
    out.descriptions[key] = trimmed;
  }
  return out;
}

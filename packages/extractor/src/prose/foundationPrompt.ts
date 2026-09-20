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

/** What the model is told about one collection: its facts and its colour groups. */
export interface FoundationCollectionBrief {
  collectionId: string;
  collectionName: string;
  modeNames: string[];
  aliasCounts: AliasCount[];
  groups: FoundationGroupBrief[];
}

/** The JSON key an overview is returned under. Never a folder key: folders carry a `|` after the id too, but never end in `overview`. */
export function overviewKey(collectionId: string): string {
  return `${collectionId}|overview`;
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
  'Each "<collection key>|overview" entry describes that collection in one paragraph: what it holds,',
  'how its modes differ, and which collections it draws from, exactly as the names, modes and alias',
  'counts show. Under 400 characters, no markdown, no invented usage. Leave it out if the names',
  'support nothing.',
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

/**
 * One block per collection, so a build over several collections is still one
 * call and each collection's overview is written against its own facts rather
 * than a merged list nobody could attribute.
 *
 * A collection with no colour groups still gets a block: its names, modes and
 * alias counts are all an overview needs, and leaving it out would be the only
 * reason a spacing-only document has no paragraph.
 */
export function buildGroupPrompt(input: { collections: FoundationCollectionBrief[] }): string {
  const blocks = input.collections.map((collection) => {
    const lines: string[] = [`Collection: ${collection.collectionName} (key: ${collection.collectionId})`];
    if (collection.modeNames.length) lines.push(`Modes: ${collection.modeNames.join(', ')}`);
    if (collection.aliasCounts.length) {
      lines.push(`Aliases into other collections: ${collection.aliasCounts.map((a) => `${a.collection} (${a.count})`).join(', ')}`);
    }
    if (collection.groups.length === 0) {
      lines.push('Groups to describe: none');
      return lines.join('\n');
    }
    lines.push('Groups to describe:');
    for (const group of collection.groups) {
      lines.push(`  key: ${group.folder}`);
      lines.push(`  heading: ${group.title}`);
      lines.push(`  type: ${group.resolvedType}`);
      const shown = group.tokenNames.slice(0, GROUP_SAMPLE_LIMIT);
      for (const [i, name] of shown.entries()) {
        const value = group.sampleValues[i];
        lines.push(value ? `    ${name} = ${value}` : `    ${name}`);
      }
      if (group.tokenNames.length > shown.length) {
        lines.push(`    (and ${group.tokenNames.length - shown.length} more)`);
      }
    }
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n\nReturn JSON: { "<collection key>|overview": "<one paragraph about that collection>", "<group key>": "<description>", ... } with one overview per collection key and one entry per group key above.`;
}

export interface GroupDraft { descriptions: Record<string, string>; overviews: Record<string, string> }

/** One character's worth of `\s`. A per-character test cannot backtrack. */
const WHITESPACE = /\s/;

/**
 * Replace every em or en dash, together with any whitespace hugging it, with
 * `, `. This is exactly what a global replace of `\s*[—–]\s*` with `, ` did: the
 * greedy `\s*` on each side always took the whole whitespace run, and a match
 * never reached back past the end of the previous one. That regex is quadratic
 * on a run of whitespace that never reaches a dash, because every position in
 * the run retries the whole run, and it runs over model output, whose length
 * nobody in this repository controls. `MAX_DESCRIPTION` and `MAX_OVERVIEW`
 * bound what is kept, not what is scanned. One pass, pinned against the regex
 * in `redos.test.ts`. Different from `normalizeDashes` in `v2.ts` on purpose:
 * that rule keeps line breaks and demands spaces around an en dash; this one
 * never did.
 */
export function collapseDashes(value: string): string {
  let out = '';
  let from = 0;
  let cursor = 0;
  for (;;) {
    const em = value.indexOf('—', cursor);
    const en = value.indexOf('–', cursor);
    const at = em === -1 ? en : en === -1 ? em : Math.min(em, en);
    if (at === -1) break;
    let left = at;
    while (left > from && WHITESPACE.test(value[left - 1])) left--;
    let right = at + 1;
    while (right < value.length && WHITESPACE.test(value[right])) right++;
    out += value.slice(from, left) + ', ';
    from = right;
    cursor = right;
  }
  return out + value.slice(from);
}

const normalise = (s: string): string => collapseDashes(s.trim());

/**
 * Parse the model's JSON into the group descriptions and the per-collection
 * overviews. An overview is keyed by its collection id (`<id>|overview`) and is
 * kept only for a collection that was actually asked about, as a non-empty
 * string under `MAX_OVERVIEW` characters. A bare `overview` key is not special
 * any more: it belongs to no collection, so it is ignored like any other key
 * that was never requested.
 *
 * Only the folders that were asked for survive. The model's output is
 * untrusted input: an unexpected key would otherwise be rendered into the
 * user's document, and a key it invented has no block to sit under anyway.
 * Entries that are not usable strings are dropped rather than defaulted, so
 * unusable output costs the prose, never the frame.
 */
export function parseGroupDraft(text: string, folders: string[], collectionIds: string[]): GroupDraft {
  const wantedFolders = new Set(folders);
  const wantedOverviews = new Map(collectionIds.map((id) => [overviewKey(id), id]));
  const out: GroupDraft = { descriptions: {}, overviews: {} };

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
    const collectionId = wantedOverviews.get(key);
    if (collectionId !== undefined) {
      if (trimmed && trimmed.length <= MAX_OVERVIEW) out.overviews[collectionId] = trimmed;
      continue;
    }
    if (!wantedFolders.has(key)) continue;
    if (!trimmed || trimmed.length > MAX_DESCRIPTION) continue;
    // The voice rule is enforced here as well as asked for in the prompt: a
    // model slip should not put an em dash into the user's document.
    out.descriptions[key] = trimmed;
  }
  return out;
}

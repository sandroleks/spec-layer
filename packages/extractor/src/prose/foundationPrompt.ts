/**
 * The prompt for short descriptions of a token group ("Surface", "Blue") and a
 * per-collection overview in a foundation frame. The model sees only names and
 * values, so those are the only things it may describe: an invented usage rule
 * is worse than no docs.
 */
import type { FoundationVariableType } from '../foundation';
import type { AliasCount } from '../foundationOverview';

export interface FoundationCollectionBrief {
  collectionId: string;
  collectionName: string;
  modeNames: string[];
  aliasCounts: AliasCount[];
  groups: FoundationGroupBrief[];
}

/** Every collection in one build: one prompt, one generation. */
export interface GroupDraftInput { collections: FoundationCollectionBrief[] }

/**
 * The JSON key an overview is returned under. It CAN collide with a group key
 * (a folder named `overview` gives `c1|overview`); `parseGroupDraft` resolves
 * that in the group's favour, losing the overview rather than a description.
 */
export function overviewKey(collectionId: string): string {
  return `${collectionId}|overview`;
}

export interface FoundationGroupBrief {
  /** Stable key, the folder path, returned as-is for matching back. */
  folder: string;
  /** The heading the frame shows, e.g. "Surface". */
  title: string;
  tokenNames: string[];
  /** One representative resolved value per token, in the same order. */
  sampleValues: string[];
  /** So a colour is not described as a size. */
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
  'Return ONLY a JSON object: each group key mapped to its description, and each',
  'collection overview key mapped to its overview.',
  'No prose outside the JSON, no code fence.',
].join('\n');

/** Tokens shown per group, to bound prompt size. */
export const GROUP_SAMPLE_LIMIT = 12;
/** Longer answers are dropped, not trimmed. */
const MAX_DESCRIPTION = 400;
export const MAX_OVERVIEW = 400;

/**
 * One block per collection, so each overview is written against its own facts.
 * A collection with no colour groups still gets a block for its overview.
 */
export function buildGroupPrompt(input: GroupDraftInput): string {
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

/** A per-character test cannot backtrack. */
const WHITESPACE = /\s/;

/**
 * Replace every em or en dash and the whitespace hugging it with `, `, enforcing
 * the voice rule on model output. One linear pass equal to the quadratic global
 * regex it replaces, pinned in `redos.test.ts`; model output is unbounded.
 * Unlike `normalizeDashes` in `v2.ts`, it does not keep line breaks.
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
 * Parse the model's JSON. Model output is untrusted: only requested folders and
 * overviews (`<id>|overview`) survive, and unusable entries are dropped, never
 * defaulted, so bad output costs the prose, never the frame. A requested folder
 * is tested FIRST (see `overviewKey`).
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
    if (!wantedFolders.has(key)) {
      const collectionId = wantedOverviews.get(key);
      if (collectionId === undefined) continue;
      if (trimmed && trimmed.length <= MAX_OVERVIEW) out.overviews[collectionId] = trimmed;
      continue;
    }
    if (!trimmed || trimmed.length > MAX_DESCRIPTION) continue;
    out.descriptions[key] = trimmed;
  }
  return out;
}

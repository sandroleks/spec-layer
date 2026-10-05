/**
 * The component description Annotate in Dev Mode writes: the doc's Usage text, as
 * Markdown, with one provenance line. A projection of the prose the canvas
 * shows. It never invents a section, never fills an empty one, and never
 * feeds a hash.
 */
import type { ProseV2, ProseV2Key } from '@spec-layer/extractor';
import type { SyncOrigin } from './syncRecord';

/** The prose keys a description carries, in the order it shows them. */
export const DESCRIPTION_KEYS: readonly ProseV2Key[] = ['overview', 'whenToUse', 'whenNotToUse'];

export interface DescriptionText {
  /** The doc text alone, compared across syncs. */
  body: string;
  /** `body` plus the provenance line, the value written to Figma. */
  markdown: string;
  origin: SyncOrigin;
}

const clean = (lines: readonly string[] | undefined): string[] =>
  (lines ?? []).map((l) => l.trim()).filter((l) => l !== '');

/** `syncedOn` is a calendar date, `YYYY-MM-DD`. `shown` holds the prose keys
 *  the doc's sections render: text the canvas leaves out is left out here too.
 *  Null when no shown Usage section has text, so the caller writes nothing
 *  rather than an empty description. */
export function descriptionText(
  prose: ProseV2 | null, syncedOn: string, shown?: ReadonlySet<ProseV2Key>,
): DescriptionText | null {
  if (!prose) return null;
  const carried = (key: ProseV2Key): boolean => !shown || shown.has(key);
  const blocks: string[] = [];
  const present: ProseV2Key[] = [];

  const lede = carried('overview') ? prose.overview?.lede.trim() ?? '' : '';
  const body = carried('overview') ? clean(prose.overview?.body) : [];
  if (lede || body.length) {
    present.push('overview');
    blocks.push(...[lede, ...body].filter((t) => t !== ''));
  }
  const list = (key: 'whenToUse' | 'whenNotToUse', heading: string): void => {
    const items = carried(key) ? clean(prose[key]) : [];
    if (!items.length) return;
    present.push(key);
    blocks.push(`**${heading}**\n${items.map((i) => `- ${i}`).join('\n')}`);
  };
  list('whenToUse', 'When to use');
  list('whenNotToUse', 'When not to use');
  if (!present.length) return null;

  const authored = new Set(prose.authored ?? []);
  const typed = present.filter((k) => authored.has(k)).length;
  const origin: SyncOrigin = typed === present.length ? 'authored' : typed === 0 ? 'ai' : 'mixed';
  const text = blocks.join('\n\n');
  return { body: text, markdown: `${text}\n\n${provenanceLine(origin, syncedOn)}`, origin };
}

/** For a human reading Dev Mode. Ownership never depends on it. */
export function provenanceLine(origin: SyncOrigin, syncedOn: string): string {
  return origin === 'authored'
    ? `Written in Spec Layer · ${syncedOn}`
    : `Written with AI in Spec Layer · ${syncedOn}`;
}

/** A provenanceLine on the last line of a text, alone on its line. */
const TRAILING_PROVENANCE = /(?:^|\n)[^\S\n]*Written (?:with AI )?in Spec Layer · \d{4}-\d{2}-\d{2}\s*$/;

/**
 * A description without the provenance line the sync appends. Once a person
 * edits a synced description it reads as theirs, but the line is still Spec
 * Layer's stamp, not their words, so it never becomes source.
 */
export function withoutProvenance(text: string): string {
  return text.replace(TRAILING_PROVENANCE, '').trimEnd();
}

/** Up to three names, then a count, so a long file never floods a sentence. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 3) {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** A local calendar date for the provenance line. */
export function calendarDate(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/**
 * The doc Section's link from the file link a designer pasted. Null when the
 * pasted value is not a figma.com design or file URL with a file key: a
 * guessed link would point somewhere else.
 */
export function fileKeyFromUrl(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([A-Za-z0-9]{10,128})(?:[/?#]|$)/.exec(url.trim());
  return m ? m[1] : null;
}

export function sectionLink(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, '-')}`;
}

const SECTION_LINK = /^https:\/\/www\.figma\.com\/design\/([A-Za-z0-9]{10,128})\/\?node-id=([0-9-]+)$/;

/** The same link pointed at the Section that replaced `oldDocId`, or null when
 *  `uri` is not a sectionLink to `oldDocId`. An Update rebuilds the doc as a
 *  new Section, so a link to the old one would open nothing. */
export function relinkedSection(uri: string, oldDocId: string, newDocId: string): string | null {
  const m = SECTION_LINK.exec(uri);
  return m && m[2] === oldDocId.replace(/:/g, '-') ? sectionLink(m[1], newDocId) : null;
}

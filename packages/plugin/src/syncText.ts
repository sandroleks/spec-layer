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

/** `syncedOn` is a calendar date, `YYYY-MM-DD`. Null when no Usage section
 *  has text, so the caller writes nothing rather than an empty description. */
export function descriptionText(prose: ProseV2 | null, syncedOn: string): DescriptionText | null {
  if (!prose) return null;
  const blocks: string[] = [];
  const present: ProseV2Key[] = [];

  const lede = prose.overview?.lede.trim() ?? '';
  const body = clean(prose.overview?.body);
  if (lede || body.length) {
    present.push('overview');
    blocks.push(...[lede, ...body].filter((t) => t !== ''));
  }
  const list = (key: 'whenToUse' | 'whenNotToUse', heading: string): void => {
    const items = clean(prose[key]);
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

/** For a human reading Dev Mode. Detection never depends on it. */
export function provenanceLine(origin: SyncOrigin, syncedOn: string): string {
  return origin === 'authored'
    ? `Written in Spec Layer · ${syncedOn}`
    : `Written with AI in Spec Layer · ${syncedOn}`;
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

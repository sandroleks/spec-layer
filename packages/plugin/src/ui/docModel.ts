import { categorize } from '@spec-layer/extractor';
import type { IntermediateSpec, ProseV2Key, ProseV2, GuidelinePair, VariantInstance, StateColumn } from '@spec-layer/extractor';
import {
  cleanPartName, formatConditions, resolveTokensForVariant,
  detectStateMatrix, stateAxisProps, anatomyFor, tokensFor, firstSentence, foldName,
} from '@spec-layer/extractor';
import { displayComponentName } from './displayNames';
import { placeholderShapeFor, type PlaceholderShape } from './placeholders';

export { firstSentence };

export type SectionId =
  | 'definition' | 'whenToUse' | 'variants' | 'dosDonts' | 'related'
  | 'anatomy' | 'properties' | 'states' | 'measurements' | 'tokens'
  | 'keyboard' | 'pointer' | 'accessibility' | 'contentConsiderations';

export type GroupId = 'usage' | 'specs' | 'a11y';

/** The section map, in frame order: Usage, then Specifications, then
 *  Accessibility. `label` is the heading drawn on canvas and the name the
 *  plugin uses when it reports an omission. */
export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean; group: GroupId }[] = [
  { id: 'definition',            label: 'Overview',             ai: true,  group: 'usage' },
  { id: 'whenToUse',             label: 'When to use',          ai: true,  group: 'usage' },
  { id: 'variants',              label: 'Variants',             ai: true,  group: 'usage' },
  { id: 'dosDonts',              label: 'Do and don’t',         ai: true,  group: 'usage' },
  { id: 'related',               label: 'Related components',   ai: false, group: 'usage' },
  { id: 'anatomy',               label: 'Anatomy',              ai: true,  group: 'specs' },
  { id: 'properties',            label: 'Properties',           ai: true,  group: 'specs' },
  { id: 'states',                label: 'States',               ai: false, group: 'specs' },
  { id: 'measurements',          label: 'Measurements',         ai: false, group: 'specs' },
  { id: 'tokens',                label: 'Tokens',               ai: false, group: 'specs' },
  { id: 'keyboard',              label: 'Keyboard',             ai: true,  group: 'a11y'  },
  { id: 'pointer',               label: 'Pointer and touch',    ai: true,  group: 'a11y'  },
  { id: 'accessibility',         label: 'Semantics and focus',  ai: true,  group: 'a11y'  },
  { id: 'contentConsiderations', label: 'Content',              ai: true,  group: 'a11y'  },
];

/** Every section id the current build knows how to render. A stored config can
 *  name a section that has since been removed (Contrast was one), and rendering
 *  an unknown id would fall through the section switch and silently produce
 *  nothing, so parsing filters against this set instead of trusting the list. */
export const KNOWN_SECTION_IDS: ReadonlySet<string> = new Set(ALL_SECTIONS.map((s) => s.id));

/** Section ids a stored DocConfig may still carry from an earlier build, and
 *  the ids that render their content now. `configuration` became the
 *  Properties table; `interactions` split into Pointer and touch plus the
 *  Keyboard table. Read at parse time so an old doc rebuilds into the new
 *  map instead of silently losing sections. */
export const LEGACY_SECTION_IDS: Readonly<Record<string, SectionId[]>> = {
  configuration: ['properties'],
  interactions: ['pointer', 'keyboard'],
};

/** The three output groups, in canonical display/build order. */
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'specs', label: 'Specifications' },
  { id: 'a11y',  label: 'Accessibility' },
];

/**
 * Which v2 prose keys each section needs. A section whose key is absent from
 * the draft is drawn as a placeholder when the section has one (see
 * placeholders.ts), and omitted otherwise. Overview and Variants also render
 * without prose, so requesting their keys only adds the AI text.
 */
const PROSE_KEYS_BY_SECTION: Partial<Record<SectionId, ProseV2Key[]>> = {
  definition: ['overview'],
  whenToUse: ['whenToUse', 'whenNotToUse'],
  variants: ['variantsIntro', 'variantsGuide'],
  anatomy: ['anatomySummary', 'anatomyParts'],
  properties: ['properties'],
  keyboard: ['keyboard'],
  pointer: ['pointer'],
  accessibility: ['semantics'],
  contentConsiderations: ['content'],
  dosDonts: ['guidelines'],
};

/** Union of the prose keys the given (checked) sections need. */
export function proseKeysForSections(ids: Iterable<SectionId>): Set<ProseV2Key> {
  const out = new Set<ProseV2Key>();
  for (const id of ids) for (const k of PROSE_KEYS_BY_SECTION[id] ?? []) out.add(k);
  return out;
}

/** An inline run of text; `bold` marks **lead-ins**, `code` marks `spans`. */
export interface TextRun { text: string; bold?: boolean; code?: boolean }
export interface Bullet { runs: TextRun[]; text: string } // text = plain fallback

/** One row in a variant's token table: a resolved token binding, or a raw
 *  hardcoded value (`unbound: true`, `token` holds the raw value string) —
 *  raw rows only ever appear on the default variant's card. `diff` marks a
 *  row whose token differs from the default variant's token for the same
 *  part+property slot (non-default cards only; always false on the default). */
export interface VariantRow {
  part: string;
  property: string;
  token: string;
  unbound: boolean;
  diff: boolean;
}

/** One documented variant: a label, the axis=value prop pairs (for the
 *  PROPERTIES list), the source node (for a live instance), whether this is
 *  the default variant, its rows (all rows for the default; only rows that
 *  differ from the default for non-default variants), and the count of rows
 *  suppressed because they matched the default (non-default cards only). */
export interface VariantTokenBlock {
  name: string;
  props: { name: string; value: string }[];
  nodeId: string;
  isDefault: boolean;
  rows: VariantRow[];
  sameAsDefault: number;
}

/** One anatomy part placed on the diagram: its callout number, label, whether
 *  it is a nested component, and the Figma node id used to resolve its position
 *  (and screenshot) live in the frame builder. `depth` is the nesting level
 *  (0 = direct part); `component` names the main component when nested;
 *  `tokens` lists the unique token names bound to this part; `type` is the raw
 *  Figma node type (e.g. "FRAME"), shown lowercased in the table view. */
export interface AnatomyPartBlock {
  /** The callout number, hierarchical: "1", "2", "2.1", "2.2", "3". A flat
   *  1-based index across every depth spent numbers on nested rows, which get
   *  no pin, so the pins themselves read with holes in them (1, 2, 4). Depth-0
   *  labels are therefore plain integers counting from 1 with no gaps, which
   *  is exactly the set the diagram draws. */
  label: string;
  name: string;
  nested: boolean;
  id: string;
  depth: number;
  component?: string;
  tokens: string[];
  type: string;
  /** AI role sentence, matched by raw part name. */
  role?: string;
  /** Present only on a part hidden by default: the boolean property that shows
   *  it. The legend reads "Shown when <shownBy> is true". */
  shownBy?: string;
}

/** Which measurement lens a measure mini-diagram renders. Each selected view
 *  becomes its own focused diagram in the frame (size / padding / spacing). */
export type MeasureView = 'size' | 'padding' | 'spacing';

/** Options threaded through `buildDocModel` that affect how sections render
 *  without changing the underlying spec — the anatomy view mode and which
 *  measurement lenses to render. */
export interface DocModelOptions {
  anatomyView?: 'diagram';
  measureViews?: MeasureView[];
  /** Draw the parts a boolean property hides by default (DocConfig.includeHidden). */
  includeHidden?: boolean;
}

/** A selected section the result line reports. `nothingToShow`: the spec
 *  had nothing for it, so it was left out. `placeholder`: it is a writing
 *  section with no prose, so it was drawn as a marked placeholder. */
export interface OmittedSection { id: SectionId; label: string; reason: 'nothingToShow' | 'placeholder' }
export interface PropertyRow { name: string; type: string; values: string; defaultValue: string; description: string | null }
export interface KeyboardRow { keys: string[]; action: string }
export interface ColumnBlock { heading: string; items: Bullet[]; slot: 'whenToUse' | 'whenNotToUse' }

/** The words the Usage header carries, and whose they are. The designer's own
 *  Figma description leads whenever the component has one; the AI lede takes
 *  the header only when there is no description to take it. The source decides
 *  whether the rendered subtitle is editorial (an Update keeps it) or
 *  generated (an Update re-reads it from the component). */
export interface HeaderSubtitle { text: string; source: 'ai' | 'description' }

export type SectionBlock =
  | {
      id: SectionId; heading: string; kind: 'prose'; text: string; source: 'ai' | 'description';
      /** The first sentence, lifted out of `text` into the Usage header. */
      subtitle: HeaderSubtitle | null;
      /** The AI's opening line when the description took the header instead:
       *  it opens the Overview body as its own editorial paragraph, so both
       *  sets of words appear, once each. Null everywhere else. */
      lede: string | null;
    }
  | { id: SectionId; heading: string; kind: 'bullets'; items: Bullet[]; slot: 'pointer' | 'semantics' | 'content' | null }
  | { id: SectionId; heading: string; kind: 'twoColumns'; left: ColumnBlock; right: ColumnBlock }
  | { id: SectionId; heading: string; kind: 'guidelinePairs'; pairs: GuidelinePair[] }
  | { id: SectionId; heading: string; kind: 'placeholder'; shape: PlaceholderShape }
  | { id: SectionId; heading: string; kind: 'propertiesTable'; rows: PropertyRow[]; hasDescriptions: boolean }
  | { id: SectionId; heading: string; kind: 'keyboardTable'; rows: KeyboardRow[] }
  | { id: SectionId; heading: string; kind: 'table'; columns: string[]; rows: string[][] }
  | { id: SectionId; heading: string; kind: 'variantTokens'; columns: string[]; variants: VariantTokenBlock[] }
  | { id: SectionId; heading: string; kind: 'anatomy'; componentId: string; parts: AnatomyPartBlock[]; view: 'diagram'; summary: string | null }
  | { id: SectionId; heading: string; kind: 'measure'; componentId: string; rootPart: string; tokens: Record<string, string>; views: MeasureView[]; tableRows: string[][] }
  | { id: SectionId; heading: string; kind: 'statesMatrix'; axisName: string; states: string[]; rows: { label: string; cells: (string | null)[] }[]; capped: boolean }
  | { id: SectionId; heading: string; kind: 'variantsMatrix'; intro: string | null; guide: { name: string; guidance: string }[]; columns: string[]; rows: { label: string; cells: (string | null)[] }[]; capped: boolean; note: string | null };

export interface DocFrameModel {
  componentName: string;
  /** The component name as a reader sees it; `componentName` stays raw. */
  displayName: string;
  sections: SectionBlock[];
  /** Selected sections that produced nothing, in section-map order. */
  omitted: OmittedSection[];
  /** Present and true only when the doc reveals hidden-by-default parts; the
   *  frame builder then sets every boolean property on each placed instance. */
  includeHidden?: true;
}

export interface DocGroup { id: GroupId; label: string; sections: SectionBlock[] }

/** Partition doc sections into their groups. Groups are emitted in GROUPS order;
 *  within a group, the input section order is preserved. Empty groups are omitted
 *  (this is what drives empty-frame skipping in the frame builder). */
export function groupSections(sections: SectionBlock[]): DocGroup[] {
  const groupOf = new Map<SectionId, GroupId>(ALL_SECTIONS.map((s) => [s.id, s.group]));
  return GROUPS
    .map(({ id, label }) => ({
      id, label,
      sections: sections.filter((s) => groupOf.get(s.id) === id),
    }))
    .filter((g) => g.sections.length > 0);
}

/** Human label for a variant instance as axis=value pairs, e.g.
 *  "Type=Primary, State=Hover" — keeps each value tied to its prop so booleans
 *  ("Danger=false") read clearly. Falls back to the raw Figma name. */
export function variantLabel(inst: VariantInstance): string {
  const pairs = Object.entries(inst.values).map(([axis, value]) => `${axis}=${value}`);
  return pairs.length ? pairs.join(', ') : inst.name;
}

/** The default variant: the instance whose axis values match every variant
 *  prop's default. Falls back to the first instance. Null when there are none. */
export function defaultVariantId(spec: IntermediateSpec): string | null {
  if (!spec.variantInstances.length) return null;
  const defaults: Record<string, string> = {};
  for (const p of spec.props) {
    if (p.kind === 'variant' && typeof p.default === 'string') defaults[p.name] = p.default;
  }
  const match = spec.variantInstances.find((inst) =>
    Object.entries(defaults).every(([axis, value]) => inst.values[axis] === value),
  );
  return (match ?? spec.variantInstances[0]).nodeId;
}

export const measureKey = (part: string, property: string): string => `${part} ${property}`;

/** Axis -> default value map for resolving the default variant's tokens. */
function defaultAxisValues(spec: IntermediateSpec): Record<string, string> {
  const defId = defaultVariantId(spec);
  const inst = spec.variantInstances.find((i) => i.nodeId === defId);
  return inst?.values ?? {};
}

/** The plain word a property kind reads as in the Properties table. An
 *  unrecognised kind falls through as typed rather than being guessed at. */
const TYPE_WORDS: Record<string, string> = {
  variant: 'Variant', boolean: 'Boolean', text: 'Text', instanceSwap: 'Instance swap',
};

/**
 * Hierarchical callout numbers for a depth-first anatomy list: "1", "2",
 * "2.1", "2.2", "3".
 *
 * Only depth-0 parts get a pin on the diagram, so a flat 1-based index across
 * every depth spends numbers on rows the diagram never draws and the pins come
 * out with holes in them. Numbering per depth keeps the pinned set contiguous
 * from 1, and gives a nested row a number that names its parent.
 *
 * Takes the depths alone, in list order, because that is all the numbering
 * depends on. A depth that jumps by more than one cannot happen in a
 * depth-first walk, and if it ever did, the deeper counters simply start at 1.
 */
export function calloutLabels(depths: readonly number[]): string[] {
  const counters: number[] = [];
  return depths.map((depth) => {
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    return counters.map((c) => c ?? 1).join('.');
  });
}

/**
 * Merge raw (unbound) rows into the resolved token rows so each raw row sits
 * inside its matching part group. Each raw row is inserted after the last
 * existing row of the same part; raw rows whose part has no token rows are
 * appended at the end in first-seen order. Stable — token-row order is
 * preserved. Prevents buildTokenTable's `part !== currentPart` grouping from
 * emitting a duplicate group-header band for a part seen earlier.
 */
function mergeRawIntoParts<T extends { part: string }>(resolved: T[], raw: T[]): T[] {
  const out = [...resolved];
  for (const r of raw) {
    // Find the index just past the last existing row with the same part.
    let insertAt = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].part === r.part) insertAt = i + 1;
    }
    if (insertAt === -1) out.push(r);
    else out.splice(insertAt, 0, r);
  }
  return out;
}

/** Extract the text of a Markdown subheading line ("### Mouse" → "Mouse"), or
 *  null for non-heading lines. The prose prompt only permits level-3 headings,
 *  but any depth is accepted so a stray "#"/"##" from the model still renders
 *  as a subheading instead of leaking raw markers onto the canvas. */
export function headingLine(line: string): string | null {
  const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
  return m ? m[1].trim() : null;
}

/**
 * Parse a Markdown string with **bold** and `code` markers into runs. Runs
 * between ** are bold, runs between backticks are code, everything else is
 * plain. The two never nest: a backtick inside a bold run is literal.
 */
export function parseRuns(md: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = md.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push({ text: part.slice(2, -2), bold: true });
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push({ text: part.slice(1, -1), code: true });
    } else {
      runs.push({ text: part });
    }
  }
  return runs;
}

/**
 * Split a markdown block into its lead paragraph (first non-empty line) and the
 * remainder. The lead becomes the Usage header subtitle; the rest renders as
 * the Overview body. Only the first SENTENCE of that line is lifted, so the
 * header stays a one-liner, and taking the line first keeps multi-line
 * markdown (headings, bullets) out of it.
 */
export function splitLead(md: string): { lead: string; rest: string } {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const firstLine = i < lines.length ? lines[i].trim() : '';
  const following = lines.slice(i + 1).join('\n').trim();
  const { sentence, remainder } = firstSentence(firstLine);
  const rest = [remainder, following].filter(Boolean).join('\n\n').trim();
  return { lead: sentence, rest };
}

/** Strip leading "- " or "* " list markers from a plain text string. */
function stripListMarker(text: string): string {
  return text.replace(/^[-*]\s+/, '');
}

/** Build a Bullet from a raw string (may have ** markers and/or a list marker). */
function makeBullet(raw: string): Bullet {
  const plain = stripListMarker(raw).replace(/\*\*/g, '').replace(/`/g, '');
  const runs = parseRuns(stripListMarker(raw));
  return { text: plain, runs };
}

const bulletsOf = (items: string[] | undefined): Bullet[] => (items ?? []).map((s) => makeBullet(s));

function buildSection(
  id: SectionId, label: string, spec: IntermediateSpec, prose: ProseV2 | null,
  selectedVariantIds?: Set<string>, options?: DocModelOptions,
): SectionBlock | null {
  const includeHidden = options?.includeHidden === true;
  switch (id) {
    case 'definition': {
      // The designer's own Figma description leads the header: it is the one
      // human-authored line the file itself carries, so it outranks anything a
      // model wrote. The AI lede takes the header only when there is no
      // description to take it, and otherwise opens the Overview body, so
      // neither set of words is dropped and neither is printed twice.
      const description = spec.description.trim();
      const fromDescription = description ? splitLead(description) : null;
      const descriptionLead: HeaderSubtitle | null =
        fromDescription?.lead ? { text: fromDescription.lead, source: 'description' } : null;

      const overview = prose?.overview;
      const aiLede = overview?.lede.trim() ?? '';
      const aiBody = (overview?.body ?? []).filter((s) => s.trim());
      if (aiLede || aiBody.length) {
        if (descriptionLead) {
          return {
            id, heading: label, kind: 'prose', text: aiBody.join('\n\n'), source: 'ai',
            subtitle: descriptionLead, lede: aiLede || null,
          };
        }
        // No description: the AI's first sentence leads, and the rest of its
        // lede paragraph drops into the body, so the header stays one line.
        const { lead, rest } = splitLead([aiLede, ...aiBody].filter(Boolean).join('\n\n'));
        return {
          id, heading: label, kind: 'prose', text: rest, source: 'ai',
          subtitle: lead ? { text: lead, source: 'ai' } : null, lede: null,
        };
      }
      // The component's own Figma description, rendered verbatim: the doc says
      // what the file says rather than inventing an opening line.
      if (fromDescription) {
        return {
          id, heading: label, kind: 'prose', text: fromDescription.rest, source: 'description',
          subtitle: descriptionLead, lede: null,
        };
      }
      return null;
    }

    case 'whenToUse': {
      const left = bulletsOf(prose?.whenToUse);
      const right = bulletsOf(prose?.whenNotToUse);
      if (!left.length && !right.length) return null;
      return {
        id, heading: label, kind: 'twoColumns',
        left: { heading: 'When to use', items: left, slot: 'whenToUse' },
        right: { heading: 'When not to use', items: right, slot: 'whenNotToUse' },
      };
    }

    case 'dosDonts': {
      const pairs = prose?.guidelines ?? [];
      return pairs.length ? { id, heading: label, kind: 'guidelinePairs', pairs } : null;
    }

    case 'keyboard': {
      const rows = prose?.keyboard ?? [];
      return rows.length ? { id, heading: label, kind: 'keyboardTable', rows } : null;
    }

    case 'pointer': {
      const items = bulletsOf(prose?.pointer);
      return items.length ? { id, heading: label, kind: 'bullets', items, slot: 'pointer' } : null;
    }

    case 'accessibility': {
      const items = bulletsOf(prose?.semantics);
      return items.length ? { id, heading: label, kind: 'bullets', items, slot: 'semantics' } : null;
    }

    case 'contentConsiderations': {
      const items = bulletsOf(prose?.content);
      return items.length ? { id, heading: label, kind: 'bullets', items, slot: 'content' } : null;
    }

    case 'related': {
      if (!spec.related.length) return null;
      return { id, heading: label, kind: 'bullets', items: spec.related.map((r) => makeBullet(r)), slot: null };
    }

    case 'properties': {
      if (!spec.props.length) return null;
      // AI descriptions are matched back to each extracted property by name
      // (case-insensitive, trimmed); first match for a name wins.
      const descByName = new Map<string, string>();
      for (const p of prose?.properties ?? []) {
        const key = p.name.trim().toLowerCase();
        if (!descByName.has(key)) descByName.set(key, p.description);
      }
      const rows: PropertyRow[] = spec.props.map((pr) => ({
        name: pr.name,
        type: TYPE_WORDS[pr.kind] ?? pr.kind,
        // One separator for the whole Values column: a boolean's pair is
        // joined the way an enum's options are.
        values: pr.kind === 'boolean' ? 'true · false' : pr.options?.length ? pr.options.join(' · ') : '',
        defaultValue: pr.default === undefined ? '' : String(pr.default),
        description: descByName.get(pr.name.trim().toLowerCase()) ?? null,
      }));
      return { id, heading: label, kind: 'propertiesTable', rows, hasDescriptions: rows.some((r) => r.description !== null) };
    }

    case 'anatomy': {
      // Structured anatomy block: the frame builder turns this into a numbered
      // callout diagram (live instance + pins). It carries each part's node id
      // and the component's node id so geometry can be resolved on canvas.
      const included = anatomyFor(spec.anatomy, { includeHidden });
      if (!included.length || !spec.anatomyComponentId) return null;
      // AI role text is matched back to each extracted part by name
      // (case-insensitive, trimmed); first match for a name wins.
      const roleByName = new Map<string, string>();
      for (const p of prose?.anatomyParts ?? []) {
        const key = p.name.trim().toLowerCase();
        if (!roleByName.has(key)) roleByName.set(key, p.role);
      }
      const labels = calloutLabels(included.map((a) => a.depth));
      const parts: AnatomyPartBlock[] = included.map((a, i) => ({
        label: labels[i], name: a.name, nested: a.nested, id: a.id, depth: a.depth, component: a.component,
        // Same filter as the Tokens section: a part the doc does not draw must
        // not lend its token names to a legend row either.
        tokens: [...new Set(tokensFor(spec.tokens, { includeHidden }).filter((t) => t.part === a.name).map((t) => t.name))],
        type: a.type, shownBy: a.shownBy,
        role: roleByName.get(a.name.trim().toLowerCase()),
      }));
      return {
        id, heading: label, kind: 'anatomy', componentId: spec.anatomyComponentId, parts,
        view: options?.anatomyView ?? 'diagram', summary: prose?.anatomySummary?.trim() || null,
      };
    }

    case 'measurements': {
      // Token lookup for the DEFAULT variant only: the measure diagram renders
      // the default variant's geometry, so its labels must resolve exactly the
      // tokens that variant carries. Raw (unbound) values fall out naturally:
      // the builder reads live px values and shows them un-decorated when no
      // key matches. `tableRows` is the same data as a flat table, for the
      // fallback when the diagram cannot be drawn.
      const tokens: Record<string, string> = {};
      const tableRows: string[][] = [];
      for (const t of resolveTokensForVariant(tokensFor(spec.tokens, { includeHidden }), defaultAxisValues(spec))) {
        tokens[measureKey(t.part, t.property)] = t.token;
        // The table lists what the section is named for: gap, padding, radius,
        // border width, min and max size. Colour and typography bindings are
        // the Tokens section's; a fill listed under Measurements read as a
        // mistake on canvas.
        if (categorize(t.property) === 'measurements') tableRows.push([t.part, t.property, t.token]);
      }
      const rootPart = spec.variants.length > 0 ? 'Container' : cleanPartName(spec.name);
      // Each selected lens renders as its own focused mini-diagram. Preserve the
      // canonical size→padding→spacing order and fall back to all three when the
      // caller passes nothing (or an empty selection — the UI's "unchecked all"
      // guard resolves to the default here).
      const ALL_MEASURE_VIEWS: MeasureView[] = ['size', 'padding', 'spacing'];
      const requested = options?.measureViews;
      const views = requested && requested.length ? ALL_MEASURE_VIEWS.filter((v) => requested.includes(v)) : ALL_MEASURE_VIEWS;
      return { id, heading: label, kind: 'measure', componentId: spec.anatomyComponentId, rootPart, tokens, views, tableRows };
    }

    case 'variants': {
      const stateProps = stateAxisProps(spec.variants);
      const axes = spec.variants.filter((v) => !stateProps.has(v.prop));
      if (axes.length === 0) return null;
      const defaults = defaultAxisValues(spec);
      const intro = prose?.variantsIntro?.trim() || null;
      // Re-checked against the live spec on every build, not just when the AI
      // wrote it. The prose reaching here is the stored blob merged with what
      // the canvas says, neither of which has seen validateProseV2 since the
      // day it was written, so renaming an option value would otherwise leave
      // its bullet on the page for good. Same fold as validateProseV2's, and
      // over the non-state axes only, because those are the columns this
      // matrix draws.
      const optionValues = new Set(axes.flatMap((a) => a.values).map(foldName));
      const guide = (prose?.variantsGuide ?? [])
        .filter((g) => optionValues.has(foldName(typeof g?.name === 'string' ? g.name : '')));

      // A boolean axis (True/False) has no self-describing values, so a bare
      // "FALSE"/"TRUE" header reads as meaningless. Qualify those with the axis
      // name; enum axes (Small/Large, Primary/…) are left as-is. Display only,
      // as typed: "isInvalid: true", never uppercased — findCell still keys off
      // the raw axis values.
      const isBooleanAxis = (a: { values: string[] }): boolean =>
        a.values.length === 2 && a.values.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false');
      const axisLabel = (a: { prop: string; values: string[] }, value: string): string =>
        isBooleanAxis(a) ? `${a.prop}: ${value}` : value;

      // Cell = the instance matching { ...defaults, ...overrides } exactly;
      // fall back to the first instance matching just the requested overrides
      // (so held/extra axes don't block a match when no exact combo exists).
      const findCell = (overrides: Record<string, string>): string | null => {
        const want: Record<string, string> = { ...defaults, ...overrides };
        const exact = spec.variantInstances.find((i) => Object.entries(want).every(([a, v]) => i.values[a] === v));
        if (exact) return exact.nodeId;
        const loose = spec.variantInstances.find((i) => Object.entries(overrides).every(([a, v]) => i.values[a] === v));
        return loose?.nodeId ?? null;
      };

      if (axes.length === 1) {
        const [A] = axes;
        return {
          id, heading: label, kind: 'variantsMatrix', intro, guide,
          columns: A.values.map((v) => axisLabel(A, v)),
          rows: [{ label: spec.name, cells: A.values.map((v) => findCell({ [A.prop]: v })) }],
          capped: false, note: null,
        };
      }

      // 2+ axes: grid on the first two (declaration order); any further axes are
      // held at their defaults via findCell's `defaults` spread.
      const [A, B, ...held] = axes;

      // Row values: axis A's values, default-first, then capped at 4.
      const defaultA = defaults[A.prop];
      const rowAxisValues = defaultA !== undefined && A.values.includes(defaultA)
        ? [defaultA, ...A.values.filter((v) => v !== defaultA)]
        : A.values;
      const capped = rowAxisValues.length > 4;
      const rowValues = rowAxisValues.slice(0, 4);

      const columns = B.values.map((v) => axisLabel(B, v));
      const rows = rowValues.map((av) => ({
        label: axisLabel(A, av),
        cells: B.values.map((bv) => findCell({ [A.prop]: av, [B.prop]: bv })),
      }));

      const note = held.length
        ? `Other properties held at default: ${held.map((h) => `${h.prop}=${defaults[h.prop] ?? h.values[0]}`).join(', ')}`
        : null;

      return { id, heading: label, kind: 'variantsMatrix', intro, guide, columns, rows, capped, note };
    }

    case 'states': {
      const info = detectStateMatrix(spec.variants);
      if (!info) return null; // no state axis → nothing to show
      const defaults = defaultAxisValues(spec);

      // Row values: the non-state axis's values, default-first, then capped at 4.
      // Default-first ordering guarantees the default row survives the cap even
      // when it doesn't sit within the first 4 raw axis values.
      const rawRowAxisValues: (string | null)[] = info.rowAxis
        ? spec.variants.find((v) => v.prop === info.rowAxis)!.values
        : [null];
      const defaultRowValue = info.rowAxis ? defaults[info.rowAxis] : null;
      const rowAxisValues =
        defaultRowValue !== null && defaultRowValue !== undefined && rawRowAxisValues.includes(defaultRowValue)
          ? [defaultRowValue, ...rawRowAxisValues.filter((v) => v !== defaultRowValue)]
          : rawRowAxisValues;
      const capped = rowAxisValues.length > 4;
      const rowValues = rowAxisValues.slice(0, 4);

      // Cell = the instance matching (rowValue, column) with every other axis
      // at its default; fall back to the first instance matching just those two.
      const findCell = (rowValue: string | null, column: StateColumn): string | null => {
        const want: Record<string, string> = { ...defaults, ...column.override };
        if (info.rowAxis && rowValue !== null) want[info.rowAxis] = rowValue;
        const exact = spec.variantInstances.find((i) => Object.entries(want).every(([a, v]) => i.values[a] === v));
        if (exact) return exact.nodeId;
        const loose = spec.variantInstances.find((i) =>
          Object.entries(column.override).every(([a, v]) => i.values[a] === v)
          && (!info.rowAxis || rowValue === null || i.values[info.rowAxis] === rowValue));
        return loose?.nodeId ?? null;
      };

      const rows = rowValues.map((rv) => ({ label: rv ?? spec.name, cells: info.columns.map((c) => findCell(rv, c)) }));
      // The matrix alone. A table of token deltas per state with an AI "when
      // it applies" line sat under it until 2026-09-19; the `states` prose key
      // it drew stays in the v2 contract, unrequested, until 6.0.0 retires it.
      return {
        id, heading: label, kind: 'statesMatrix',
        axisName: info.axis ?? '', states: info.columns.map((c) => c.label), rows, capped,
      };
    }

    case 'tokens': {
      // Per-variant view: one block per selected variant, each showing only the
      // tokens that resolve for that variant. Falls back to a flat conditioned
      // table for plain components or when no variant is selected.
      //
      // Filtered once, here, so the pane and the flat table cannot disagree
      // about which rules the doc shows. A rule marked `shownBy` only applies
      // once a boolean property is on, and the instances this section draws
      // have those properties set only when the doc's option is on.
      const tokens = tokensFor(spec.tokens, { includeHidden });
      const instances = spec.variantInstances;
      if (instances.length && selectedVariantIds && selectedVariantIds.size) {
        const defId = defaultVariantId(spec);

        const resolveRows = (values: Record<string, string>): Omit<VariantRow, 'diff'>[] =>
          resolveTokensForVariant(tokens, values).map((t) => ({
            part: t.part, property: t.property, token: t.token, unbound: false,
          }));

        // Baseline keyed by part+property+token — a row is "same" only when the
        // exact token matches; a changed token on the same slot is a diff row.
        const defInst = instances.find((i) => i.nodeId === defId) ?? instances[0];
        const baseline = new Set(resolveRows(defInst.values).map((r) => `${r.part} ${r.property} ${r.token}`));

        const variants: VariantTokenBlock[] = instances
          .filter((inst) => selectedVariantIds.has(inst.nodeId))
          .map((inst) => {
            const isDefault = inst.nodeId === defInst.nodeId;
            const resolved = resolveRows(inst.values);
            // Raw values are observed on the default variant only. Merge each
            // raw row into its matching part group (stable) so buildTokenTable's
            // part-change grouping doesn't emit a duplicate group-header band.
            const withRaw = isDefault
              ? mergeRawIntoParts(resolved, spec.rawValues.map((r) => ({
                  part: r.part, property: r.property, token: r.value, unbound: true,
                })))
              : resolved;

            let sameAsDefault = 0;
            const rows: VariantRow[] = [];
            for (const r of withRaw) {
              const same = baseline.has(`${r.part} ${r.property} ${r.token}`);
              if (isDefault) rows.push({ ...r, diff: false });
              else if (same) sameAsDefault++;
              else rows.push({ ...r, diff: true });
            }
            return {
              name: variantLabel(inst),
              props: Object.entries(inst.values).map(([name, value]) => ({ name, value })),
              nodeId: inst.nodeId, isDefault, rows, sameAsDefault,
            };
          });
        if (variants.length) {
          return { id, heading: label, kind: 'variantTokens', columns: ['Part', 'Property', 'Token'], variants };
        }
      }

      // Plain component, or no variant ticked: the conditioned table, as
      // before, but omitted rather than drawn empty.
      // An unconditioned binding reads "Always" on the canvas. formatConditions
      // keeps its dash: the AI prompt (promptV2.ts) compares against it.
      const rows = tokens.map((t) => [t.part, t.property, t.name,
        Object.keys(t.conditions).length ? formatConditions(t.conditions) : 'Always']);
      if (!rows.length) return null;
      return { id, heading: label, kind: 'table', columns: ['Part', 'Property', 'Token', 'Condition'], rows };
    }
  }
}

export function buildDocModel(
  spec: IntermediateSpec, prose: ProseV2 | null, selected: Set<SectionId>,
  selectedVariantIds?: Set<string>, options?: DocModelOptions,
): DocFrameModel {
  const sections: SectionBlock[] = [];
  const omitted: OmittedSection[] = [];
  for (const { id, label } of ALL_SECTIONS) {
    if (!selected.has(id)) continue;
    const block = buildSection(id, label, spec, prose, selectedVariantIds, options);
    if (block) { sections.push(block); continue; }
    // A writing section with no prose is drawn as a placeholder someone can
    // fill in; a section built from the spec with nothing in it is left out,
    // because nobody could write it. See placeholders.ts.
    const shape = placeholderShapeFor(id);
    if (shape) {
      sections.push({ id, heading: label, kind: 'placeholder', shape });
      omitted.push({ id, label, reason: 'placeholder' });
    } else {
      omitted.push({ id, label, reason: 'nothingToShow' });
    }
  }
  return {
    componentName: spec.name,
    displayName: displayComponentName(spec.name),
    sections,
    omitted,
    ...(options?.includeHidden ? { includeHidden: true as const } : {}),
  };
}

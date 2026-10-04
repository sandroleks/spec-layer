import { categorize } from '@spec-layer/extractor';
import type { IntermediateSpec, ProseV2Key, ProseV2, GuidelinePair, VariantInstance, StateColumn } from '@spec-layer/extractor';
import {
  cleanPartName, formatConditions, resolveTokensForVariant,
  detectStateMatrix, stateAxisProps, anatomyFor, tokensFor, firstSentence, foldName,
  transitionYaml, axisLabel, triggerLabel, transitionLabel, durationCell, easingCell,
} from '@spec-layer/extractor';
import { displayComponentName } from './displayNames';
import { placeholderShapeFor, type PlaceholderShape } from './placeholders';

export { firstSentence };

export type SectionId =
  | 'definition' | 'whenToUse' | 'variants' | 'dosDonts' | 'related'
  | 'anatomy' | 'properties' | 'states' | 'motion' | 'measurements' | 'tokens'
  | 'keyboard' | 'pointer' | 'accessibility' | 'contentConsiderations';

export type GroupId = 'usage' | 'specs' | 'a11y';

/** The section map, in frame order. `label` is the canvas heading and the name
 *  an omission is reported under. */
export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean; group: GroupId; beta?: true }[] = [
  { id: 'definition',            label: 'Overview',             ai: true,  group: 'usage' },
  { id: 'whenToUse',             label: 'When to use',          ai: true,  group: 'usage' },
  { id: 'variants',              label: 'Variants',             ai: true,  group: 'usage' },
  { id: 'dosDonts',              label: 'Do and don’t',         ai: true,  group: 'usage' },
  { id: 'related',               label: 'Related components',   ai: false, group: 'usage' },
  { id: 'anatomy',               label: 'Anatomy',              ai: true,  group: 'specs' },
  { id: 'properties',            label: 'Properties',           ai: true,  group: 'specs' },
  { id: 'states',                label: 'States',               ai: false, group: 'specs' },
  { id: 'motion',                label: 'Motion',               ai: false, group: 'specs', beta: true },
  { id: 'measurements',          label: 'Measurements',         ai: false, group: 'specs' },
  { id: 'tokens',                label: 'Tokens',               ai: false, group: 'specs' },
  { id: 'keyboard',              label: 'Keyboard',             ai: true,  group: 'a11y'  },
  { id: 'pointer',               label: 'Pointer and touch',    ai: true,  group: 'a11y'  },
  { id: 'accessibility',         label: 'Semantics and focus',  ai: true,  group: 'a11y'  },
  { id: 'contentConsiderations', label: 'Content',              ai: true,  group: 'a11y'  },
];

/** Section ids this build renders. A stored config can name a removed section,
 *  which would silently render nothing, so parsing filters against this set. */
export const KNOWN_SECTION_IDS: ReadonlySet<string> = new Set(ALL_SECTIONS.map((s) => s.id));

/** Old section ids a stored DocConfig may carry, mapped to the ids that render
 *  their content now, so an old doc rebuilds without losing sections. */
export const LEGACY_SECTION_IDS: Readonly<Record<string, SectionId[]>> = {
  configuration: ['properties'],
  interactions: ['pointer', 'keyboard'],
};

/** In display and build order. */
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'specs', label: 'Specifications' },
  { id: 'a11y',  label: 'Accessibility' },
];

/**
 * The v2 prose keys each section needs. Without them a section is a
 * placeholder if it has one (placeholders.ts), else omitted. Overview and
 * Variants also render without prose.
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

export function proseKeysForSections(ids: Iterable<SectionId>): Set<ProseV2Key> {
  const out = new Set<ProseV2Key>();
  for (const id of ids) for (const k of PROSE_KEYS_BY_SECTION[id] ?? []) out.add(k);
  return out;
}

/** An inline run of text; `bold` marks **lead-ins**, `code` marks `spans`. */
export interface TextRun { text: string; bold?: boolean; code?: boolean }
export interface Bullet { runs: TextRun[]; text: string } // text = plain fallback

/** A resolved token binding, or a raw value (`unbound: true`, `token` holds the
 *  value), which appears only on the default variant's card. `diff` marks a
 *  token that differs from the default's for the same part and property. */
export interface VariantRow {
  part: string;
  property: string;
  token: string;
  unbound: boolean;
  diff: boolean;
}

/** One documented variant. The default lists every row; the others list only
 *  rows that differ, with `sameAsDefault` counting the rest. */
export interface VariantTokenBlock {
  name: string;
  props: { name: string; value: string }[];
  nodeId: string;
  isDefault: boolean;
  rows: VariantRow[];
  sameAsDefault: number;
}

/** One anatomy part. `id` lets the frame builder resolve its position live;
 *  `depth` 0 is a direct part; `component` names the main component when
 *  nested; `type` is the raw Figma node type, e.g. "FRAME". */
export interface AnatomyPartBlock {
  /** Hierarchical callout number; see calloutLabels. */
  label: string;
  name: string;
  nested: boolean;
  id: string;
  depth: number;
  component?: string | undefined;
  tokens: string[];
  type: string;
  /** AI role sentence, matched by raw part name. */
  role?: string | undefined;
  /** Only on a part hidden by default: the boolean property that shows it. */
  shownBy?: string | undefined;
}

/** Each selected view becomes its own measure mini-diagram. */
export type MeasureView = 'size' | 'padding' | 'spacing';

/** How sections render, without changing the spec. */
export interface DocModelOptions {
  anatomyView?: 'diagram';
  measureViews?: MeasureView[];
  /** Draw the parts a boolean property hides by default (DocConfig.includeHidden). */
  includeHidden?: boolean;
}

/** A section the result line reports: `nothingToShow` was left out, and
 *  `placeholder` is a writing section drawn without prose. */
export interface OmittedSection { id: SectionId; label: string; reason: 'nothingToShow' | 'placeholder' }
export interface PropertyRow { name: string; type: string; values: string; defaultValue: string; description: string | null }
export interface KeyboardRow { keys: string[]; action: string }
export interface ColumnBlock { heading: string; items: Bullet[]; slot: 'whenToUse' | 'whenNotToUse' }

/** The Usage header's words, and whose: an Update keeps an `ai` subtitle as
 *  editorial and re-reads a `description` one from the component. */
export interface HeaderSubtitle { text: string; source: 'ai' | 'description' }

export type SectionBlock =
  | {
      id: SectionId; heading: string; kind: 'prose'; text: string; source: 'ai' | 'description';
      /** The first sentence, lifted out of `text` into the Usage header. */
      subtitle: HeaderSubtitle | null;
      /** The AI's opening line when the description took the header; it opens
       *  the Overview body instead. Null otherwise. */
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
  /** True only when the doc reveals hidden-by-default parts; the frame builder
   *  then sets every boolean property on each placed instance. */
  includeHidden?: true;
}

export interface DocGroup { id: GroupId; label: string; sections: SectionBlock[] }

/** Partition sections into groups, in GROUPS order, keeping input order within
 *  each. Empty groups are omitted, which is how the frame builder skips them. */
export function groupSections(sections: SectionBlock[]): DocGroup[] {
  const groupOf = new Map<SectionId, GroupId>(ALL_SECTIONS.map((s) => [s.id, s.group]));
  return GROUPS
    .map(({ id, label }) => ({
      id, label,
      sections: sections.filter((s) => groupOf.get(s.id) === id),
    }))
    .filter((g) => g.sections.length > 0);
}

/** "Type=Primary, State=Hover", so a boolean ("Danger=false") reads clearly.
 *  Falls back to the raw Figma name. */
export function variantLabel(inst: VariantInstance): string {
  const pairs = Object.entries(inst.values).map(([axis, value]) => `${axis}=${value}`);
  return pairs.length ? pairs.join(', ') : inst.name;
}

/** The instance matching every variant prop's default, else the first. */
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

function defaultAxisValues(spec: IntermediateSpec): Record<string, string> {
  const defId = defaultVariantId(spec);
  const inst = spec.variantInstances.find((i) => i.nodeId === defId);
  return inst?.values ?? {};
}

/** An unrecognised kind falls through as typed rather than being guessed at. */
const TYPE_WORDS: Record<string, string> = {
  variant: 'Variant', boolean: 'Boolean', text: 'Text', instanceSwap: 'Instance swap', slot: 'Slot',
};

/**
 * Hierarchical callout numbers for a depth-first anatomy list: "1", "2",
 * "2.1", "2.2", "3". Only depth-0 parts get a pin, so numbering per depth
 * keeps the pins contiguous from 1. A depth jump of more than one starts the
 * deeper counters at 1.
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
 * Insert each raw row after the last row of its part, or append it; stable.
 * Keeps buildTokenTable's part-change grouping from drawing a duplicate
 * group header.
 */
function mergeRawIntoParts<T extends { part: string }>(resolved: T[], raw: T[]): T[] {
  const out = [...resolved];
  for (const r of raw) {
    let insertAt = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].part === r.part) insertAt = i + 1;
    }
    if (insertAt === -1) out.push(r);
    else out.splice(insertAt, 0, r);
  }
  return out;
}

/** "### Mouse" to "Mouse", else null. Any depth is accepted so a stray "#"
 *  from the model renders as a subheading, not raw markers. */
export function headingLine(line: string): string | null {
  const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
  return m ? m[1].trim() : null;
}

/** Parse **bold** and `code` markers into runs. They never nest: a backtick
 *  inside a bold run is literal. */
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
 * Split off the first sentence of the first non-empty line as the Usage
 * header subtitle; the rest is the Overview body. Taking the line first keeps
 * headings and bullets out of the header.
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

function stripListMarker(text: string): string {
  return text.replace(/^[-*]\s+/, '');
}

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
      // The designer's Figma description outranks anything a model wrote and
      // leads the header; the AI lede then opens the body, so neither set of
      // words is dropped or printed twice.
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
        // No description: the AI's first sentence leads, the rest is body.
        const { lead, rest } = splitLead([aiLede, ...aiBody].filter(Boolean).join('\n\n'));
        return {
          id, heading: label, kind: 'prose', text: rest, source: 'ai',
          subtitle: lead ? { text: lead, source: 'ai' } : null, lede: null,
        };
      }
      // Verbatim, rather than inventing an opening line.
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
      // Matched by trimmed, case-insensitive name; the first match wins.
      const descByName = new Map<string, string>();
      for (const p of prose?.properties ?? []) {
        const key = p.name.trim().toLowerCase();
        if (!descByName.has(key)) descByName.set(key, p.description);
      }
      const rows: PropertyRow[] = spec.props.map((pr) => ({
        name: pr.name,
        type: TYPE_WORDS[pr.kind] ?? pr.kind,
        values: pr.kind === 'boolean' ? 'true · false' : pr.options?.length ? pr.options.join(' · ') : '',
        defaultValue: pr.default === undefined ? '' : String(pr.default),
        description: descByName.get(pr.name.trim().toLowerCase()) ?? null,
      }));
      return { id, heading: label, kind: 'propertiesTable', rows, hasDescriptions: rows.some((r) => r.description !== null) };
    }

    case 'anatomy': {
      // Node ids let the frame builder resolve geometry on canvas.
      const included = anatomyFor(spec.anatomy, { includeHidden });
      if (!included.length || !spec.anatomyComponentId) return null;
      // Matched as in Properties.
      const roleByName = new Map<string, string>();
      for (const p of prose?.anatomyParts ?? []) {
        const key = p.name.trim().toLowerCase();
        if (!roleByName.has(key)) roleByName.set(key, p.role);
      }
      const labels = calloutLabels(included.map((a) => a.depth));
      const parts: AnatomyPartBlock[] = included.map((a, i) => ({
        label: labels[i], name: a.name, nested: a.nested, id: a.id, depth: a.depth, component: a.component,
        // Same filter as Tokens: an undrawn part lends no token names.
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
      // The default variant only: the diagram draws its geometry. Unbound
      // values show as live px when no key matches. `tableRows` is the
      // fallback when the diagram cannot be drawn.
      const tokens: Record<string, string> = {};
      const tableRows: string[][] = [];
      for (const t of resolveTokensForVariant(tokensFor(spec.tokens, { includeHidden }), defaultAxisValues(spec))) {
        tokens[measureKey(t.part, t.property)] = t.token;
        // Measurements only; colour and type bindings belong to Tokens.
        if (categorize(t.property) === 'measurements') tableRows.push([t.part, t.property, t.token]);
      }
      const rootPart = spec.variants.length > 0 ? 'Container' : cleanPartName(spec.name);
      // Canonical order; nothing or an empty selection means all three.
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
      // Re-checked against the live spec on every build: stored and canvas
      // prose has not seen validateProseV2 since it was written, so a renamed
      // option would keep its bullet. Same fold, over the non-state axes this
      // matrix draws.
      const optionValues = new Set(axes.flatMap((a) => a.values).map(foldName));
      const guide = (prose?.variantsGuide ?? [])
        .filter((g) => optionValues.has(foldName(typeof g?.name === 'string' ? g.name : '')));

      // A bare "true" header means nothing, so boolean axes read
      // "isInvalid: true". Display only: findCell keys off raw values.
      const isBooleanAxis = (a: { values: string[] }): boolean =>
        a.values.length === 2 && a.values.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false');
      const axisLabel = (a: { prop: string; values: string[] }, value: string): string =>
        isBooleanAxis(a) ? `${a.prop}: ${value}` : value;

      // The exact match over defaults plus overrides, else the first instance
      // matching just the overrides, so held axes do not block a match.
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

      // Grid on the first two axes; the rest are held at their defaults.
      const [A, B, ...held] = axes;

      // Default first, then capped at 4.
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
      if (!info) return null;
      const defaults = defaultAxisValues(spec);

      // Default first, so the default row survives the cap of 4.
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

      // As in variants: exact over defaults, else matching just these two.
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
      // The `states` prose key stays in the v2 contract but is never requested.
      return {
        id, heading: label, kind: 'statesMatrix',
        axisName: info.axis ?? '', states: info.columns.map((c) => c.label), rows, capped,
      };
    }

    case 'motion': {
      // Omitted rather than drawn empty, like Tokens. The trigger layer joins
      // the Trigger cell because the canvas table is width-bound; Markdown
      // keeps Part as its own column.
      const rules = spec.transitions ?? [];
      if (!rules.length) return null;
      const rows = rules.map((rule) => {
        const row = transitionYaml(rule);
        const onPart = rule.triggerPath.includes('/') ? rule.triggerPart : null;
        return [
          axisLabel(row.from), axisLabel(row.to), triggerLabel(row.trigger, onPart),
          transitionLabel(row.transition), durationCell(row.transition), easingCell(row.transition),
        ];
      });
      return { id, heading: label, kind: 'table', columns: ['From', 'To', 'Trigger', 'Transition', 'Duration', 'Easing'], rows };
    }

    case 'tokens': {
      // One block per selected variant, else a flat conditioned table. Filtered
      // once so both views agree: a `shownBy` rule applies only when the doc's
      // includeHidden option sets those properties on its instances.
      const tokens = tokensFor(spec.tokens, { includeHidden });
      const instances = spec.variantInstances;
      if (instances.length && selectedVariantIds && selectedVariantIds.size) {
        const defId = defaultVariantId(spec);

        const resolveRows = (values: Record<string, string>): Omit<VariantRow, 'diff'>[] =>
          resolveTokensForVariant(tokens, values).map((t) => ({
            part: t.part, property: t.property, token: t.token, unbound: false,
          }));

        // "Same" only when the exact token matches on the same slot.
        const defInst = instances.find((i) => i.nodeId === defId) ?? instances[0];
        const baseline = new Set(resolveRows(defInst.values).map((r) => `${r.part} ${r.property} ${r.token}`));

        const variants: VariantTokenBlock[] = instances
          .filter((inst) => selectedVariantIds.has(inst.nodeId))
          .map((inst) => {
            const isDefault = inst.nodeId === defInst.nodeId;
            const resolved = resolveRows(inst.values);
            // Raw values are observed on the default variant only.
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

      // Omitted rather than drawn empty. An unconditioned binding reads
      // "Always"; formatConditions keeps its dash because promptV2.ts
      // compares against it.
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
    // A writing section becomes a placeholder someone can fill; an empty
    // spec section is left out, since nobody could write it.
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

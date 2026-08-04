import type { IntermediateSpec, ProseDrafts, ProseKey, VariantInstance, StateColumn } from '@spec-layer/extractor';
import {
  cleanPartName, formatConditions, resolveTokensForVariant,
  detectStateMatrix, stateAxisProps,
} from '@spec-layer/extractor';

export type SectionId =
  | 'definition' | 'anatomy' | 'measurements' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'interactions'
  | 'contentConsiderations' | 'accessibility' | 'dosDonts' | 'related';

export type GroupId = 'usage' | 'specs' | 'a11y';

export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean; group: GroupId }[] = [
  { id: 'definition',    label: 'Overview',      ai: true,  group: 'usage' },
  { id: 'anatomy',       label: 'Anatomy',       ai: true,  group: 'specs' },
  { id: 'measurements',  label: 'Measurements',  ai: false, group: 'specs' },
  { id: 'configuration', label: 'Configuration', ai: false, group: 'specs' },
  { id: 'variants',      label: 'Variants',      ai: true,  group: 'usage' },
  { id: 'states',        label: 'States',        ai: false, group: 'specs' },
  { id: 'tokens',        label: 'Tokens used',   ai: false, group: 'specs' },
  { id: 'interactions',          label: 'Interactions',           ai: true,  group: 'a11y'  },
  { id: 'contentConsiderations', label: 'Content Considerations', ai: true,  group: 'a11y'  },
  { id: 'accessibility', label: 'Semantics & Focus', ai: true, group: 'a11y' },
  { id: 'dosDonts',      label: "Do's & Don'ts", ai: true,  group: 'usage' },
  { id: 'related',       label: 'Related components', ai: false, group: 'usage' },
];

/** The three output groups, in canonical display/build order. The a11y group
 *  keeps the "Accessibility" label (its sections are aspects of accessibility);
 *  the semantics section inside it is named "Semantics & Focus" so the frame
 *  never repeats its own heading. */
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'specs', label: 'Specifications' },
  { id: 'a11y',  label: 'Accessibility' },
];

/** Which prose keys each AI section needs from the prose pass. Non-AI sections
 *  are absent (→ no keys). Drives the selection-aware prose request so unchecked
 *  sections cost zero output tokens. */
const PROSE_KEYS_BY_SECTION: Partial<Record<SectionId, ProseKey[]>> = {
  definition: ['definition'],
  variants: ['variantsSummary'],
  anatomy: ['anatomySummary', 'anatomyParts'],
  accessibility: ['accessibility'],
  interactions: ['interactions'],
  contentConsiderations: ['contentConsiderations'],
  dosDonts: ['dos', 'donts'],
};

/** Union of the prose keys needed by the given (checked) sections. */
export function proseKeysForSections(ids: Iterable<SectionId>): Set<ProseKey> {
  const out = new Set<ProseKey>();
  for (const id of ids) for (const k of PROSE_KEYS_BY_SECTION[id] ?? []) out.add(k);
  return out;
}

/** An inline run of text; `bold` marks bold lead-ins parsed from **markers**. */
export interface TextRun { text: string; bold?: boolean }
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

/** One anatomy part placed on the diagram: its 1-based number, label, whether
 *  it is a nested component, and the Figma node id used to resolve its position
 *  (and screenshot) live in the frame builder. `depth` is the nesting level
 *  (0 = direct part); `component` names the main component when nested;
 *  `tokens` lists the unique token names bound to this part; `type` is the raw
 *  Figma node type (e.g. "FRAME"), shown lowercased in the table view. */
export interface AnatomyPartBlock {
  n: number;
  name: string;
  nested: boolean;
  id: string;
  depth: number;
  component?: string;
  tokens: string[];
  type: string;
  description?: string; // AI-supplied role text, matched by part name (optional)
}

/** Which measurement lens a measure mini-diagram renders. Each selected view
 *  becomes its own focused diagram in the frame (size / padding / spacing). */
export type MeasureView = 'size' | 'padding' | 'spacing';

/** Options threaded through `buildDocModel` that affect how sections render
 *  without changing the underlying spec — the anatomy view mode and which
 *  measurement lenses to render. */
export interface DocModelOptions {
  anatomyView?: 'diagram' | 'table' | 'both';
  measureViews?: MeasureView[];
}

export type SectionBlock =
  | { id: SectionId; heading: string; kind: 'prose'; text: string }
  | { id: SectionId; heading: string; kind: 'bullets'; items: Bullet[] }
  | { id: SectionId; heading: string; kind: 'table'; columns: string[]; rows: string[][] }
  | { id: SectionId; heading: string; kind: 'variantTokens'; columns: string[]; variants: VariantTokenBlock[] }
  | { id: SectionId; heading: string; kind: 'anatomy'; componentId: string; parts: AnatomyPartBlock[]; view: 'diagram' | 'table' | 'both'; summary: string | null }
  | { id: SectionId; heading: string; kind: 'measure'; componentId: string; rootPart: string; tokens: Record<string, string>; views: MeasureView[] }
  | {
      id: SectionId; heading: string; kind: 'statesMatrix';
      axisName: string;
      states: string[];                       // column headers, lifecycle-ordered
      rows: { label: string; cells: (string | null)[] }[]; // cell = variant nodeId or null
      capped: boolean;                        // true when >4 row values existed
    }
  | {
      id: SectionId; heading: string; kind: 'variantsMatrix';
      summary: string | null;                 // AI orientation, or null
      columns: string[];                       // second-axis values, or [''] for 1-axis
      rows: { label: string; cells: (string | null)[] }[];
      capped: boolean;
      note: string | null;                     // held-axis note, or null
    };

export interface DocFrameModel { componentName: string; sections: SectionBlock[] }

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

const AI_PLACEHOLDER = '_To be written._';

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

/** Split a paragraph into its first sentence and the remainder. A sentence ends
 *  at the first `.`/`!`/`?` that is followed by whitespace and an uppercase
 *  letter or `(` — so "e.g. a Toggle" and "3.5 items" do not end it. Returns the
 *  whole text as the sentence (empty remainder) when no boundary is found. */
export function firstSentence(text: string): { sentence: string; remainder: string } {
  const t = text.trim();
  const m = /[.!?](?=\s+[A-Z(])/.exec(t);
  if (!m) return { sentence: t, remainder: '' };
  const end = m.index + 1; // include the punctuation
  return { sentence: t.slice(0, end).trim(), remainder: t.slice(end).trim() };
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
 * Parse a Markdown string with **bold** markers into an array of TextRun objects.
 * Runs between ** markers are bold; everything else is plain.
 */
export function parseRuns(md: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = md.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push({ text: part.slice(2, -2), bold: true });
    } else {
      runs.push({ text: part });
    }
  }
  return runs;
}

/** Strip leading "- " or "* " list markers from a plain text string. */
function stripListMarker(text: string): string {
  return text.replace(/^[-*]\s+/, '');
}

/** Build a Bullet from a raw string (may have ** markers and/or a list marker). */
function makeBullet(raw: string): Bullet {
  const plain = stripListMarker(raw).replace(/\*\*/g, '');
  const runs = parseRuns(stripListMarker(raw));
  return { text: plain, runs };
}

function buildSection(
  id: SectionId,
  label: string,
  spec: IntermediateSpec,
  prose: ProseDrafts | null,
  selectedVariantIds?: Set<string>,
  options?: DocModelOptions,
): SectionBlock | null {
  switch (id) {
    case 'definition': {
      return {
        id, heading: label, kind: 'prose',
        text: prose?.definition ?? AI_PLACEHOLDER,
      };
    }

    case 'accessibility': {
      return {
        id, heading: label, kind: 'prose',
        text: prose?.accessibility ?? AI_PLACEHOLDER,
      };
    }

    case 'interactions': {
      return { id, heading: label, kind: 'prose', text: prose?.interactions ?? AI_PLACEHOLDER };
    }

    case 'contentConsiderations': {
      return { id, heading: label, kind: 'prose', text: prose?.contentConsiderations ?? AI_PLACEHOLDER };
    }

    case 'dosDonts': {
      let items: Bullet[];
      if (prose) {
        items = [
          ...prose.dos.map((d) => makeBullet(`✅ ${d}`)),
          ...prose.donts.map((d) => makeBullet(`❌ ${d}`)),
        ];
      } else {
        items = [makeBullet(AI_PLACEHOLDER)];
      }
      return { id, heading: label, kind: 'bullets', items };
    }

    case 'anatomy': {
      // Structured anatomy block: the frame builder turns this into a numbered
      // callout diagram (screenshot + pins). It carries each part's node id and
      // the component's node id so geometry can be resolved live on canvas.
      // Falls back to a plain "None." bullet when there are no parts or no
      // component to screenshot.
      if (spec.anatomy.length && spec.anatomyComponentId) {
        // AI role text is matched back to each extracted part by name
        // (case-insensitive, trimmed); first match for a name wins.
        const descByName = new Map<string, string>();
        for (const p of prose?.anatomyParts ?? []) {
          const key = p.name.trim().toLowerCase();
          if (!descByName.has(key)) descByName.set(key, p.description);
        }
        const parts = spec.anatomy.map((a, i) => ({
          n: i + 1,
          name: a.name,
          nested: a.nested,
          id: a.id,
          depth: a.depth,
          component: a.component,
          tokens: [...new Set(spec.tokens.filter((t) => t.part === a.name).map((t) => t.token))],
          type: a.type,
          description: descByName.get(a.name.trim().toLowerCase()),
        }));
        return {
          id, heading: label, kind: 'anatomy',
          componentId: spec.anatomyComponentId, parts, view: 'diagram',
          summary: prose?.anatomySummary ?? null,
        };
      }
      return { id, heading: label, kind: 'bullets', items: [makeBullet('_None._')] };
    }

    case 'measurements': {
      // Token lookup for the DEFAULT variant only: the measure diagram renders the
      // default variant's geometry, so its labels must resolve exactly the tokens
      // that variant carries. Raw (unbound) values fall out naturally: the builder
      // reads live px values and shows them un-decorated when no key matches.
      const tokens: Record<string, string> = {};
      for (const t of resolveTokensForVariant(spec.tokens, defaultAxisValues(spec))) {
        tokens[measureKey(t.part, t.property)] = t.token;
      }
      const rootPart = spec.variants.length > 0 ? 'Container' : cleanPartName(spec.name);
      // Each selected lens renders as its own focused mini-diagram. Preserve the
      // canonical size→padding→spacing order and fall back to all three when the
      // caller passes nothing (or an empty selection — the UI's "unchecked all"
      // guard resolves to the default here).
      const ALL_MEASURE_VIEWS: MeasureView[] = ['size', 'padding', 'spacing'];
      const requested = options?.measureViews;
      const views = requested && requested.length
        ? ALL_MEASURE_VIEWS.filter((v) => requested.includes(v))
        : ALL_MEASURE_VIEWS;
      return {
        id, heading: label, kind: 'measure',
        componentId: spec.anatomyComponentId, rootPart, tokens, views,
      };
    }

    case 'configuration': {
      const configProps = spec.props.filter((p) => p.kind !== 'variant');
      if (!configProps.length) {
        return {
          id, heading: label, kind: 'table',
          columns: ['Name', 'Kind', 'Options', 'Default'],
          rows: [],
        };
      }
      const rows = configProps.map((pr) => {
        const options =
          pr.kind === 'boolean' ? 'true / false'
          : pr.options?.length ? pr.options.join(' · ')
          : '—';
        return [pr.name, pr.kind, options, String(pr.default ?? '—')];
      });
      return {
        id, heading: label, kind: 'table',
        columns: ['Name', 'Kind', 'Options', 'Default'],
        rows,
      };
    }

    case 'variants': {
      const stateProps = stateAxisProps(spec.variants);
      const axes = spec.variants.filter((v) => !stateProps.has(v.prop));
      const defaults = defaultAxisValues(spec);
      const summary = prose?.variantsSummary ?? null;

      // A boolean axis (True/False) has no self-describing values, so a bare
      // "FALSE"/"TRUE" header reads as meaningless. Qualify those with the axis
      // name; enum axes (Small/Large, Primary/…) are left as-is. Display only —
      // findCell still keys off the raw axis values.
      const isBooleanAxis = (a: { values: string[] }) =>
        a.values.length === 2 && a.values.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false');
      const axisLabel = (a: { prop: string; values: string[] }, value: string) =>
        isBooleanAxis(a) ? `${a.prop}: ${value}` : value;

      // Cell = the instance matching { ...defaults, ...overrides } exactly;
      // fall back to the first instance matching just the requested overrides
      // (so held/extra axes don't block a match when no exact combo exists).
      const findCell = (overrides: Record<string, string>): string | null => {
        const want: Record<string, string> = { ...defaults, ...overrides };
        const exact = spec.variantInstances.find((i) =>
          Object.entries(want).every(([a, v]) => i.values[a] === v));
        if (exact) return exact.nodeId;
        const loose = spec.variantInstances.find((i) =>
          Object.entries(overrides).every(([a, v]) => i.values[a] === v));
        return loose?.nodeId ?? null;
      };

      if (axes.length === 0) {
        return { id, heading: label, kind: 'bullets', items: [makeBullet('No variants.')] };
      }

      if (axes.length === 1) {
        const [A] = axes;
        return {
          id, heading: label, kind: 'variantsMatrix',
          summary,
          columns: A.values.map((v) => axisLabel(A, v)),
          rows: [{ label: spec.name, cells: A.values.map((v) => findCell({ [A.prop]: v })) }],
          capped: false,
          note: null,
        };
      }

      // 2+ axes: grid on the first two (declaration order); any further axes are
      // held at their defaults via findCell's `defaults` spread.
      const [A, B, ...held] = axes;

      // Row values: axis A's values, default-first, then capped at 4.
      const defaultA = defaults[A.prop];
      const rowAxisValues =
        defaultA !== undefined && A.values.includes(defaultA)
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
        ? `Others held at default: ${held.map((h) => `${h.prop}=${defaults[h.prop] ?? h.values[0]}`).join(', ')}`
        : null;

      return { id, heading: label, kind: 'variantsMatrix', summary, columns, rows, capped, note };
    }

    case 'states': {
      const info = detectStateMatrix(spec.variants);
      if (!info) return null; // auto-hide: no state axis → no section
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
        const exact = spec.variantInstances.find((i) =>
          Object.entries(want).every(([a, v]) => i.values[a] === v));
        if (exact) return exact.nodeId;
        const loose = spec.variantInstances.find((i) =>
          Object.entries(column.override).every(([a, v]) => i.values[a] === v) &&
          (!info.rowAxis || rowValue === null || i.values[info.rowAxis] === rowValue));
        return loose?.nodeId ?? null;
      };

      const rows = rowValues.map((rv) => ({
        label: rv ?? spec.name,
        cells: info.columns.map((c) => findCell(rv, c)),
      }));

      return {
        id, heading: label, kind: 'statesMatrix',
        axisName: info.axis ?? '', states: info.columns.map((c) => c.label), rows, capped,
      };
    }

    case 'tokens': {
      // Per-variant view: one block per selected variant, each showing only the
      // tokens that resolve for that variant. Falls back to a flat conditioned
      // table for plain components or when no variant is selected.
      const instances = spec.variantInstances;
      if (instances.length && selectedVariantIds && selectedVariantIds.size) {
        const defId = defaultVariantId(spec);

        const resolveRows = (values: Record<string, string>): Omit<VariantRow, 'diff'>[] =>
          resolveTokensForVariant(spec.tokens, values).map((t) => ({
            part: t.part, property: t.property, token: t.token, unbound: false,
          }));

        // Baseline keyed by part+property+token — a row is "same" only when the
        // exact token matches; a changed token on the same slot is a diff row.
        const defInst = instances.find((i) => i.nodeId === defId) ?? instances[0];
        const baseline = new Set(
          resolveRows(defInst.values).map((r) => `${r.part} ${r.property} ${r.token}`),
        );

        const variants: VariantTokenBlock[] = instances
          .filter((inst) => selectedVariantIds.has(inst.nodeId))
          .map((inst) => {
            const isDefault = inst.nodeId === defInst.nodeId;
            const resolved = resolveRows(inst.values);
            // Raw values are observed on the default variant only. Merge each raw
            // row into its matching part group (stable): insert after the last
            // existing row of the same part so buildTokenTable's part-change
            // grouping doesn't emit a duplicate group-header band. Raw rows whose
            // part has no token rows append at the end in first-seen order.
            const withRaw = isDefault
              ? mergeRawIntoParts(
                  resolved,
                  spec.rawValues.map((r) => ({
                    part: r.part, property: r.property, token: r.value, unbound: true,
                  })),
                )
              : resolved;

            let sameAsDefault = 0;
            const rows: VariantRow[] = [];
            for (const r of withRaw) {
              const same = baseline.has(`${r.part} ${r.property} ${r.token}`);
              if (isDefault) {
                rows.push({ ...r, diff: false });
              } else if (same) {
                sameAsDefault++;
              } else {
                rows.push({ ...r, diff: true });
              }
            }
            return {
              name: variantLabel(inst),
              props: Object.entries(inst.values).map(([name, value]) => ({ name, value })),
              nodeId: inst.nodeId,
              isDefault,
              rows,
              sameAsDefault,
            };
          });
        if (variants.length) {
          return {
            id, heading: label, kind: 'variantTokens',
            columns: ['Part', 'Property', 'Token'],
            variants,
          };
        }
      }

      const rows = spec.tokens.map((t) => [
        t.part,
        t.property,
        t.token,
        formatConditions(t.conditions),
      ]);
      return {
        id, heading: label, kind: 'table',
        columns: ['Part', 'Property', 'Token', 'Condition'],
        rows,
      };
    }

    case 'related': {
      const items = spec.related.length
        ? spec.related.map((r) => makeBullet(r))
        : [makeBullet('None.')];
      return { id, heading: label, kind: 'bullets', items };
    }
  }
}

export function buildDocModel(
  spec: IntermediateSpec,
  prose: ProseDrafts | null,
  selected: Set<SectionId>,
  selectedVariantIds?: Set<string>,
  options?: DocModelOptions,
): DocFrameModel {
  const out: SectionBlock[] = [];
  for (const { id, label } of ALL_SECTIONS) {
    if (!selected.has(id)) continue;
    const block = buildSection(id, label, spec, prose, selectedVariantIds, options);
    if (block) out.push(block);
  }
  return { componentName: spec.name, sections: out };
}

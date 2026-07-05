import type { IntermediateSpec, ProseDrafts, VariantInstance } from '@spec-layer/extractor';
import { cleanPartName, formatConditions, resolveTokensForVariant } from '@spec-layer/extractor';

export type SectionId =
  | 'definition' | 'anatomy' | 'measurements' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'accessibility' | 'dosDonts' | 'related';

export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean }[] = [
  { id: 'definition',    label: 'Definition',    ai: true  },
  { id: 'anatomy',       label: 'Anatomy',       ai: false },
  { id: 'measurements',  label: 'Measurements',  ai: false },
  { id: 'configuration', label: 'Configuration', ai: false },
  { id: 'variants',      label: 'Variants',      ai: false },
  { id: 'states',        label: 'States',        ai: false },
  { id: 'tokens',        label: 'Tokens used',   ai: false },
  { id: 'accessibility', label: 'Accessibility', ai: true  },
  { id: 'dosDonts',      label: "Do's & Don'ts", ai: true  },
  { id: 'related',       label: 'Related atoms', ai: false },
];

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
 *  (and screenshot) live in the frame builder. */
export interface AnatomyPartBlock { n: number; name: string; nested: boolean; id: string }

export type SectionBlock =
  | { id: SectionId; heading: string; kind: 'prose'; text: string }
  | { id: SectionId; heading: string; kind: 'bullets'; items: Bullet[] }
  | { id: SectionId; heading: string; kind: 'table'; columns: string[]; rows: string[][] }
  | { id: SectionId; heading: string; kind: 'variantTokens'; columns: string[]; variants: VariantTokenBlock[] }
  | { id: SectionId; heading: string; kind: 'anatomy'; componentId: string; parts: AnatomyPartBlock[] }
  | { id: SectionId; heading: string; kind: 'measure'; componentId: string; rootPart: string; tokens: Record<string, string> };

export interface DocFrameModel { title: string; sections: SectionBlock[] }

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

/**
 * Determine if a variant axis is a modifier (boolean true/false) axis.
 * Mirrors the logic in packages/extractor/src/pivot.ts.
 */
function isModifierAxis(axis: { prop: string; values: string[] }): boolean {
  if (axis.values.length !== 2) return false;
  const lower = axis.values.map((v) => v.toLowerCase());
  return lower.includes('true') && lower.includes('false');
}

/**
 * Determine if a variant axis name refers to "state".
 * Mirrors the logic in packages/extractor/src/pivot.ts.
 */
function isStateAxisName(prop: string): boolean {
  const n = prop.trim().toLowerCase();
  return n === 'state' || n === 'states';
}

function buildSection(
  id: SectionId,
  label: string,
  spec: IntermediateSpec,
  prose: ProseDrafts | null,
  selectedVariantIds?: Set<string>,
): SectionBlock {
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
        const parts = spec.anatomy.map((a, i) => ({
          n: i + 1,
          name: a.name,
          nested: a.nested,
          id: a.id,
        }));
        return { id, heading: label, kind: 'anatomy', componentId: spec.anatomyComponentId, parts };
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
      return {
        id, heading: label, kind: 'measure',
        componentId: spec.anatomyComponentId, rootPart, tokens,
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
      // Build a default map from variant props
      const variantDefault: Record<string, string> = {};
      for (const p of spec.props) {
        if (p.kind === 'variant' && typeof p.default === 'string') {
          variantDefault[p.name] = p.default;
        }
      }

      const items: Bullet[] = [];
      for (const v of spec.variants) {
        if (isStateAxisName(v.prop) || isModifierAxis(v)) continue;
        const def = variantDefault[v.prop];
        const valStr = v.values
          .map((val) => (val === def ? `${val} (default)` : val))
          .join(' · ');
        items.push(makeBullet(`**${v.prop}**: ${valStr}`));
      }

      const modifiers = spec.variants.filter(
        (v) => !isStateAxisName(v.prop) && isModifierAxis(v),
      );
      if (modifiers.length) {
        items.push(makeBullet(`**Modifiers**: ${modifiers.map((m) => m.prop).join(' · ')}`));
      }

      if (!items.length) {
        items.push(makeBullet('_None._'));
      }

      return { id, heading: label, kind: 'bullets', items };
    }

    case 'states': {
      const items = spec.states.length
        ? spec.states.map((s) => makeBullet(s))
        : [makeBullet('_None._')];
      return { id, heading: label, kind: 'bullets', items };
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
            // Raw values are observed on the default variant only.
            const withRaw = isDefault
              ? [...resolved, ...spec.rawValues.map((r) => ({
                  part: r.part, property: r.property, token: r.value, unbound: true,
                }))]
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
): DocFrameModel {
  const out: SectionBlock[] = [];
  for (const { id, label } of ALL_SECTIONS) {
    if (!selected.has(id)) continue;
    out.push(buildSection(id, label, spec, prose, selectedVariantIds));
  }
  return { title: `${spec.name}: Guidelines`, sections: out };
}

import type { IntermediateSpec, ProseDrafts } from '@spec-layer/extractor';
import { formatConditions } from '@spec-layer/extractor';

export type SectionId =
  | 'definition' | 'anatomy' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'accessibility' | 'dosDonts' | 'related';

export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean }[] = [
  { id: 'definition',    label: 'Definition',    ai: true  },
  { id: 'anatomy',       label: 'Anatomy',       ai: false },
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

export type SectionBlock =
  | { id: SectionId; heading: string; kind: 'prose'; text: string }
  | { id: SectionId; heading: string; kind: 'bullets'; items: Bullet[] }
  | { id: SectionId; heading: string; kind: 'table'; columns: string[]; rows: string[][] };

export interface DocFrameModel { title: string; sections: SectionBlock[] }

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
      const items = spec.anatomy.length
        ? spec.anatomy.map((a) => makeBullet(`${a.name}${a.nested ? ' (component)' : ''}`))
        : [makeBullet('_None._')];
      return { id, heading: label, kind: 'bullets', items };
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
): DocFrameModel {
  const out: SectionBlock[] = [];
  for (const { id, label } of ALL_SECTIONS) {
    if (!selected.has(id)) continue;
    out.push(buildSection(id, label, spec, prose));
  }
  return { title: `${spec.name}: Guidelines`, sections: out };
}

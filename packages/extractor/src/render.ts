import type { IntermediateSpec } from './extract';
import { specContentHash } from './hash';
import type { TokenRule } from './tokens';
import { serializeFrontmatter, type SpecFrontmatter } from '@spec-layer/format';
import type { ProseDrafts } from './prose/prompt';
import {
  categorize, pivotColorPart, flatPartTable, flatGlobalTable, fixedTable,
  isUnconditioned, isModifierAxis, isStateAxisName,
} from './pivot';

const slug = (name: string) =>
  name.toLowerCase()
    .replace(/[/\\\s,=]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Render `## Variants`: true style axes (one bullet each, default marked) plus a
 * single `Modifiers` bullet listing the boolean (true/false) variant axes. The
 * State axis is owned by `## States` and is not repeated here.
 */
function renderVariants(spec: IntermediateSpec): string[] {
  const variantDefault: Record<string, string> = {};
  for (const p of spec.props) {
    if (p.kind === 'variant' && typeof p.default === 'string') variantDefault[p.name] = p.default;
  }

  const lines: string[] = [];
  for (const v of spec.variants) {
    if (isStateAxisName(v.prop) || isModifierAxis(v)) continue;
    const def = variantDefault[v.prop];
    lines.push(`- **${v.prop}**: ${v.values.map((val) => (val === def ? `${val} (default)` : val)).join(' · ')}`);
  }
  const modifiers = spec.variants.filter((v) => !isStateAxisName(v.prop) && isModifierAxis(v));
  if (modifiers.length) lines.push(`- **Modifiers**: ${modifiers.map((m) => m.prop).join(' · ')}`);

  return lines.length ? lines : ['_None._'];
}

/**
 * Render `## Configuration`: the non-variant props (boolean / text /
 * instanceSwap) — the component's options. Variant axes live in `## Variants`
 * and `## States`, so they are not duplicated here.
 */
function renderConfiguration(spec: IntermediateSpec): string[] {
  const configProps = spec.props.filter((p) => p.kind !== 'variant');
  if (!configProps.length) return ['_None._'];
  return [
    '| Name | Kind | Options | Default |', '|---|---|---|---|',
    ...configProps.map((pr) => {
      const options =
        pr.kind === 'boolean' ? 'true / false'
        : pr.options?.length ? pr.options.join(' · ')
        : '—';
      return `| ${pr.name} | ${pr.kind} | ${options} | ${pr.default ?? '—'} |`;
    }),
  ];
}

/**
 * Render the body of `## Tokens used` as three category sub-sections (Color,
 * Typography, Measurements). Within Color, parts whose bindings are all
 * unconditioned collapse into a single trailing `#### Fixed` table; the rest are
 * pivoted per part (with a flat fallback).
 */
function renderTokensSection(spec: IntermediateSpec): string[] {
  const colorByPart = new Map<string, TokenRule[]>();
  const colorPartOrder: string[] = [];
  const typography: TokenRule[] = [];
  const measurements: TokenRule[] = [];
  for (const r of spec.tokens) {
    const cat = categorize(r.property);
    if (cat === 'color') {
      let list = colorByPart.get(r.part);
      if (!list) {
        colorByPart.set(r.part, (list = []));
        colorPartOrder.push(r.part);
      }
      list.push(r);
    } else if (cat === 'typography') typography.push(r);
    else measurements.push(r);
  }

  const defaults: Record<string, string> = {};
  for (const p of spec.props) {
    if (p.kind === 'variant' && typeof p.default === 'string') defaults[p.name] = p.default;
  }

  const lines: string[] = [];

  if (colorPartOrder.length) {
    lines.push('### Color', '');
    const fixedEntries: { part: string; rule: TokenRule }[] = [];
    for (const part of colorPartOrder) {
      const rules = colorByPart.get(part)!;
      // Parts with only unconditioned bindings merge into the Fixed table.
      if (rules.every(isUnconditioned)) {
        for (const rule of rules) fixedEntries.push({ part, rule });
        continue;
      }
      lines.push(`#### ${part}`, '');
      const pivoted = pivotColorPart(rules, spec.variants, defaults);
      lines.push(...(pivoted ?? flatPartTable(rules)));
    }
    if (fixedEntries.length) {
      lines.push('#### Fixed', '', ...fixedTable(fixedEntries));
    }
  }

  if (typography.length) {
    lines.push('### Typography', '', ...flatGlobalTable(typography));
  }

  if (measurements.length) {
    lines.push('### Measurements', '', ...flatGlobalTable(measurements));
  }

  if (!lines.length) return ['_None._', ''];
  return lines;
}

export function renderSpec(
  spec: IntermediateSpec,
  opts: { prose: ProseDrafts | null; extractedAt: string; status?: SpecFrontmatter['status'] },
): string {
  // content_hash is computed by specContentHash (see hash.ts) so the drift
  // baseline and this frontmatter can never diverge: it excludes rawValues
  // (presentation-only) and reduces anatomy to the legacy depth-0-only,
  // {id,name,type,nested} shape so canvas-only additions (rawValues, deeper
  // anatomy) never flip content_hash for existing committed specs.
  const fm: SpecFrontmatter = {
    spec_version: '0.1',
    // Status is optional: omitted unless the caller explicitly supplies one.
    ...(opts.status ? { status: opts.status } : {}),
    component: { name: spec.name, figma_key: spec.figmaKey, figma_file: spec.figmaFile, figma_node: spec.figmaNode },
    content_hash: specContentHash(spec),
    extracted_at: opts.extractedAt,
  };
  const p = opts.prose;

  const lines: string[] = [
    '## Definition', '', p?.definition ?? '_To be written._', '',
    '## Anatomy', '',
    // Markdown lists depth-0 parts only: deeper structure (Task 7's bounded
    // walk) is for the canvas anatomy frame, not the prose list, and keeping
    // this filtered is also what keeps content_hash stable (see above).
    ...spec.anatomy.filter((a) => a.depth === 0).map((a, i) => `${i + 1}. ${a.name}${a.nested ? ' (component)' : ''}`), '',
    '## Configuration', '',
    ...renderConfiguration(spec), '',
    '## Variants', '',
    ...renderVariants(spec), '',
    '## States', '', ...spec.states.map((s) => `- ${s}`), '',
    '## Tokens used', '',
    ...renderTokensSection(spec),
    '## Code', '', '_Import path, prop mapping, and usage example to be filled in._', '',
    '## Accessibility', '', p?.accessibility ?? '_To be written._', '',
    "## Do's & Don'ts", '',
    ...(p ? [...p.dos.map((d) => `- ✅ ${d}`), ...p.donts.map((d) => `- ❌ ${d}`)] : ['_To be written._']), '',
    '## Related atoms', '',
    ...(spec.related.length ? spec.related.map((r) => `- [${r}](./${slug(r)}.md)`) : ['None.']), '',
  ];
  if (spec.gaps.length) {
    lines.push('## Extraction gaps', '', ...spec.gaps.map((g) => `- **${g.part}**: ${g.issue}`), '');
  }
  return serializeFrontmatter(fm, lines.join('\n'));
}

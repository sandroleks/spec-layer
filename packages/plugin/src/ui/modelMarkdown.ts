/**
 * modelMarkdown.ts — serialize a DocFrameModel to markdown.
 *
 * The Download action and the Create-frame action must produce the same doc.
 * The frame is built from a DocFrameModel (see docModel.ts) and rendered
 * straight to Figma nodes; this module renders that SAME model to markdown so
 * the downloaded .md matches the frame section-for-section (AI prose, the
 * chosen sections, the chosen variants), rather than the legacy renderSpec
 * preview which omitted whole sections and never carried prose.
 *
 * Visual-only richness (anatomy diagram, measure mini-diagrams, screenshots)
 * has no markdown equivalent, so those blocks render their textual content
 * (the parts list, the token/value table) — the same information, minus the
 * picture.
 *
 * Pure and DOM-free so it can be unit-tested in Node/Vitest.
 */

import { groupSections } from './docModel';
import type {
  DocFrameModel, SectionBlock, Bullet, TextRun, AnatomyPartBlock, VariantTokenBlock,
} from './docModel';

/** Reconstruct markdown from parsed runs, re-wrapping bold runs in **…**. */
function runsToMarkdown(runs: TextRun[], fallback: string): string {
  if (!runs.length) return fallback;
  return runs.map((r) => (r.bold ? `**${r.text}**` : r.text)).join('');
}

function bulletLine(b: Bullet): string {
  return `- ${runsToMarkdown(b.runs, b.text)}`;
}

/** Escape the characters that would break a markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function table(columns: string[], rows: string[][]): string[] {
  const header = `| ${columns.map(cell).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
  return [header, sep, ...body];
}

/** A matrix cell holds a variant nodeId when the combination exists, else null.
 *  Markdown can't link to the node, so presence becomes a check mark. */
function matrixMark(nodeId: string | null): string {
  return nodeId ? '✓' : '';
}

function anatomyLine(p: AnatomyPartBlock): string {
  const bits: string[] = [`${p.n}. **${p.name}**`];
  if (p.nested && p.component) {
    bits.push(`(component: ${p.component})`);
  } else if (p.type) {
    bits.push(`(${p.type.toLowerCase()})`);
  }
  let line = bits.join(' ');
  if (p.description) line += ` — ${p.description}`;
  if (p.tokens.length) line += ` · tokens: ${p.tokens.join(', ')}`;
  return line;
}

function variantCard(v: VariantTokenBlock, columns: string[]): string[] {
  const out: string[] = [];
  out.push(`#### ${v.name}${v.isDefault ? ' (default)' : ''}`, '');
  if (v.props.length) {
    out.push(v.props.map((p) => `${p.name}=${p.value}`).join(', '), '');
  }
  if (v.rows.length) {
    const rows = v.rows.map((r) => [
      r.part,
      r.property,
      r.unbound ? `${r.token} (hardcoded)` : r.token,
    ]);
    out.push(...table(columns, rows), '');
  }
  if (!v.isDefault && v.sameAsDefault > 0) {
    const s = v.sameAsDefault === 1 ? 'property' : 'properties';
    out.push(`_${v.sameAsDefault} ${s} identical to the default variant._`, '');
  }
  return out;
}

/** Render one section block to markdown lines (without its heading). */
function blockBody(block: SectionBlock): string[] {
  switch (block.kind) {
    case 'prose':
      return [block.text];
    case 'bullets':
      return block.items.map(bulletLine);
    case 'table':
      return table(block.columns, block.rows);
    case 'variantTokens':
      return block.variants.flatMap((v) => variantCard(v, block.columns));
    case 'anatomy': {
      const out: string[] = [];
      if (block.summary) out.push(block.summary, '');
      if (block.parts.length) out.push(...block.parts.map(anatomyLine));
      else out.push('_None._');
      return out;
    }
    case 'measure': {
      const rows = Object.entries(block.tokens).map(([k, v]) => [k, v]);
      if (!rows.length) return ['_None._'];
      return table(['Measurement', 'Value'], rows);
    }
    case 'statesMatrix': {
      const out: string[] = [];
      if (block.capped) out.push('_Some rows were capped; showing a representative subset._', '');
      const columns = [block.axisName, ...block.states];
      const rows = block.rows.map((r) => [r.label, ...r.cells.map(matrixMark)]);
      out.push(...table(columns, rows));
      return out;
    }
    case 'variantsMatrix': {
      const out: string[] = [];
      if (block.summary) out.push(block.summary, '');
      const singleAxis = block.columns.length === 1 && block.columns[0] === '';
      if (singleAxis) {
        // One axis: the columns carry no labels, so a checkbox grid is noise.
        // List the present variants instead.
        for (const r of block.rows) {
          if (r.cells.some(Boolean)) out.push(`- ${r.label}`);
        }
      } else {
        const columns = ['Variant', ...block.columns];
        const rows = block.rows.map((r) => [r.label, ...r.cells.map(matrixMark)]);
        out.push(...table(columns, rows));
      }
      if (block.capped) { out.push('', '_Some variants were capped; showing a representative subset._'); }
      if (block.note) { out.push('', block.note); }
      return out;
    }
    default: {
      // Exhaustiveness guard: a new SectionBlock kind must be handled above.
      const _never: never = block;
      return [_never];
    }
  }
}

export function modelToMarkdown(model: DocFrameModel): string {
  const lines: string[] = [`# ${model.componentName}`, ''];

  for (const group of groupSections(model.sections)) {
    lines.push(`## ${group.label}`, '');
    for (const block of group.sections) {
      lines.push(`### ${block.heading}`, '');
      lines.push(...blockBody(block), '');
    }
  }

  // Collapse any run of blank lines to a single one, and end with one newline.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

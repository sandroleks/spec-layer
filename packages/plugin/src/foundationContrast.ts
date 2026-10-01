/// <reference types="@figma/plugin-typings" />
/**
 * The contrast block a foundation frame draws under its colours.
 * `contrastBlockModel` decides WHAT to draw with no Figma API; `matrixFrame`
 * draws one matrix. Primitives come from frameKit, not foundationFrame, which
 * imports this module.
 */
import type { ColorContrastReport, ContrastMatrix } from '@spec-layer/extractor';
import { BACKGROUND_WORDS, FOREGROUND_WORDS, CONTRAST_AXIS_CAP } from '@spec-layer/extractor';
import { palette, solidFill, makeText, vstack, hstack, radius, hex } from './frameKit';

// ---------------------------------------------------------------------------
// The pure model
// ---------------------------------------------------------------------------

export type ContrastBlockModel =
  | { kind: 'none'; reason: string }
  | { kind: 'matrix'; matrices: ContrastMatrix[]; note: string | null };

/** "a, b or c". Sentence case and no dash, per docs/plugin-voice-and-copy.md. */
function orList(words: Iterable<string>): string {
  const all = [...words];
  if (all.length < 2) return all.join('');
  return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`;
}

/** How a name earns a place on the grid, read from the classifier's own
 *  vocabulary: this is the only place a user learns it, so it must never be a
 *  hand-written copy that can go stale. */
function pairingHint(): string {
  return `Names containing ${orList(FOREGROUND_WORDS)} pair with names containing `
    + `${orList(BACKGROUND_WORDS)}.`;
}

/** "1 color" or "4 colors", in US spelling like the frame's "Colors" heading. */
function colourCount(n: number): string {
  return n === 1 ? '1 color' : `${n} colors`;
}

/**
 * What the contrast block draws for one collection. A blank grid reads as "the
 * colours are fine", so the empty case carries its reason, and the cap's
 * `omitted` count is named: a bounded grid shown as complete is worse than none.
 */
export function contrastBlockModel(
  report: ColorContrastReport,
  collectionName: string,
): ContrastBlockModel {
  // Filtered: `report` covers the whole foundation, a frame one collection.
  const matrices = report.matrices.filter((m) => m.collection === collectionName);
  // A floor only: the caller skips styles units, which have no collection name.
  const who = collectionName || 'This collection';

  if (matrices.length === 0) {
    // report.unclassified and report.omitted are foundation-wide, so printing
    // one here would claim THIS collection dropped colours it may never have
    // held. State what is missing and how to fix it, and no number.
    return {
      kind: 'none',
      reason: `${who} has no color pairs to measure. Contrast needs two colors in the `
        + 'same collection whose names say which one is drawn on the other. '
        + pairingHint(),
    };
  }

  // Per-collection counts from the matrix. Every mode carries the same pair,
  // so the first matrix speaks for all.
  const { unclassified, omitted } = matrices[0];
  const sentences: string[] = [];
  if (omitted > 0) {
    // The extractor's own cap, so the number printed is the one enforced.
    sentences.push(`The grid shows at most ${CONTRAST_AXIS_CAP} rows and ${CONTRAST_AXIS_CAP} `
      + `columns, so it leaves out ${colourCount(omitted)}.`);
  }
  if (unclassified > 0) {
    // A colour missing from a drawn grid is invisible too, so name it like `omitted`.
    const lead = omitted > 0 ? 'It also leaves out' : 'The grid leaves out';
    sentences.push(`${lead} ${colourCount(unclassified)}, because a name has to say which `
      + `side of a pair the color sits on. ${pairingHint()}`);
  }
  return { kind: 'matrix', matrices, note: sentences.length > 0 ? sentences.join(' ') : null };
}

/**
 * How each bar reads in a cell. 3:1 is the SC 1.4.3 bar for large text AND the
 * SC 1.4.11 bar for UI components, so the label names both; "AA-LARGE" would
 * understate it. "AA" stays short: it is the verdict for body text.
 */
const BAR_LABELS: Record<string, string> = {
  'aa-large': 'AA large text and UI',
  aa: 'AA',
  aaa: 'AAA',
};

/** A cell reads as its ratio plus the strongest bar it clears. */
export function cellLabel(cell: { ratio: number; clears: readonly string[] } | null): string {
  // Unmeasured is a different fact from measured and failed.
  if (!cell) return 'Not measured';
  const strongest = cell.clears[cell.clears.length - 1];
  // The ratio prints as the extractor floored it. Uppercasing an unmapped bar
  // is only a floor: every ContrastBar is named above.
  if (!strongest) return `${cell.ratio}:1 fails`;
  return `${cell.ratio}:1 ${BAR_LABELS[strongest] ?? strongest.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// The node builder
// ---------------------------------------------------------------------------

// CELL_W holds "2.23:1 fails" on one line at 11px, and keeps a 24 column grid
// under 2400px, which the card widens to hold.
const CELL_W = 92;
const LABEL_W = 190;
const CELL_PAD_X = 8;
const CELL_PAD_Y = 6;

/** Failing ink and tint, fixed rather than themed: a failure must read as one
 *  whatever the brand theme recolours. */
const FAIL_INK = hex('#b42318');
const FAIL_TINT = hex('#fef3f2');

/** Total width of a grid with this many background columns. */
export function gridWidth(backgroundCount: number): number {
  return LABEL_W + backgroundCount * CELL_W;
}

/** Width the widest grid in a block needs. The card is sized before its
 *  contents are built, and it clips. */
export function contrastBlockWidth(matrices: readonly ContrastMatrix[]): number {
  let widest = 0;
  for (const m of matrices) widest = Math.max(widest, gridWidth(m.backgrounds.length));
  return widest;
}

/** Last path segment, so a heading stays readable in a 92px column. */
function leaf(token: string): string {
  const parts = token.split('/');
  return parts[parts.length - 1] || token;
}

/** A cell's tone. `blank` and `fail` differ in ink AND fill, so "not measured"
 *  never reads as "fails". */
type CellTone = 'head' | 'pass' | 'fail' | 'blank';

function toneOf(cell: { clears: readonly string[] } | null): CellTone {
  if (!cell) return 'blank';
  return cell.clears.length === 0 ? 'fail' : 'pass';
}

function toneInk(tone: CellTone): RGB {
  if (tone === 'fail') return FAIL_INK;
  if (tone === 'blank') return palette.muted;
  if (tone === 'head') return palette.label;
  return palette.body;
}

function gridCell(label: string, width: number, tone: CellTone): FrameNode {
  const cell = vstack(0);
  cell.paddingLeft = CELL_PAD_X;
  cell.paddingRight = CELL_PAD_X;
  cell.paddingTop = CELL_PAD_Y;
  cell.paddingBottom = CELL_PAD_Y;
  // FIXED before the text is appended, so the text can FILL it and wrap.
  cell.layoutSizingHorizontal = 'FIXED';
  cell.resize(width, cell.height);
  cell.layoutSizingVertical = 'HUG';
  if (tone === 'head') cell.fills = solidFill(palette.tableHeadBg);
  else if (tone === 'fail') cell.fills = solidFill(FAIL_TINT);
  const text = makeText(label, tone === 'pass' || tone === 'blank' ? 'Regular' : 'Medium',
    11, toneInk(tone));
  cell.appendChild(text);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  return cell;
}

function gridRow(cells: FrameNode[], width: number): FrameNode {
  const row = hstack(0);
  row.layoutSizingHorizontal = 'FIXED';
  row.resize(width, row.height);
  row.layoutSizingVertical = 'HUG';
  // Top-aligned, so wrapped cells line up with one-line cells.
  row.counterAxisAlignItems = 'MIN';
  for (const c of cells) row.appendChild(c);
  return row;
}

/** One matrix: backgrounds across the top, foregrounds down the side. */
export function matrixFrame(m: ContrastMatrix): FrameNode {
  const width = gridWidth(m.backgrounds.length);
  const wrap = vstack(0);
  wrap.name = `Contrast · ${m.collection} · ${m.mode}`;
  wrap.layoutSizingHorizontal = 'FIXED';
  wrap.resize(width, wrap.height);
  wrap.layoutSizingVertical = 'HUG';
  wrap.strokes = solidFill(palette.border);
  wrap.strokeWeight = 1;
  wrap.cornerRadius = radius(8);
  wrap.clipsContent = true;

  // The corner cell stays empty; the headings name both axes.
  wrap.appendChild(gridRow([
    gridCell('', LABEL_W, 'head'),
    ...m.backgrounds.map((bg) => gridCell(leaf(bg), CELL_W, 'head')),
  ], width));

  m.foregrounds.forEach((fg, i) => {
    const row = m.cells[i] ?? [];
    wrap.appendChild(gridRow([
      gridCell(leaf(fg), LABEL_W, 'head'),
      // Indexed by background, so a short row shows unmeasured cells.
      ...m.backgrounds.map((_, j) => {
        const cell = row[j] ?? null;
        return gridCell(cellLabel(cell), CELL_W, toneOf(cell));
      }),
    ], width));
  });
  return wrap;
}

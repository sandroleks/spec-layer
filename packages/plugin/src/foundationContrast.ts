/// <reference types="@figma/plugin-typings" />
/**
 * foundationContrast.ts: the contrast block a foundation frame draws under its
 * colours.
 *
 * Split in two on purpose. `contrastBlockModel` decides WHAT to draw and says
 * why in plain words, touching no Figma API, so every one of those decisions is
 * unit-testable. `matrixFrame` turns one matrix into frames, and is pinned
 * against the same fake Figma stub the rest of the frame suites use.
 *
 * Layout primitives come from frameKit rather than from foundationFrame, even
 * where foundationFrame has a private helper doing the same three lines:
 * foundationFrame imports this module, so importing back would make the pair a
 * cycle for the sake of those three lines.
 */
import type { ColorContrastReport, ContrastMatrix } from '@spec-layer/extractor';
import { BACKGROUND_WORDS, FOREGROUND_WORDS } from '@spec-layer/extractor';
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

/**
 * How a name earns a place on the grid.
 *
 * Read out of the classifier's own exported vocabulary rather than restated
 * here, because a hand-written second copy is exactly what went stale the first
 * time: it named five of the seven foreground words, so a reader who renamed a
 * token to `foreground` after reading it would have concluded that the word was
 * unsupported. This string is the only place a user is told how to make their
 * names work, so it has to be the truth about the classifier.
 */
function pairingHint(): string {
  return `Names containing ${orList(FOREGROUND_WORDS)} pair with names containing `
    + `${orList(BACKGROUND_WORDS)}.`;
}

/** "1 colour" or "4 colours". A count of one is not rare here. */
function colourCount(n: number): string {
  return n === 1 ? '1 colour' : `${n} colours`;
}

/**
 * What the contrast block should draw for one collection.
 *
 * An empty grid and "no matrix could be built" look IDENTICAL on a frame and
 * mean opposite things: a reader who sees a blank grid concludes the colours are
 * fine. So the empty case carries its reason instead, and the cap's `omitted`
 * count is named rather than hidden, because a bounded grid presented as a
 * complete one is worse than no grid at all.
 */
export function contrastBlockModel(
  report: ColorContrastReport,
  collectionName: string,
): ContrastBlockModel {
  // Filtered, never taken whole: `report` covers the whole foundation while a
  // frame draws one collection, so an unfiltered list would put the Primitives
  // grid on the Semantic frame.
  const matrices = report.matrices.filter((m) => m.collection === collectionName);
  // The text-styles unit has no collection name. The caller skips this block for
  // it, so this is a floor that keeps the sentence from opening on a space.
  const who = collectionName || 'This collection';

  if (matrices.length === 0) {
    // No matrix means no per-collection carrier for the counts either:
    // report.unclassified and report.omitted are foundation-wide totals, and
    // printing one here would tell the reader that THIS collection dropped
    // colours it may never have held. Twelve unclassified palette colours in
    // Primitives say nothing about Semantic. So the reason states what is
    // missing and how to fix it, and asserts no number it cannot source.
    return {
      kind: 'none',
      reason: `${who} has no colour pairs to measure. Contrast needs two colours in the `
        + 'same collection whose names say which one is drawn on the other. '
        + pairingHint(),
    };
  }

  // Per-collection counts, read off the matrix and not off the report. Every
  // mode of one collection carries the same pair of numbers by construction:
  // they are counted before the mode loop opens, so the first matrix speaks for
  // all of them.
  const { unclassified, omitted } = matrices[0];
  const sentences: string[] = [];
  if (omitted > 0) {
    sentences.push(`The grid is capped, so it leaves out ${colourCount(omitted)}.`);
  }
  if (unclassified > 0) {
    // Carried here too, not only in the no-matrix case. A colour missing from a
    // drawn grid is invisible to the reader, which is the same problem `omitted`
    // has, so it gets the same treatment.
    const lead = omitted > 0 ? 'It also leaves out' : 'The grid leaves out';
    sentences.push(`${lead} ${colourCount(unclassified)}, because a name has to say which `
      + `side of a pair the colour sits on. ${pairingHint()}`);
  }
  return { kind: 'matrix', matrices, note: sentences.length > 0 ? sentences.join(' ') : null };
}

/**
 * How each bar reads in a cell.
 *
 * Not `bar.toUpperCase()`, which is where this started. `aa-large` would render
 * as "AA-LARGE", which shouts (the voice guide is sentence case) and, worse,
 * understates the bar: 3:1 is the SC 1.4.3 bar for large text AND the SC 1.4.11
 * bar for user interface components and graphical objects, so a bare "AA-LARGE"
 * beside an icon or border colour reads as "only large text passes here". The
 * label names both halves instead, and still fits a 92px column on two lines.
 *
 * "AA" stays short even though 4.5:1 is also AAA for large text: the cell has
 * room for one verdict, and AA is the one that applies to body text.
 */
const BAR_LABELS: Record<string, string> = {
  'aa-large': 'AA large text and UI',
  aa: 'AA',
  aaa: 'AAA',
};

/** A cell reads as its ratio plus the strongest bar it clears. */
export function cellLabel(cell: { ratio: number; clears: readonly string[] } | null): string {
  // Not blank and not "fails": a pair that could not be measured is a different
  // fact from a pair that was measured and failed.
  if (!cell) return 'not measured';
  const strongest = cell.clears[cell.clears.length - 1];
  // The ratio prints exactly as the extractor floored it, so 21 stays "21"
  // rather than becoming "21.00". Uppercasing an unmapped bar is a floor, not a
  // path: every ContrastBar is named above.
  if (!strongest) return `${cell.ratio}:1 fails`;
  return `${cell.ratio}:1 ${BAR_LABELS[strongest] ?? strongest.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// The node builder
// ---------------------------------------------------------------------------

// Column metrics. CELL_W holds "2.23:1 fails" on one line at 11px and keeps a
// grid at the extractor's 24 column cap under 2400px, which the card is widened
// to hold rather than clipping.
const CELL_W = 92;
const LABEL_W = 190;
const CELL_PAD_X = 8;
const CELL_PAD_Y = 6;

/**
 * Failing ink and its tint. Local constants rather than palette entries, the
 * same call measureSection.ts makes for its overlay colours: a failure has to
 * read as a failure whatever the user's brand theme recolours, and this is the
 * one thing on a foundation frame that is a verdict rather than content.
 */
const FAIL_INK = hex('#b42318');
const FAIL_TINT = hex('#fef3f2');

/** Total width of a grid with this many background columns. */
export function gridWidth(backgroundCount: number): number {
  return LABEL_W + backgroundCount * CELL_W;
}

/**
 * Width the widest grid in a block needs.
 *
 * Exported because the card is sized before its contents are built and the card
 * clips: a 24 column grid is wider than anything the table or the swatch list
 * asks for, so the width has to know about it.
 */
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

/**
 * A cell's tone. `blank` and `fail` are deliberately different in ink AND fill,
 * not only in wording: side by side on a frame, "not measured" and "fails" must
 * not read as the same verdict.
 */
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
  // FIXED width before the text is appended, so the text can FILL it: a token
  // path or a two word verdict wraps inside its column instead of drawing over
  // the next one.
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
  // First lines align across the row. A cell that wraps to two lines beside
  // one-line cells reads as a table only when their tops agree.
  row.counterAxisAlignItems = 'MIN';
  for (const c of cells) row.appendChild(c);
  return row;
}

/** One matrix: backgrounds across the top, foregrounds down the side. */
export function matrixFrame(m: ContrastMatrix): FrameNode {
  const width = gridWidth(m.backgrounds.length);
  const wrap = vstack(0);
  wrap.name = `Contrast ${m.collection} ${m.mode}`;
  wrap.layoutSizingHorizontal = 'FIXED';
  wrap.resize(width, wrap.height);
  wrap.layoutSizingVertical = 'HUG';
  wrap.strokes = solidFill(palette.border);
  wrap.strokeWeight = 1;
  wrap.cornerRadius = radius(8);
  wrap.clipsContent = true;

  // The corner cell is empty: the row and column headings name both axes
  // already, and a word there would only compete with them.
  wrap.appendChild(gridRow([
    gridCell('', LABEL_W, 'head'),
    ...m.backgrounds.map((bg) => gridCell(leaf(bg), CELL_W, 'head')),
  ], width));

  m.foregrounds.forEach((fg, i) => {
    const row = m.cells[i] ?? [];
    wrap.appendChild(gridRow([
      gridCell(leaf(fg), LABEL_W, 'head'),
      // Indexed by background rather than walked, so a short row reads as
      // unmeasured cells instead of a grid one column narrower than its heading.
      ...m.backgrounds.map((_, j) => {
        const cell = row[j] ?? null;
        return gridCell(cellLabel(cell), CELL_W, toneOf(cell));
      }),
    ], width));
  });
  return wrap;
}

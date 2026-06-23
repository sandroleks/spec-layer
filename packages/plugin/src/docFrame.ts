/// <reference types="@figma/plugin-typings" />
import { parseRuns } from './ui/docModel';
import type {
  Bullet,
  DocFrameModel,
  SectionBlock,
  TextRun,
} from './ui/docModel';

// ---------------------------------------------------------------------------
// Palette (hardcoded neutral scale — see plan Task 5)
// ---------------------------------------------------------------------------
const COLOR_TEXT: RGB = hex('#1e1e1e'); // primary dark gray
const COLOR_SECONDARY: RGB = hex('#6b6b6b'); // secondary / muted
const COLOR_BG: RGB = hex('#ffffff'); // near-white frame fill
const COLOR_BORDER: RGB = hex('#e6e6e6'); // light divider

const FONT_FAMILY = 'Inter';
type FontStyle = 'Regular' | 'Medium' | 'Bold';

function font(style: FontStyle): FontName {
  return { family: FONT_FAMILY, style };
}

/** Parse a #rrggbb string into a normalized RGB object. */
function hex(value: string): RGB {
  const h = value.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function solidFill(color: RGB): Paint[] {
  return [{ type: 'SOLID', color }];
}

// ---------------------------------------------------------------------------
// Text construction
// ---------------------------------------------------------------------------

/**
 * Create a TextNode using one of the pre-loaded Inter faces.
 * Fonts MUST already be loaded (see buildDocFrame) before this is called.
 */
function makeText(
  chars: string,
  style: FontStyle,
  size: number,
  color: RGB = COLOR_TEXT,
): TextNode {
  const node = figma.createText();
  node.fontName = font(style);
  node.fontSize = size;
  node.characters = chars;
  node.fills = solidFill(color);
  return node;
}

/**
 * Apply the Inter Bold face over the character ranges that correspond to bold
 * runs. `prefix` accounts for any leading characters (e.g. a "• " bullet
 * marker) prepended ahead of the runs in the node's `characters`.
 */
function applyBoldRuns(node: TextNode, runs: TextRun[], prefix = 0): void {
  let cursor = prefix;
  for (const run of runs) {
    const start = cursor;
    const end = cursor + run.text.length;
    if (run.bold && run.text.length > 0) {
      node.setRangeFontName(start, end, font('Bold'));
    }
    cursor = end;
  }
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A vertical auto-layout frame that hugs its contents. */
function vstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

/** A horizontal auto-layout frame that hugs its height. */
function hstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'HORIZONTAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

// ---------------------------------------------------------------------------
// Section bodies
// ---------------------------------------------------------------------------

/** Render a single bullet line ("• " + styled runs) into a text node. */
function makeBulletText(bullet: Bullet): TextNode {
  const prefix = '• ';
  const node = makeText(prefix + bullet.text, 'Regular', 13);
  applyBoldRuns(node, bullet.runs, prefix.length);
  return node;
}

/** Body for a `prose` block: split on newlines into paragraph / bullet lines. */
function buildProse(text: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const content = bulletMatch[1];
      const runs = parseRuns(content);
      const plain = runs.map((r) => r.text).join('');
      out.push(makeBulletText({ runs, text: plain }));
    } else {
      const runs = parseRuns(line);
      const plain = runs.map((r) => r.text).join('');
      const node = makeText(plain, 'Regular', 13);
      applyBoldRuns(node, runs, 0);
      out.push(node);
    }
  }
  if (out.length === 0) {
    out.push(makeText('', 'Regular', 13));
  }
  return out;
}

/** Body for a `bullets` block. */
function buildBullets(items: Bullet[]): SceneNode[] {
  return items.map((b) => makeBulletText(b));
}

/** Body for a `table` block: header row + data rows with bottom borders. */
function buildTable(columns: string[], rows: string[][]): FrameNode {
  const table = vstack(0);
  table.layoutSizingHorizontal = 'FILL';

  const colCount = Math.max(columns.length, 1);

  const makeRow = (cells: string[], style: FontStyle): void => {
    const row = hstack(12);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.paddingTop = 6;
    row.paddingBottom = 6;
    // Thin bottom border for legibility.
    row.strokes = solidFill(COLOR_BORDER);
    row.strokeBottomWeight = 1;
    row.strokeTopWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;

    for (let i = 0; i < colCount; i++) {
      const text = cells[i] ?? '';
      const color = style === 'Medium' ? COLOR_TEXT : COLOR_SECONDARY;
      const cell = makeText(text, style, 12, color);
      row.appendChild(cell);
      // Equal-width columns that line up across rows.
      cell.layoutSizingHorizontal = 'FILL';
      cell.textAutoResize = 'HEIGHT';
    }
  };

  makeRow(columns, 'Medium');
  for (const r of rows) makeRow(r, 'Regular');

  return table;
}

/** Build one section: heading + body, grouped in a vertical auto-layout. */
function buildSection(section: SectionBlock): FrameNode {
  const group = vstack(8);
  group.name = section.heading;

  const heading = makeText(section.heading, 'Medium', 14);
  group.appendChild(heading);
  heading.layoutSizingHorizontal = 'FILL';

  if (section.kind === 'prose') {
    for (const node of buildProse(section.text)) {
      group.appendChild(node);
      (node as TextNode).layoutSizingHorizontal = 'FILL';
    }
  } else if (section.kind === 'bullets') {
    for (const node of buildBullets(section.items)) {
      group.appendChild(node);
      (node as TextNode).layoutSizingHorizontal = 'FILL';
    }
  } else {
    const table = buildTable(section.columns, section.rows);
    group.appendChild(table);
    table.layoutSizingHorizontal = 'FILL';
  }

  return group;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build an on-canvas "Guidelines" frame from a DocFrameModel.
 * Returns the frame; the caller positions it and appends it to the page.
 */
export async function buildDocFrame(model: DocFrameModel): Promise<FrameNode> {
  // Load fonts FIRST — bold runs need the Bold face before setRangeFontName.
  await Promise.all(
    (['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
      figma.loadFontAsync(font(style)),
    ),
  );

  const frame = figma.createFrame();
  frame.name = model.title;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = 24;
  frame.paddingTop = 32;
  frame.paddingBottom = 32;
  frame.paddingLeft = 32;
  frame.paddingRight = 32;
  frame.fills = solidFill(COLOR_BG);
  frame.cornerRadius = 8;
  frame.resize(520, frame.height);

  const title = makeText(model.title, 'Medium', 20);
  frame.appendChild(title);
  title.layoutSizingHorizontal = 'FILL';

  for (const section of model.sections) {
    const group = buildSection(section);
    frame.appendChild(group);
    group.layoutSizingHorizontal = 'FILL';
  }

  return frame;
}

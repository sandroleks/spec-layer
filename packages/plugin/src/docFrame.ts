/// <reference types="@figma/plugin-typings" />
/**
 * The component document: three frames, in reading order. Owns the frame
 * chrome and routes each doc-model block to the module that draws it; only the
 * per-variant token card lives here. Runs on the main thread: ECMAScript
 * built-ins and the `figma` API only.
 */
import { parseRuns, groupSections } from './ui/docModel';
import type {
  DocFrameModel,
  DocGroup,
  SectionBlock,
  VariantRow,
} from './ui/docModel';
import type { resolveTheme } from './brandColors';
import type { PillState } from './publishPill';
import {
  palette, solidFill, vstack, hstack, makeText, buildSlot, font, SLOT_PAD,
  headingFont, radius, applyThemeToKit, nodeById,
} from './frameKit';
import { buildBrandHeader, HEADER_PAD_X } from './brandHeader';
import { buildMeasureSection } from './measureSection';
import { buildMatrixSection } from './statesSection';
import { resolveTokenDisplay, resetTokenResolveCaches, type TokenDisplay } from './tokenResolve';
import {
  tagSlot, applyRuns, accentRule, makeBulletRow, buildProse, makeCell, buildTable,
} from './docText';
import { buildAnatomyDiagram, buildAnatomyLegend, scaleNote } from './anatomySection';
import {
  buildTwoColumns, buildGuidelinePairs, buildKeyboardTable,
  buildPropertiesTable, columnParagraph, buildPlaceholderBlock,
} from './docBlocks';
import { SLOT_PART_KEY, type ProseSlot } from './canvasProse';

// ---------------------------------------------------------------------------
// Design tokens for the generated doc frame
// ---------------------------------------------------------------------------

// Shared with the header, so the band and the content column stay in line.
const PAD_X = HEADER_PAD_X;
const VAR_LEFT_W = 240; // per-variant card: left pane (preview + properties)
const VAR_PANE_PAD = 20; // per-variant card: pane padding
const TOKEN_KEY_COL_W = 120; // token tables: fixed width of the non-Token columns
const CARD_PAD = 24; // diagram card padding (anatomySection's own ANATOMY_PAD)
const CALLOUT_ZONE = 60; // room beside a diagram for its pins and leaders

// Long token chips and wide components widen the frame per build (see
// fitFrameWidth), so these are `let`.
const CARD_WIDTH_MIN = 880;
const CARD_WIDTH_MAX = 1440; // safety cap so a pathological token can't run away
let CARD_WIDTH = CARD_WIDTH_MIN;
let CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

// ---------------------------------------------------------------------------
// Prose: text tagged with a slot is the designer's, and an Update reads it
// back instead of regenerating it (see canvasProse.ts).
// ---------------------------------------------------------------------------

/** Render markdown into a tagged slot container spanning the content column.
 *  The first paragraph of an Overview is the lede and sets one step larger. */
function buildProseSlot(text: string, slot: ProseSlot | null, spacing: number, lede = false): FrameNode {
  const holder = vstack(spacing);
  if (slot) tagSlot(holder, slot);
  holder.resize(CONTENT_WIDTH, 1);
  holder.primaryAxisSizingMode = 'AUTO';
  buildProse(text).forEach((node, i) => {
    holder.appendChild(node);
    (node as TextNode).layoutSizingHorizontal = 'FILL';
    if (lede && i === 0 && node.type === 'TEXT') (node as TextNode).fontSize = 17;
  });
  return holder;
}

/** One paragraph with the slot tag on the TEXT node itself: a single-string
 *  slot is read straight off the tagged node, so a tagged container reads empty. */
function buildTaggedParagraph(text: string, slot: ProseSlot, size = 15): FrameNode {
  const box = columnParagraph(text, CONTENT_WIDTH, size);
  const node = box.children[0];
  if (node) tagSlot(node, slot);
  return box;
}

// ---------------------------------------------------------------------------
// Per-variant tokens: a live instance slot beside a token table
// ---------------------------------------------------------------------------

function colorChip(color: RGB): FrameNode {
  const chip = figma.createFrame();
  chip.resize(12, 12);
  chip.cornerRadius = radius(3);
  chip.fills = solidFill(color);
  chip.strokes = solidFill(palette.border);
  chip.strokeWeight = 1;
  return chip;
}

/** The Token cell: a chip with an optional swatch and the token name. An
 *  `unbound` raw value gets a dashed muted outline and no colour lookup. A
 *  bound token without a swatch shows its resolved value as a muted suffix. */
function makeTokenCell(token: string, unbound: boolean, display: TokenDisplay | null): FrameNode {
  const cell = vstack(0);
  cell.paddingTop = 10;
  cell.paddingBottom = 10;
  cell.paddingLeft = 16;
  cell.paddingRight = 16;

  const chip = figma.createFrame();
  chip.name = 'token';
  chip.layoutMode = 'HORIZONTAL';
  chip.primaryAxisSizingMode = 'AUTO';
  chip.counterAxisSizingMode = 'AUTO';
  chip.counterAxisAlignItems = 'CENTER';
  chip.itemSpacing = 6;
  chip.paddingTop = 3;
  chip.paddingBottom = 3;
  chip.paddingLeft = 8;
  chip.paddingRight = 8;
  chip.cornerRadius = radius(6);

  if (unbound) {
    chip.fills = [];
    chip.strokes = solidFill(palette.muted);
    chip.strokeWeight = 1;
    chip.dashPattern = [3, 2];
  } else {
    chip.fills = solidFill(palette.chipBg);
    if (display?.color) chip.appendChild(colorChip(display.color));
  }

  // A single-line pill; fitFrameWidth sizes the Token column so it never clips.
  const text = makeText(token, 'Medium', 13, unbound ? palette.muted : palette.heading, 140);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(text);

  if (!unbound && display?.suffix) {
    const sfx = makeText(display.suffix, 'Regular', 11, palette.muted, 140);
    sfx.textAutoResize = 'WIDTH_AND_HEIGHT';
    chip.appendChild(sfx);
  }

  cell.appendChild(chip);
  return cell;
}

/** One variant's token table. Rows arrive sorted by part; the Part column is
 *  dropped for a bold band per part. The Token column FILLs, the short key
 *  columns stay fixed. */
async function buildTokenTable(
  columns: string[],
  rows: VariantRow[],
  bordered = true,
): Promise<FrameNode> {
  // Column 0 is the Part group key; the rest are the rendered data columns.
  const dataColumns = columns.slice(1);
  const dataCount = Math.max(dataColumns.length, 1);
  const sizeCol = (cell: FrameNode, i: number): void => {
    if (i === dataCount - 1) {
      cell.layoutSizingHorizontal = 'FILL';
    } else {
      cell.layoutSizingHorizontal = 'FIXED';
      cell.resize(TOKEN_KEY_COL_W, cell.height);
    }
  };

  const table = vstack(0);
  if (bordered) {
    table.cornerRadius = radius(8);
    table.clipsContent = true;
    table.strokes = solidFill(palette.border);
    table.strokeWeight = 1;
  }

  const head = hstack(0);
  head.fills = solidFill(palette.tableHeadBg);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.counterAxisAlignItems = 'MIN';
  for (let i = 0; i < dataCount; i++) {
    const cell = makeCell((dataColumns[i] ?? '').toUpperCase(), 'Medium', 11, palette.muted, 5);
    head.appendChild(cell);
    sizeCol(cell, i);
  }

  // No "None" row: an empty card's tokens all match the default, which the
  // caller's note says, and "None" would read as binding no tokens.
  if (rows.length === 0) return table;

  // Every distinct bound token resolved at once, before any row is drawn.
  const bound = [...new Set(rows.filter((r) => !r.unbound && r.token).map((r) => r.token))];
  const displays = new Map(await Promise.all(bound.map(async (token) =>
    [token, await resolveTokenDisplay(token)] as const)));

  let currentPart: string | null = null;
  for (const r of rows) {
    const part = r.part ?? '';
    const cells = [r.property, r.token];
    // A bold band whenever the part changes; a blank part gets none.
    if (part && part !== currentPart) {
      currentPart = part;
      const groupHead = hstack(0);
      table.appendChild(groupHead);
      groupHead.layoutSizingHorizontal = 'FILL';
      groupHead.counterAxisAlignItems = 'MIN';
      groupHead.fills = solidFill(palette.tableHeadBg);
      groupHead.strokes = solidFill(palette.border);
      groupHead.strokeTopWeight = 1;
      groupHead.strokeBottomWeight = 0;
      groupHead.strokeLeftWeight = 0;
      groupHead.strokeRightWeight = 0;
      const cell = makeCell(part.toUpperCase(), 'Medium', 11, palette.heading, 6);
      cell.paddingTop = 7;
      cell.paddingBottom = 7;
      groupHead.appendChild(cell);
      cell.layoutSizingHorizontal = 'FILL';
    }

    const row = hstack(0);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.counterAxisAlignItems = 'MIN';
    row.strokes = solidFill(palette.divider);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
    // A token that differs from the default variant gets a faint accent tint.
    if (r.diff) row.fills = [{ type: 'SOLID', color: palette.accent, opacity: 0.06 }];
    for (let i = 0; i < dataCount; i++) {
      const value = cells[i] ?? '';
      const isToken = i === dataCount - 1;
      const cell = isToken
        ? makeTokenCell(value, r.unbound, displays.get(value) ?? null)
        : makeCell(value, 'Medium', 13, r.diff ? palette.heading : palette.label);
      row.appendChild(cell);
      sizeCol(cell, i);
    }
  }

  return table;
}

/** The left pane's "Differs from default" list of axis/value rows. */
function buildPropertyList(props: { name: string; value: string }[]): FrameNode {
  const wrap = vstack(8);
  const heading = makeText('Differs from default', 'Medium', 10, palette.muted);
  wrap.appendChild(heading);
  heading.layoutSizingHorizontal = 'FILL';

  const list = vstack(6);
  wrap.appendChild(list);
  list.layoutSizingHorizontal = 'FILL';

  for (const p of props) {
    const row = hstack(8);
    row.counterAxisAlignItems = 'CENTER';
    list.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';

    const key = makeText(p.name, 'Regular', 12, palette.muted, 140);
    row.appendChild(key);
    key.layoutSizingHorizontal = 'FILL';
    key.textAutoResize = 'HEIGHT';

    const value = makeText(p.value, 'Medium', 12, palette.heading, 140);
    row.appendChild(value);
    value.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return wrap;
}

/** A quiet uppercase label in place of a property list. */
function labelBlock(text: string): FrameNode {
  const wrap = vstack(0);
  wrap.appendChild(makeText(text, 'Medium', 10, palette.muted, 130, 6));
  return wrap;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Build one section: teal accent rule + heading + body. */
async function buildSection(section: SectionBlock, includeHidden: boolean): Promise<FrameNode> {
  const group = vstack(16);
  group.name = section.heading;

  const head = vstack(12);
  group.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.appendChild(accentRule());

  const heading = makeText(section.heading, 'Bold', 24, palette.heading, 130);
  heading.fontName = headingFont('Bold'); // heading family (guaranteed loaded)
  head.appendChild(heading);
  heading.layoutSizingHorizontal = 'FILL';

  const bodySpacing = section.kind === 'variantTokens' ? 20 : 10;
  const body = vstack(bodySpacing);
  group.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';
  const fill = (node: SceneNode): void => { body.appendChild(node); (node as FrameNode).layoutSizingHorizontal = 'FILL'; };

  switch (section.kind) {
    case 'prose': {
      // An AI lede is its own tagged paragraph, a SIBLING of the definition
      // slot: readCanvasProse stops at the first tagged node, so a nested one
      // is never read back.
      if (section.lede) body.appendChild(buildTaggedParagraph(section.lede, 'definitionLead', 17));
      // A description is generated-lane (hashed, re-read on Update), so it is
      // NOT tagged; an AI overview is editorial and is.
      const slot = section.source === 'ai' ? 'definition' : null;
      if (section.text) {
        body.appendChild(buildProseSlot(section.text, slot, bodySpacing, section.id === 'definition' && !section.lede));
      }
      break;
    }
    case 'bullets': {
      const list = vstack(bodySpacing);
      if (section.slot) tagSlot(list, section.slot);
      list.resize(CONTENT_WIDTH, 1);
      list.primaryAxisSizingMode = 'AUTO';
      for (const b of section.items) {
        const row = makeBulletRow(b);
        list.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
      }
      body.appendChild(list);
      break;
    }
    case 'twoColumns': fill(buildTwoColumns(section.left, section.right, CONTENT_WIDTH)); break;
    case 'guidelinePairs': fill(buildGuidelinePairs(section.pairs, CONTENT_WIDTH)); break;
    case 'keyboardTable': fill(buildKeyboardTable(section.rows, CONTENT_WIDTH)); break;
    case 'placeholder': fill(buildPlaceholderBlock(section.shape, CONTENT_WIDTH)); break;
    case 'propertiesTable': fill(buildPropertiesTable(section.rows, section.hasDescriptions, CONTENT_WIDTH)); break;
    case 'table': fill(buildTable(section.columns, section.rows, CONTENT_WIDTH)); break;
    case 'anatomy': {
      if (section.summary) body.appendChild(buildTaggedParagraph(section.summary, 'anatomySummary'));
      const diagram = await buildAnatomyDiagram(section.componentId, section.parts, includeHidden, CONTENT_WIDTH);
      if (diagram) {
        // Hug and centre: a small component gets a card its own size.
        const holder = vstack(8);
        holder.counterAxisAlignItems = 'CENTER';
        holder.appendChild(diagram.card);
        const note = scaleNote(diagram.scale);
        if (note) holder.appendChild(note);
        fill(holder);
      } else {
        fill(buildAnatomyLegend(section.parts));
      }
      break;
    }
    case 'variantTokens': {
      const defaultCard = section.variants.find((v) => v.isDefault);
      const defaultValues = new Map((defaultCard?.props ?? []).map((p) => [p.name, p.value]));
      for (const variant of section.variants) {
        // Left pane: preview and properties. Right pane: token table.
        const card = hstack(0);
        card.cornerRadius = radius(12);
        card.clipsContent = true;
        card.strokes = solidFill(palette.border);
        card.strokeWeight = 1;
        body.appendChild(card);
        card.layoutSizingHorizontal = 'FILL';

        const left = vstack(16);
        left.fills = solidFill(palette.paneBg);
        left.paddingTop = left.paddingBottom = left.paddingLeft = left.paddingRight = VAR_PANE_PAD;
        left.strokes = solidFill(palette.border);
        left.strokeRightWeight = 1;
        left.strokeTopWeight = 0;
        left.strokeBottomWeight = 0;
        left.strokeLeftWeight = 0;
        card.appendChild(left);
        left.layoutSizingHorizontal = 'FIXED';
        left.resize(VAR_LEFT_W, left.height);
        left.layoutSizingVertical = 'FILL'; // match the taller (token) pane

        const slot = await buildSlot(variant.nodeId, VAR_LEFT_W - VAR_PANE_PAD * 2, 160, includeHidden);
        left.appendChild(slot);
        slot.layoutSizingHorizontal = 'FILL';

        // Other cards list only the axes that differ from the default.
        const differing = variant.props.filter((p) => defaultValues.get(p.name) !== p.value);
        const propList = variant.isDefault || differing.length === 0
          ? labelBlock(variant.isDefault ? 'Default variant' : 'Same values as default')
          : buildPropertyList(differing);
        left.appendChild(propList);
        propList.layoutSizingHorizontal = 'FILL';

        // No padding, so the table sits flush with the divider; cells inset the text.
        const right = vstack(0);
        card.appendChild(right);
        right.layoutSizingHorizontal = 'FILL';
        right.layoutSizingVertical = 'FILL';

        const table = await buildTokenTable(section.columns, variant.rows, false);
        right.appendChild(table);
        table.layoutSizingHorizontal = 'FILL';

        // Rows identical to the default are suppressed; this line accounts for them.
        if (!variant.isDefault && variant.sameAsDefault > 0) {
          const note = hstack(0);
          note.paddingTop = 10;
          note.paddingBottom = 12;
          note.paddingLeft = 16;
          note.paddingRight = 16;
          const tokenWord = variant.sameAsDefault === 1 ? 'token' : 'tokens';
          const text = variant.rows.length === 0
            ? `Identical to default (${variant.sameAsDefault} ${tokenWord})`
            : `${variant.sameAsDefault} more ${tokenWord} identical to default`;
          note.appendChild(makeText(text, 'Regular', 12, palette.muted, 140));
          right.appendChild(note);
          note.layoutSizingHorizontal = 'FILL';
        }
      }
      break;
    }
    case 'measure': {
      const result = await buildMeasureSection(section, includeHidden, CONTENT_WIDTH);
      if (result) {
        const holder = vstack(8);
        holder.counterAxisAlignItems = 'CENTER';
        holder.appendChild(result.card);
        const note = scaleNote(result.scale);
        if (note) holder.appendChild(note);
        fill(holder);
      }
      // The table always follows: it is the guaranteed-legible source.
      if (section.tableRows.length) fill(buildTable(['Part', 'Property', 'Token'], section.tableRows, CONTENT_WIDTH));
      break;
    }
    case 'statesMatrix': {
      const grid = await buildMatrixSection({
        axisName: section.axisName, columns: section.states, rows: section.rows,
        note: section.capped ? 'Showing the first 4 values. The other values are not drawn.' : null,
      }, CONTENT_WIDTH, includeHidden);
      fill(grid);
      break;
    }
    case 'variantsMatrix': {
      if (section.intro) body.appendChild(buildProseSlot(section.intro, 'variantsIntro', bodySpacing));
      if (section.guide.length) {
        const list = vstack(bodySpacing);
        list.resize(CONTENT_WIDTH, 1);
        list.primaryAxisSizingMode = 'AUTO';
        for (const g of section.guide) {
          // One tagged row per option, keyed by its value, so an edit to one
          // line survives an Update without duplicating the others.
          const row = makeBulletRow({ runs: parseRuns(`**${g.name}**: ${g.guidance}`), text: `${g.name}: ${g.guidance}` });
          tagSlot(row, 'variantsGuide');
          row.setPluginData(SLOT_PART_KEY, g.name);
          list.appendChild(row);
          row.layoutSizingHorizontal = 'FILL';
        }
        body.appendChild(list);
      }
      // The row-cap disclosure plus any held-axis note, as the States matrix does.
      const capNote = section.capped ? 'Showing the first 4 values. The other values are not drawn.' : null;
      const note = [capNote, section.note].filter(Boolean).join(' ') || null;
      const grid = await buildMatrixSection({ columns: section.columns, rows: section.rows, note }, CONTENT_WIDTH, includeHidden);
      fill(grid);
      // More room between the guide and the matrix than the body spacing gives.
      if (section.intro || section.guide.length) grid.paddingTop = 24;
      break;
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Header band
// ---------------------------------------------------------------------------

/**
 * The component doc header. The band is shared (brandHeader.ts); the subtitle
 * is Overview markdown, so its **bold** and `code` runs are re-applied. Only an
 * AI lede is tagged `definitionLead`: a description lede is re-read on Update.
 */
async function buildHeader(
  title: string, subtitleMd: string | null, subtitleSource: 'ai' | 'description' | null,
  eyebrow: string, logoBase64?: string | null, pill: PillState | null = null,
): Promise<FrameNode> {
  // Drop a leading list marker so no raw markdown shows.
  const runs = subtitleMd ? parseRuns(subtitleMd.replace(/^[-*]\s+/, '')) : null;
  return buildBrandHeader({
    eyebrow, title, subtitle: runs ? runs.map((r) => r.text).join('') : null, logoBase64, pill,
    styleSubtitle: runs
      ? (node) => {
          // On the band, a code span needs the on-header ink, not heading ink.
          applyRuns(node, runs, 0, palette.onHeader);
          if (subtitleSource === 'ai') tagSlot(node, 'definitionLead');
        }
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Measure a single-line string at the Token text style (Inter Regular 12). */
function measureTokenText(s: string): number {
  const t = figma.createText();
  t.fontName = font('Regular');
  t.fontSize = 12;
  t.characters = s;
  const w = t.width;
  t.remove();
  return w;
}

/**
 * The shared frame width for this build, between CARD_WIDTH_MIN and
 * CARD_WIDTH_MAX: wide enough for the longest token chip and for the widest
 * drawn component unscaled. Run after fonts load (it measures text).
 */
async function fitFrameWidth(model: DocFrameModel): Promise<void> {
  CARD_WIDTH = CARD_WIDTH_MIN;
  CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

  let longest = '';
  let keyCols = 0; // rendered columns other than Token
  for (const s of model.sections) {
    if (s.kind !== 'variantTokens') continue;
    const tokenCol = s.columns.length - 1;
    for (const v of s.variants) {
      for (const row of v.rows) {
        const tk = row.token ?? '';
        if (tk.length > longest.length) {
          longest = tk;
          // All columns minus Part (dropped) minus Token.
          keyCols = tokenCol - 1;
        }
      }
    }
  }
  if (longest) {
    // Token chip: swatch (12) + gap (6) + chip padding (8+8); the cell adds its
    // own padding (16+16). Assume a swatch is present (the wider case) plus slack.
    const chipW = measureTokenText(longest) + 12 + 6 + 16;
    const tokenColW = chipW + 32 + 8;
    // right pane = CONTENT_WIDTH - VAR_LEFT_W; Token col = right pane - key columns.
    // Solve for the CONTENT_WIDTH (hence CARD_WIDTH) that fits tokenColW.
    const needed = tokenColW + keyCols * TOKEN_KEY_COL_W + VAR_LEFT_W + PAD_X * 2;
    CARD_WIDTH = Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, Math.ceil(needed)));
    CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;
  }

  // A component wider than the column widens the frame before anything is scaled.
  const drawn = model.sections.find(
    (s): s is Extract<SectionBlock, { kind: 'anatomy' | 'measure' }> => s.kind === 'anatomy' || s.kind === 'measure',
  );
  if (drawn) {
    // Through the per-build cache; the builders read this node again.
    const comp = await nodeById(drawn.componentId);
    if (comp && 'width' in comp) {
      const needed = (comp as SceneNode).width + CARD_PAD * 2 + PAD_X * 2 + CALLOUT_ZONE;
      CARD_WIDTH = Math.max(CARD_WIDTH, Math.min(CARD_WIDTH_MAX, Math.ceil(needed)));
      CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;
    }
  }

  // Matrices never scale a preview, so the column must hold the widest
  // variant plus slot padding, which may exceed the anatomy's default.
  const cellIds = new Set<string>();
  for (const s of model.sections) {
    if (s.kind !== 'statesMatrix' && s.kind !== 'variantsMatrix') continue;
    for (const row of s.rows) for (const id of row.cells) if (id) cellIds.add(id);
  }
  // One batch; the nodes stay cached for buildMatrixSection.
  const cellNodes = await Promise.all([...cellIds].map((id) => nodeById(id)));
  let widestCell = 0;
  for (const node of cellNodes) {
    if (node && 'width' in node) widestCell = Math.max(widestCell, (node as SceneNode).width);
  }
  if (widestCell > 0) {
    const needed = widestCell + SLOT_PAD * 2 + PAD_X * 2;
    CARD_WIDTH = Math.max(CARD_WIDTH, Math.min(CARD_WIDTH_MAX, Math.ceil(needed)));
    CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;
  }
}

/** Build one group's frame: root card, header band, content column. Layer
 *  names carry the reading order. */
async function buildGroupFrame(
  group: DocGroup, index: number, title: string, subtitle: string | null,
  subtitleSource: 'ai' | 'description' | null, logoBase64: string | null,
  includeHidden: boolean, pill: PillState | null,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = `${index + 1} ${group.label}`;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = 0;
  frame.fills = solidFill(palette.bg);
  frame.cornerRadius = radius(16);
  frame.clipsContent = true;
  frame.strokes = solidFill(palette.border);
  frame.strokeWeight = 1;
  frame.resize(CARD_WIDTH, frame.height);
  frame.effects = [{
    type: 'DROP_SHADOW', color: { r: 0.06, g: 0.09, b: 0.16, a: 0.08 },
    offset: { x: 0, y: 12 }, radius: 32, spread: 0, visible: true, blendMode: 'NORMAL',
  }];
  try {
    const header = await buildHeader(title, subtitle, subtitleSource, group.label, logoBase64, pill);
    frame.appendChild(header);
    header.layoutSizingHorizontal = 'FILL';

    const content = vstack(40);
    content.paddingTop = 48;
    content.paddingBottom = 56;
    content.paddingLeft = PAD_X;
    content.paddingRight = PAD_X;
    frame.appendChild(content);
    content.layoutSizingHorizontal = 'FILL';
    for (const section of group.sections) {
      const built = await buildSection(section, includeHidden);
      content.appendChild(built);
      built.layoutSizingHorizontal = 'FILL';
    }
  } catch (err) {
    frame.remove();
    throw err;
  }
  return frame;
}

/** The Usage header subtitle with its source (so buildHeader tags only an AI
 *  lede), and the sections that still have a body. An Overview emptied into
 *  the header draws no empty heading. */
function liftHeaderSubtitle(
  sections: SectionBlock[],
): { subtitle: string | null; subtitleSource: 'ai' | 'description' | null; sections: SectionBlock[] } {
  const def = sections.find((s) => s.id === 'definition' && s.kind === 'prose') as
    Extract<SectionBlock, { kind: 'prose' }> | undefined;
  if (!def) return { subtitle: null, subtitleSource: null, sections };
  const rebuilt = sections.filter((s) => s !== def || Boolean(def.text) || def.lede !== null);
  return { subtitle: def.subtitle?.text ?? null, subtitleSource: def.subtitle?.source ?? null, sections: rebuilt };
}

/** Put a lifted lead back at the top of the Overview body, for the one case
 *  where no header will be drawn to carry it. */
function inlineSubtitle(sections: SectionBlock[], lead: string): SectionBlock[] {
  return sections.map((s) => (s.id === 'definition' && s.kind === 'prose'
    ? { ...s, subtitle: null, text: [lead, s.text].filter(Boolean).join('\n\n') }
    : s));
}

/** Build the doc Section (Usage, Specifications and Accessibility frames side
 *  by side). The caller positions it and appends it to the page. */
export async function buildDocFrames(
  model: DocFrameModel, theme: ReturnType<typeof resolveTheme>,
  logoBase64?: string | null, pill: PillState | null = null,
): Promise<SectionNode> {
  // tokenResolve's caches are module state: reset per build so edited
  // variables and styles read fresh.
  resetTokenResolveCaches();

  // frameKit's palette, corners and fonts are module state, so every field is
  // set per build, by the same helper foundationFrame.ts uses.
  await applyThemeToKit(theme);

  // One width for every frame, measured over the whole model.
  await fitFrameWidth(model);

  const includeHidden = model.includeHidden === true;
  const lifted = liftHeaderSubtitle(model.sections);
  let subtitle = lifted.subtitle;
  let subtitleSource = lifted.subtitleSource;
  let groups = groupSections(lifted.sections);
  // Lifting the lead must never remove the Usage header that carries it: if
  // the lift empties the Usage group, the words go back into the Overview.
  if (subtitle !== null && !groups.some((g) => g.id === 'usage')) {
    groups = groupSections(inlineSubtitle(model.sections, subtitle));
    subtitle = null;
    subtitleSource = null;
  }
  if (groups.length === 0) {
    throw new Error('Nothing to draw. The selected sections have no content for this component. Select more sections.');
  }

  // Build frames (auto-appended to the page by createFrame), then wrap + lay out.
  const GAP = 80; // gap between frames
  const PAD = 64; // breathing room between the frames and the Section edge
  const frames: FrameNode[] = [];
  let section: SectionNode | null = null;
  try {
    for (const [i, group] of groups.entries()) {
      const isUsage = group.id === 'usage';
      frames.push(await buildGroupFrame(
        group, i, model.displayName, isUsage ? subtitle : null, isUsage ? subtitleSource : null,
        logoBase64 ?? null, includeHidden, pill,
      ));
    }

    // A new Section does NOT grow to fit its children: lay the frames out at
    // PAD offsets, then resize it to their bounds. Children are
    // section-relative, so moving the Section carries them.
    section = figma.createSection();
    // The Section keeps the RAW name: the registry and findExistingDoc match on it.
    section.name = `${model.componentName}: Documentation`;
    section.x = 0;
    section.y = 0;

    let cursorX = PAD;
    let maxH = 0;
    for (const frame of frames) {
      section.appendChild(frame);
      frame.x = cursorX;
      frame.y = PAD;
      cursorX += frame.width + GAP;
      if (frame.height > maxH) maxH = frame.height;
    }

    // cursorX overshot by one trailing GAP after the last frame; drop it.
    section.resizeWithoutConstraints(Math.max(cursorX - GAP + PAD, 1), Math.max(maxH + PAD * 2, 1));
    return section;
  } catch (err) {
    // Never litter the canvas on failure: remove the frames AND the Section
    // itself (a throw during appendChild/resize leaves it created but empty).
    for (const f of frames) { try { f.remove(); } catch { /* already gone */ } }
    if (section) { try { section.remove(); } catch { /* already gone */ } }
    throw err;
  }
}

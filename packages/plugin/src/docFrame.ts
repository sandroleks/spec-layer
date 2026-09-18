/// <reference types="@figma/plugin-typings" />
/**
 * docFrame.ts — the component document: three frames, in reading order.
 *
 * This module is the dispatch: it owns the frame chrome (card, header band,
 * content column) and routes every block kind the doc model
 * emits to the module that draws it. The blocks themselves live in
 * docBlocks.ts, anatomySection.ts, measureSection.ts and statesSection.ts;
 * the text and table primitives live in docText.ts. What stays here is the
 * per-variant token card, which nothing else needs.
 *
 * Runs on the main thread, in Figma's bare sandbox: ECMAScript built-ins and
 * the `figma` API only.
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
  headingFont, radius, applyThemeToKit,
} from './frameKit';
import { buildBrandHeader, HEADER_PAD_X } from './brandHeader';
import { buildMeasureSection } from './measureSection';
import { buildMatrixSection } from './statesSection';
import { resolveTokenColor, resolveTokenNumber, resolveTokenTypography, resetTokenResolveCaches } from './tokenResolve';
import {
  tagSlot, applyRuns, accentRule, makeBulletRow, buildProse, makeCell, buildTable,
} from './docText';
import { buildAnatomyDiagram, buildAnatomyLegend, scaleNote } from './anatomySection';
import {
  buildTwoColumns, buildGuidelinePairs, buildKeyboardTable,
  buildPropertiesTable, columnParagraph,
} from './docBlocks';
import { displayPartName } from './ui/displayNames';
import { SLOT_PART_KEY, type ProseSlot } from './canvasProse';

// ---------------------------------------------------------------------------
// Design tokens for the generated doc frame
// ---------------------------------------------------------------------------

// Layout constants
// Horizontal padding for header + content. Taken from the shared header so the
// band's padding and the content column's padding cannot drift out of line.
const PAD_X = HEADER_PAD_X;
const VAR_LEFT_W = 240; // per-variant card: left pane (preview + properties)
const VAR_PANE_PAD = 20; // per-variant card: pane padding
const TOKEN_KEY_COL_W = 120; // token tables: fixed width of the non-Token columns
const CARD_PAD = 24; // diagram card padding (anatomySection's own ANATOMY_PAD)
const CALLOUT_ZONE = 60; // room beside a diagram for its pins and leaders

// The frame width is normally CARD_WIDTH_MIN, but token names can be long
// slash-paths and their chips hug their text, and a component can be wider than
// the column, so the frame widens on build (computed in fitFrameWidth()). These
// are `let` because they're recomputed per build; CONTENT_WIDTH derives from it.
const CARD_WIDTH_MIN = 880;
const CARD_WIDTH_MAX = 1440; // safety cap so a pathological token can't run away
let CARD_WIDTH = CARD_WIDTH_MIN;
let CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

// ---------------------------------------------------------------------------
// Prose — see canvasProse.ts. Anything tagged with a slot is text the designer
// owns; an Update reads it back instead of regenerating it.
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

/** One paragraph spanning the column, with the slot tag on the TEXT node
 *  itself. A single-string slot (anatomySummary, definitionLead) is read
 *  straight off the node it is tagged on, so tagging a container would read
 *  back as nothing. */
function buildTaggedParagraph(text: string, slot: ProseSlot, size = 15): FrameNode {
  const box = columnParagraph(text, CONTENT_WIDTH, size);
  const node = box.children[0];
  if (node) tagSlot(node, slot);
  return box;
}

// ---------------------------------------------------------------------------
// Per-variant tokens — live instance slot + a token table with color swatches
// ---------------------------------------------------------------------------

/** A 12×12 rounded color chip. */
function colorChip(color: RGB): FrameNode {
  const chip = figma.createFrame();
  chip.resize(12, 12);
  chip.cornerRadius = radius(3);
  chip.fills = solidFill(color);
  chip.strokes = solidFill(palette.border);
  chip.strokeWeight = 1;
  return chip;
}

/** The Token cell: a rounded chip (like the web) holding an optional color
 *  swatch plus the token name. When `unbound`, the value is a raw hardcoded
 *  value (not a token): no color lookup, a dashed muted outline, and muted ink. */
async function makeTokenCell(token: string, unbound = false): Promise<FrameNode> {
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
    // Raw value: no swatch, no fill, dashed muted outline.
    chip.fills = [];
    chip.strokes = solidFill(palette.muted);
    chip.strokeWeight = 1;
    chip.dashPattern = [3, 2];
  } else {
    chip.fills = solidFill(palette.chipBg);
    const color = await resolveTokenColor(token);
    if (color) chip.appendChild(colorChip(color));
  }

  // Chip and text both hug their content (single-line pill). The Token column is
  // sized wide enough to hold the longest token (see fitFrameWidth), so the pill
  // never overflows and gets clipped.
  const text = makeText(token, 'Medium', 13, unbound ? palette.muted : palette.heading, 140);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(text);

  // Bound tokens with no color swatch: append a best-effort resolved-value
  // suffix (a FLOAT number, or a text-style summary) as a separate muted node so
  // the chip stays single-line. Any failure → no suffix, never a crash.
  if (!unbound && chip.children.length === 1) {
    let suffix: string | null = null;
    const n = await resolveTokenNumber(token);
    if (n !== null) suffix = `· ${n}`;
    else {
      const typo = await resolveTokenTypography(token);
      if (typo) suffix = `· ${typo}`;
    }
    if (suffix) {
      const sfx = makeText(suffix, 'Regular', 11, palette.muted, 140);
      sfx.textAutoResize = 'WIDTH_AND_HEIGHT';
      chip.appendChild(sfx);
    }
  }

  cell.appendChild(chip);
  return cell;
}

/** Token table for a single variant. Rows arrive as [part, property, token, …]
 *  already ordered by part; we drop the repeated Part column and instead start
 *  each part's rows with a bold group-header band, so the table reads as grouped
 *  sub-sections. The Token column (last) holds long, slash-delimited names, so it
 *  FILLs the remaining width while the short key columns stay fixed-narrow.
 *  Sized to FILL its parent (the table sits beside the instance slot). */
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

  // No "None." row. A variant card with no rows is a non-default variant
  // whose tokens all match the default, and the "Identical to default (N
  // tokens)" note the caller appends already says so; printing "None." under
  // it would read as "this variant binds no tokens", which is the opposite.
  if (rows.length === 0) return table;

  let currentPart: string | null = null;
  for (const r of rows) {
    const part = r.part ?? '';
    const cells = [r.property, r.token];
    // Start a new group with a full-width, bold part band whenever the part
    // changes (rows are pre-sorted by part). A blank part gets no band.
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
    // Diff rows (a token that changed from the default variant) get a faint
    // accent tint and a stronger Property ink so they read as the delta.
    if (r.diff) row.fills = [{ type: 'SOLID', color: palette.accent, opacity: 0.06 }];
    for (let i = 0; i < dataCount; i++) {
      const value = cells[i] ?? '';
      const isToken = i === dataCount - 1;
      // Property reads as a quiet label; the token value (chip) carries emphasis.
      const cell = isToken
        ? await makeTokenCell(value, r.unbound)
        : makeCell(value, 'Medium', 13, r.diff ? palette.heading : palette.label);
      row.appendChild(cell);
      sizeCol(cell, i);
    }
  }

  return table;
}

/** The left-pane PROPERTIES list: a small heading + axis/value rows. */
function buildPropertyList(props: { name: string; value: string }[]): FrameNode {
  const wrap = vstack(8);
  const heading = makeText('PROPERTIES', 'Medium', 10, palette.muted);
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

  // Teal accent rule + heading (tightly grouped)
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
      // An AI lede the description outranked opens the Overview as its own
      // tagged paragraph, a SIBLING of the definition container: readCanvasProse
      // stops at the first tagged node, so a definitionLead nested inside the
      // definition slot would never be read back.
      if (section.lede) body.appendChild(buildTaggedParagraph(section.lede, 'definitionLead', 17));
      // The description is generated-lane: it comes from the component, is
      // hashed, and an Update re-reads it from Figma, so it is NOT tagged. An
      // AI overview is editorial and is.
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
    case 'propertiesTable': fill(buildPropertiesTable(section.rows, section.hasDescriptions, CONTENT_WIDTH)); break;
    case 'table': fill(buildTable(section.columns, section.rows, CONTENT_WIDTH)); break;
    case 'anatomy': {
      if (section.summary) body.appendChild(buildTaggedParagraph(section.summary, 'anatomySummary'));
      if (section.view !== 'table') {
        const diagram = await buildAnatomyDiagram(section.componentId, section.parts, includeHidden, CONTENT_WIDTH);
        if (diagram) {
          // Hug and centre: a small component sits in a card its own size, not
          // in a column-wide field of white.
          const holder = vstack(8);
          holder.counterAxisAlignItems = 'CENTER';
          holder.appendChild(diagram.card);
          const note = scaleNote(diagram.scale);
          if (note) holder.appendChild(note);
          fill(holder);
        } else {
          fill(buildAnatomyLegend(section.parts));
        }
      }
      if (section.view === 'table' || section.view === 'both') {
        const rows = section.parts.map((p) => [
          p.label, `${'    '.repeat(p.depth)}${displayPartName(p.name)}`, p.type.toLowerCase(), p.component ?? '',
          p.tokens.length <= 3 ? p.tokens.join(' · ') : `${p.tokens.slice(0, 3).join(' · ')} +${p.tokens.length - 3}`,
        ]);
        fill(buildTable(['#', 'Part', 'Type', 'Component', 'Tokens'], rows, CONTENT_WIDTH));
      }
      break;
    }
    case 'variantTokens': {
      const defaultCard = section.variants.find((v) => v.isDefault);
      const defaultValues = new Map((defaultCard?.props ?? []).map((p) => [p.name, p.value]));
      for (const variant of section.variants) {
        // A bordered card split into a left pane (preview + properties) and a
        // right pane (token table), like the docs inspector.
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

        // The default card says so; every other card lists only the axes
        // whose value differs from the default, so seven rows of "False"
        // never appear again.
        const differing = variant.props.filter((p) => defaultValues.get(p.name) !== p.value);
        const propList = variant.isDefault || differing.length === 0
          ? labelBlock(variant.isDefault ? 'Default variant' : 'Same axes as default')
          : buildPropertyList(differing);
        left.appendChild(propList);
        propList.layoutSizingHorizontal = 'FILL';

        // Right pane — no padding so the token table sits flush with the divider
        // and card edges; cell padding provides the text inset.
        const right = vstack(0);
        card.appendChild(right);
        right.layoutSizingHorizontal = 'FILL';
        right.layoutSizingVertical = 'FILL';

        const table = await buildTokenTable(section.columns, variant.rows, false);
        right.appendChild(table);
        table.layoutSizingHorizontal = 'FILL';

        // Non-default cards suppress rows identical to the default; a summary
        // line accounts for them so the card doesn't read as if those tokens
        // are absent.
        if (!variant.isDefault && variant.sameAsDefault > 0) {
          const note = hstack(0);
          note.paddingTop = 10;
          note.paddingBottom = 12;
          note.paddingLeft = 16;
          note.paddingRight = 16;
          const text = variant.rows.length === 0
            ? `Identical to default (${variant.sameAsDefault} tokens)`
            : `Same as default · ${variant.sameAsDefault} more token${variant.sameAsDefault === 1 ? '' : 's'}`;
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
        note: section.capped ? 'Showing the first 4 values. Other rows share the same state behaviour.' : null,
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
          // One tagged row per option, keyed by the option value: the guide is
          // editorial per option, not one blob, so an edit to one line survives
          // an Update without the others duplicating.
          const row = makeBulletRow({ runs: parseRuns(`**${g.name}**: ${g.guidance}`), text: `${g.name}: ${g.guidance}` });
          tagSlot(row, 'variantsGuide');
          row.setPluginData(SLOT_PART_KEY, g.name);
          list.appendChild(row);
          row.layoutSizingHorizontal = 'FILL';
        }
        body.appendChild(list);
      }
      // Combine the row-cap disclosure (when the first axis had >4 values) with
      // any held-axis note, so a capped Variants matrix explains its truncation
      // the same way the States matrix does.
      const capNote = section.capped ? 'Showing the first 4 values. Other variants share the same structure.' : null;
      const note = [capNote, section.note].filter(Boolean).join(' ') || null;
      const grid = await buildMatrixSection({ columns: section.columns, rows: section.rows, note }, CONTENT_WIDTH, includeHidden);
      fill(grid);
      // Extra breathing room between the guide and the preview matrix; the
      // body's default spacing reads as cramped against the prose above.
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
 * The component doc header. The band itself is shared with foundation docs (see
 * brandHeader.ts); what stays here is the one component-specific part: the
 * subtitle is markdown lifted from the Overview, so its **bold** and `code`
 * runs are parsed out and re-applied to the text node.
 *
 * The `definitionLead` tag says "a person owns these words". An AI lede is
 * theirs to keep; a lede lifted from the component's own Figma description is
 * generated, re-read from the component on every Update, so it stays untagged.
 */
async function buildHeader(
  title: string, subtitleMd: string | null, subtitleSource: 'ai' | 'description' | null,
  eyebrow: string, logoBase64?: string | null, pill: PillState | null = null,
): Promise<FrameNode> {
  // Parse the lead for **bold** / `code` runs and drop any leading list marker
  // so no raw markdown shows in the subtitle.
  const runs = subtitleMd ? parseRuns(subtitleMd.replace(/^[-*]\s+/, '')) : null;
  return buildBrandHeader({
    eyebrow, title, subtitle: runs ? runs.map((r) => r.text).join('') : null, logoBase64, pill,
    styleSubtitle: runs
      ? (node) => {
          // The subtitle sits on the header band, not the page background, so
          // a code span needs the on-header ink, not the default heading ink
          // (which is the same colour as the band on the default theme).
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
 * The shared frame width for this build.
 *
 * Token chips hug their text, so a long token can overflow the Token column and
 * get clipped. Rather than wrap or shrink the chip, we widen the whole frame:
 * find the longest token across any per-variant token table, measure its chip,
 * and grow CARD_WIDTH so the (FILL) Token column is at least that wide. A
 * component wider than the resulting column widens the frame again, because
 * instances render at true size and scaling one down is the last resort. Stays
 * at CARD_WIDTH_MIN when neither applies, and is capped at CARD_WIDTH_MAX. Must
 * run after fonts load (it measures text).
 */
async function fitFrameWidth(model: DocFrameModel): Promise<void> {
  CARD_WIDTH = CARD_WIDTH_MIN;
  CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

  let longest = '';
  let keyCols = 0; // rendered columns other than Token (Part is dropped — see buildTokenTable)
  for (const s of model.sections) {
    if (s.kind !== 'variantTokens') continue;
    const tokenCol = s.columns.length - 1;
    for (const v of s.variants) {
      for (const row of v.rows) {
        const tk = row.token ?? '';
        if (tk.length > longest.length) {
          longest = tk;
          // buildTokenTable drops the Part column, so the fixed-width key
          // columns rendered are (all columns) minus Part minus Token.
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
    try {
      const comp = await figma.getNodeByIdAsync(drawn.componentId);
      if (comp && 'width' in comp) {
        const needed = (comp as SceneNode).width + CARD_PAD * 2 + PAD_X * 2 + CALLOUT_ZONE;
        CARD_WIDTH = Math.max(CARD_WIDTH, Math.min(CARD_WIDTH_MAX, Math.ceil(needed)));
        CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;
      }
    } catch { /* keep the token-fitted width */ }
  }

  // The widest variant in a matrix widens the frame too. The matrices never
  // scale a preview; their last resort is one slot spanning the column, so
  // the column has to hold the widest variant plus the slot's padding. The
  // default variant the anatomy fitted may be narrower than, say, Large.
  const cellIds = new Set<string>();
  for (const s of model.sections) {
    if (s.kind !== 'statesMatrix' && s.kind !== 'variantsMatrix') continue;
    for (const row of s.rows) for (const id of row.cells) if (id) cellIds.add(id);
  }
  let widestCell = 0;
  for (const id of cellIds) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (node && 'width' in node) widestCell = Math.max(widestCell, (node as SceneNode).width);
    } catch { /* an unknown width widens nothing */ }
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

/** The Usage header subtitle, and the sections that still have a body to draw.
 *  The model decided whose words lead (see HeaderSubtitle); the source travels
 *  with them, so buildHeader tags an AI lede editorial and leaves a
 *  description untagged. An Overview whose whole text went into the header
 *  draws no empty heading. */
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

/**
 * Build the on-canvas doc Section (Usage / Specifications / Accessibility
 * frames side by side) from a DocFrameModel. Returns the Section; the caller
 * positions it and appends it to the page.
 */
export async function buildDocFrames(
  model: DocFrameModel, theme: ReturnType<typeof resolveTheme>,
  logoBase64?: string | null, pill: PillState | null = null,
): Promise<SectionNode> {
  // Resolved-value caches (color/float variables, text styles) are module
  // state in tokenResolve — reset them per build so a rebuild after the user
  // edits variables/styles picks up fresh values instead of stale ones.
  resetTokenResolveCaches();

  // Palette, corner style and fonts are module state in frameKit, so every
  // field is set per build: a Default build after a themed one has to fully
  // reset rather than inherit. foundationFrame.ts calls the same helper, which
  // is what keeps the two frame families from drifting apart.
  await applyThemeToKit(theme);

  // Shared width across all frames — measured over the full (flat) model.
  await fitFrameWidth(model);

  const includeHidden = model.includeHidden === true;
  const lifted = liftHeaderSubtitle(model.sections);
  let subtitle = lifted.subtitle;
  let subtitleSource = lifted.subtitleSource;
  let groups = groupSections(lifted.sections);
  // The subtitle rides the Usage header, so lifting the lead must never be
  // what removes that header: when the lift empties the Usage group (or the
  // whole document), put those words back into the Overview body rather than
  // losing the only line the component carries.
  if (subtitle !== null && !groups.some((g) => g.id === 'usage')) {
    groups = groupSections(inlineSubtitle(model.sections, subtitle));
    subtitle = null;
    subtitleSource = null;
  }
  if (groups.length === 0) throw new Error('No sections selected.');

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

    // A freshly created Section keeps its default (small) size — it does NOT
    // auto-grow to contain appended children. Pin its origin to (0,0), lay the
    // frames out inside at PAD offsets, then resize the Section to the frames'
    // bounding box (+ padding) so it actually holds all three. Section children
    // use section-relative coordinates, so a later section.x/y move carries them.
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

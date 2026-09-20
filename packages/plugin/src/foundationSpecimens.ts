/// <reference types="@figma/plugin-typings" />
/**
 * foundationSpecimens.ts: the list layouts for text styles and effect styles.
 *
 * A style is shown, not tabulated: a text style sets a sentence in itself at
 * true size, an effect style casts its shadow on a card. Under each specimen a
 * line names the metrics or layers, with a chip for every value that is bound
 * to a token. The pure halves (`metricsLine`, `layerLines`, `figmaEffectsFor`)
 * are tested; the drawing is verified on canvas by the Figma matrix.
 *
 * Runs on the main thread: ECMAScript and the figma API only.
 */
import type {
  EffectLayer, FoundationEffectRow, FoundationTextMetrics, FoundationTextRow,
} from '@spec-layer/extractor';
import { groupRowsByFolder, groupTitles } from '@spec-layer/extractor';
import { palette, solidFill, vstack, hstack, makeText, headingFont, radius, hex } from './frameKit';

export interface LinePart { label: string; tokens: string[] }

/** Set in every text style at true size. A sentence shows rhythm and descenders a name cannot. */
export const SPECIMEN_TEXT = 'The quick brown fox jumps over the lazy dog';

const CASE_WORD: Record<string, string> = {
  UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'title case',
  SMALL_CAPS: 'small caps', SMALL_CAPS_FORCED: 'small caps forced',
};

function lineHeightLabel(lh: FoundationTextMetrics['lineHeight']): string {
  if (lh.unit === 'AUTO') return 'auto';
  if (lh.value === undefined) return 'unknown';
  return lh.unit === 'PERCENT' ? `${lh.value}%` : String(lh.value);
}

function spacingLabel(s: FoundationTextMetrics['letterSpacing']): string {
  return s.unit === 'PERCENT' ? `${s.value}%` : String(s.value);
}

const tokensFor = (b: Record<string, string>, ...fields: string[]): string[] =>
  fields.flatMap((f) => (b[f] ? [b[f]] : []));

/** The metrics line, as parts so the renderer can put a chip after any that carry a token. */
export function metricsLine(m: FoundationTextMetrics): LinePart[] {
  const b = m.boundTokens;
  const parts: LinePart[] = [
    { label: m.fontFamily, tokens: tokensFor(b, 'fontFamily') },
    { label: m.fontStyle, tokens: tokensFor(b, 'fontStyle') },
    { label: `${m.fontSize}/${lineHeightLabel(m.lineHeight)}`, tokens: tokensFor(b, 'fontSize', 'lineHeight') },
    { label: `letter spacing ${spacingLabel(m.letterSpacing)}`, tokens: tokensFor(b, 'letterSpacing') },
    { label: `paragraph spacing ${m.paragraphSpacing}`, tokens: tokensFor(b, 'paragraphSpacing') },
  ];
  if (m.textCase !== 'ORIGINAL') {
    parts.push({ label: CASE_WORD[m.textCase] ?? m.textCase.toLowerCase().replace(/_/g, ' '), tokens: [] });
  }
  if (m.textDecoration !== 'NONE') parts.push({ label: m.textDecoration.toLowerCase(), tokens: [] });
  return parts;
}

const pct = (alpha: number): string => `${Math.round(alpha * 100)}%`;
const colorLabel = (c: { hex: string; alpha: number }): string => `${c.hex.toUpperCase()} ${pct(c.alpha)}`;
const num = (n: number): string => String(n);

/** One line per layer, in layer order, as parts with a chip for every bound field. */
export function layerLines(layers: EffectLayer[], boundTokens: Record<string, string>): LinePart[][] {
  return layers.map((layer, i) => {
    const tok = (field: string): string[] => {
      const name = boundTokens[`effects[${i}].${field}`];
      return name ? [name] : [];
    };
    const part = (label: string, field?: string): LinePart => ({ label, tokens: field ? tok(field) : [] });
    let parts: LinePart[];
    switch (layer.type) {
      case 'drop-shadow':
      case 'inner-shadow':
        parts = [
          part(layer.type === 'drop-shadow' ? 'Drop shadow' : 'Inner shadow'),
          { label: `${num(layer.offset.x)}, ${num(layer.offset.y)}`, tokens: [...tok('offsetX'), ...tok('offsetY')] },
          part(`blur ${num(layer.radius)}`, 'radius'),
          ...(layer.spread !== undefined ? [part(`spread ${num(layer.spread)}`, 'spread')] : []),
          part(colorLabel(layer.color), 'color'),
        ];
        break;
      case 'layer-blur':
      case 'background-blur':
        parts = [
          part(layer.type === 'layer-blur' ? 'Layer blur' : 'Background blur'),
          part(num(layer.radius), 'radius'),
          ...(layer.blurType === 'progressive' ? [part(`progressive from ${num(layer.startRadius)}`)] : []),
        ];
        break;
      case 'noise':
        parts = [part('Noise'), part(layer.noiseType), part(`size ${num(layer.noiseSize)}`),
          part(`density ${num(layer.density)}`), part(layer.color.hex.toUpperCase())];
        break;
      case 'texture':
        parts = [part('Texture'), part(`size ${num(layer.noiseSize)}`), part(`radius ${num(layer.radius)}`)];
        break;
      case 'glass':
        parts = [part('Glass'), part(`radius ${num(layer.radius)}`),
          part(`light ${num(layer.lightIntensity)} at ${num(layer.lightAngle)}°`),
          part(`refraction ${num(layer.refraction)}`), part(`depth ${num(layer.depth)}`),
          part(`dispersion ${num(layer.dispersion)}`)];
        break;
      case 'unknown':
        // Listed, never guessed at: a shape this build of the plugin has no
        // model for has no numbers to report and nothing to apply.
        return [part('Unsupported effect')];
    }
    if ('visible' in layer && !layer.visible) parts.push(part('hidden'));
    return parts;
  });
}

function rgba(c: { hex: string; alpha: number }): RGBA {
  return { ...hex(c.hex), a: c.alpha };
}

/**
 * The Figma effects a card applies for a style: visible layers only, each in
 * the shape the Plugin API declares. Hidden layers are listed, not applied;
 * an `unknown` layer has no shape to apply. Noise, texture and glass are
 * built to their typings; whether a given Figma build accepts them on a plain
 * rectangle is decided at apply time, per layer.
 */
export function figmaEffectsFor(layers: EffectLayer[]): Effect[] {
  const out: Effect[] = [];
  for (const layer of layers) {
    if (layer.type === 'unknown' || !layer.visible) continue;
    switch (layer.type) {
      case 'drop-shadow':
      case 'inner-shadow':
        out.push({
          type: layer.type === 'drop-shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW',
          visible: true, blendMode: layer.blendMode as BlendMode,
          color: rgba(layer.color), offset: layer.offset, radius: layer.radius,
          ...(layer.spread !== undefined ? { spread: layer.spread } : {}),
        } as Effect);
        break;
      case 'layer-blur':
      case 'background-blur': {
        const type = layer.type === 'layer-blur' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR';
        out.push(layer.blurType === 'progressive'
          ? { type, blurType: 'PROGRESSIVE', visible: true, radius: layer.radius, startRadius: layer.startRadius,
            startOffset: layer.startOffset, endOffset: layer.endOffset } as Effect
          : { type, blurType: 'NORMAL', visible: true, radius: layer.radius } as Effect);
        break;
      }
      case 'noise': {
        const base = { type: 'NOISE', visible: true, blendMode: layer.blendMode as BlendMode,
          color: rgba(layer.color), noiseSize: layer.noiseSize, density: layer.density };
        if (layer.noiseType === 'monotone') out.push({ ...base, noiseType: 'MONOTONE' } as Effect);
        else if (layer.noiseType === 'duotone' && layer.secondaryColor) {
          out.push({ ...base, noiseType: 'DUOTONE', secondaryColor: rgba(layer.secondaryColor) } as Effect);
        } else if (layer.noiseType === 'multitone' && layer.opacity !== undefined) {
          out.push({ ...base, noiseType: 'MULTITONE', opacity: layer.opacity } as Effect);
        }
        break;
      }
      case 'texture':
        out.push({ type: 'TEXTURE', visible: true, noiseSize: layer.noiseSize, radius: layer.radius,
          clipToShape: layer.clipToShape } as Effect);
        break;
      case 'glass':
        out.push({ type: 'GLASS', visible: true, radius: layer.radius, lightIntensity: layer.lightIntensity,
          lightAngle: layer.lightAngle, refraction: layer.refraction, depth: layer.depth,
          dispersion: layer.dispersion } as Effect);
        break;
    }
  }
  return out;
}

function tokenChip(name: string): FrameNode {
  const c = hstack(0);
  c.paddingTop = c.paddingBottom = 1;
  c.paddingLeft = c.paddingRight = 5;
  c.cornerRadius = radius(4);
  c.fills = solidFill(palette.chipBg);
  const t = makeText(name, 'Medium', 10, palette.heading);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  c.appendChild(t);
  return c;
}

/** One wrapping row of muted parts separated by " · ", a chip after each part's tokens. */
export function partsRow(parts: LinePart[], contentWidth: number): FrameNode {
  const row = hstack(6);
  row.name = 'Metrics';
  row.layoutWrap = 'WRAP';
  row.counterAxisAlignItems = 'CENTER';
  row.resize(contentWidth, row.height);
  row.layoutSizingHorizontal = 'FIXED';
  row.layoutSizingVertical = 'HUG';
  parts.forEach((part, i) => {
    // A separate node, not a "· " prefix baked into the label: keeps each part's
    // own text exactly what it says, so a reader (and a test) can find "paragraph
    // spacing 16" as its own string rather than a substring of "· paragraph spacing 16".
    if (i > 0) {
      const sep = makeText('·', 'Regular', 10, palette.muted);
      sep.textAutoResize = 'WIDTH_AND_HEIGHT';
      row.appendChild(sep);
    }
    const label = makeText(part.label, 'Regular', 10, palette.muted);
    label.textAutoResize = 'WIDTH_AND_HEIGHT';
    row.appendChild(label);
    for (const token of part.tokens) row.appendChild(tokenChip(token));
  });
  return row;
}

function fixedColumn(width: number): FrameNode {
  const col = vstack(6);
  col.resize(width, col.height);
  col.layoutSizingHorizontal = 'FIXED';
  col.layoutSizingVertical = 'HUG';
  return col;
}

function wrapped(parent: FrameNode, chars: string, style: 'Regular' | 'Medium', size: number, color: RGB): TextNode {
  const t = makeText(chars, style, size, color);
  parent.appendChild(t);
  t.layoutSizingHorizontal = 'FILL';
  t.textAutoResize = 'HEIGHT';
  return t;
}

function divider(row: FrameNode): void {
  row.strokes = solidFill(palette.divider);
  row.strokeTopWeight = 1;
  row.strokeBottomWeight = 0;
  row.strokeLeftWeight = 0;
  row.strokeRightWeight = 0;
}

function nameAndDescription(col: FrameNode, name: string, description: string, show: boolean): void {
  wrapped(col, name, 'Medium', 13, palette.heading);
  if (show && description) wrapped(col, description, 'Regular', 11, palette.muted);
}

/** Group rows under folder headings, the same derivation the swatch list uses. */
function groupedList<T extends { name: string }>(
  rows: T[], gap: number, renderRow: (row: T, index: number) => FrameNode,
): FrameNode {
  const list = vstack(32);
  const groups = groupRowsByFolder(rows);
  const titles = groupTitles(groups.map((g) => g.folder));
  groups.forEach((group, gi) => {
    const block = vstack(gap);
    block.name = group.folder || 'Ungrouped';
    if (group.folder) {
      const head = makeText(titles[gi], 'Bold', 15, palette.heading);
      head.fontName = headingFont('Bold');
      block.appendChild(head);
    }
    const body = vstack(0);
    block.appendChild(body);
    group.rows.forEach((row, i) => body.appendChild(renderRow(row, i)));
    list.appendChild(block);
  });
  return list;
}

const TEXT_FALLBACK_NOTE = 'Font not available, showing the default font.';

/**
 * The text-styles list. `failedFamilies` holds `${family}|${style}` keys whose
 * font could not be loaded; those specimens keep the kit font and say so.
 */
export function buildTextSpecimenList(
  rows: FoundationTextRow[], contentWidth: number, showDescriptions: boolean,
  failedFamilies: ReadonlySet<string>,
): FrameNode {
  const list = groupedList(rows, 14, (row, i) => {
    const col = fixedColumn(contentWidth);
    col.name = row.name;
    col.paddingTop = 18;
    col.paddingBottom = 18;
    if (i > 0) divider(col);
    nameAndDescription(col, row.name, row.description, showDescriptions);

    const m = row.metrics;
    const failed = failedFamilies.has(`${m.fontFamily}|${m.fontStyle}`);
    const specimen = wrapped(col, SPECIMEN_TEXT, 'Regular', m.fontSize, palette.heading);
    if (!failed) specimen.fontName = { family: m.fontFamily, style: m.fontStyle };
    specimen.lineHeight = m.lineHeight.unit === 'AUTO'
      ? { unit: 'AUTO' }
      : { unit: m.lineHeight.unit, value: m.lineHeight.value ?? 0 };
    specimen.letterSpacing = { unit: m.letterSpacing.unit, value: m.letterSpacing.value };
    specimen.textCase = m.textCase as TextCase;
    specimen.textDecoration = m.textDecoration as TextDecoration;

    col.appendChild(partsRow(metricsLine(m), contentWidth));
    if (failed) wrapped(col, TEXT_FALLBACK_NOTE, 'Regular', 10, palette.muted);
    return col;
  });
  list.name = 'Text styles';
  return list;
}

const CARD_W = 160;
const CARD_H = 96;
const PANE_PAD = 24;
const BACKDROP_CELL = 12;

/** A two-tone backdrop so a background blur has something to blur. */
function backdrop(width: number, height: number): FrameNode {
  const grid = vstack(0);
  grid.name = 'Backdrop';
  grid.layoutMode = 'NONE';
  grid.clipsContent = true;
  grid.resize(width, height);
  for (let y = 0; y * BACKDROP_CELL < height; y++) {
    for (let x = 0; x * BACKDROP_CELL < width; x++) {
      const cell = figma.createRectangle();
      cell.resize(BACKDROP_CELL, BACKDROP_CELL);
      cell.fills = solidFill((x + y) % 2 === 0 ? palette.chipBg : palette.border);
      grid.appendChild(cell);
      cell.x = x * BACKDROP_CELL;
      cell.y = y * BACKDROP_CELL;
    }
  }
  return grid;
}

/** The specimen pane: a white card on the pane tint with the style's layers applied one at a time. */
function specimenPane(layers: EffectLayer[]): FrameNode {
  const pane = vstack(0);
  pane.name = 'Pane';
  pane.fills = solidFill(palette.paneBg);
  pane.cornerRadius = radius(8);
  pane.paddingTop = pane.paddingBottom = pane.paddingLeft = pane.paddingRight = PANE_PAD;
  pane.layoutMode = 'NONE';
  pane.resize(CARD_W + PANE_PAD * 2, CARD_H + PANE_PAD * 2);
  pane.clipsContent = true;

  if (layers.some((l) => l.type === 'background-blur' && l.visible)) {
    const ground = backdrop(CARD_W + PANE_PAD * 2, CARD_H + PANE_PAD * 2);
    pane.appendChild(ground);
    ground.x = 0;
    ground.y = 0;
  }

  const card = figma.createRectangle();
  card.name = 'Specimen';
  card.resize(CARD_W, CARD_H);
  card.fills = solidFill(palette.bg);
  card.cornerRadius = radius(8);
  pane.appendChild(card);
  card.x = PANE_PAD;
  card.y = PANE_PAD;
  // One layer at a time: a Figma build that rejects one shape still shows the rest.
  const applied: Effect[] = [];
  for (const effect of figmaEffectsFor(layers)) {
    try { card.effects = [...applied, effect]; applied.push(effect); }
    catch { /* listed in the text under the card, not applied */ }
  }
  return pane;
}

/** The effect-styles list: name, description and layer lines on the left, the specimen pane on the right. */
export function buildEffectSpecimenList(
  rows: FoundationEffectRow[], contentWidth: number, showDescriptions: boolean,
): FrameNode {
  const paneWidth = CARD_W + PANE_PAD * 2;
  // The lines sit beside the pane, not under it: a 208px pane column cannot
  // hold "Drop shadow · 0, 4 · blur 12 · spread 0 · #0F172A 16%" on any
  // sensible number of lines.
  const textWidth = contentWidth - paneWidth - 24;
  const list = groupedList(rows, 14, (row, i) => {
    const line = hstack(24);
    line.name = row.name;
    line.paddingTop = 18;
    line.paddingBottom = 18;
    line.counterAxisAlignItems = 'MIN';
    line.resize(contentWidth, line.height);
    line.layoutSizingHorizontal = 'FIXED';
    line.layoutSizingVertical = 'HUG';
    if (i > 0) divider(line);

    const col = fixedColumn(textWidth);
    line.appendChild(col);
    nameAndDescription(col, row.name, row.description, showDescriptions);
    for (const parts of layerLines(row.layers, row.boundTokens)) col.appendChild(partsRow(parts, textWidth));

    line.appendChild(specimenPane(row.layers));
    return line;
  });
  list.name = 'Effect styles';
  return list;
}

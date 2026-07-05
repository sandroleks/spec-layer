/// <reference types="@figma/plugin-typings" />

// ---------------------------------------------------------------------------
// Token resolution — variables/text-styles lookup + caching for docFrame
// ---------------------------------------------------------------------------
//
// Pure extraction from docFrame.ts: module-level caches (color/float
// variables, text styles) and the resolvers that use them to turn a token
// name from the spec into a swatch color, a number, or a typography summary.

// Local COLOR variables, loaded once, keyed by full name (e.g. "color/bg/brand")
// so a token string from the spec can be resolved to a swatch.
let colorVarCache: Map<string, Variable> | null = null;

async function loadColorVars(): Promise<Map<string, Variable>> {
  if (colorVarCache) return colorVarCache;
  const map = new Map<string, Variable>();
  try {
    const vars = await figma.variables.getLocalVariablesAsync('COLOR');
    for (const v of vars) map.set(v.name, v);
  } catch {
    /* variables API unavailable — swatches simply won't render */
  }
  colorVarCache = map;
  return map;
}

async function resolveVariableColor(v: Variable, depth = 0): Promise<RGB | null> {
  if (depth > 4) return null;
  try {
    const collection = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    const modeId = collection?.defaultModeId;
    if (!modeId) return null;
    const value = v.valuesByMode[modeId];
    if (value && typeof value === 'object' && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS') {
      const aliased = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
      return aliased ? resolveVariableColor(aliased, depth + 1) : null;
    }
    if (value && typeof value === 'object' && 'r' in value) {
      const c = value as RGBA;
      return { r: c.r, g: c.g, b: c.b };
    }
  } catch {
    /* unresolved → no swatch */
  }
  return null;
}

/** Resolve a token name to its swatch color, or null if it isn't a known color. */
export async function resolveTokenColor(token: string): Promise<RGB | null> {
  const map = await loadColorVars();
  const v = map.get(token);
  return v ? resolveVariableColor(v) : null;
}

// Local FLOAT variables, loaded once, keyed by full name — mirrors the color
// cache. Used to append a resolved-number suffix (e.g. "· 12") to bound tokens
// that carry no color swatch. Best-effort: any failure yields no suffix.
let floatVarCache: Map<string, Variable> | null = null;

async function loadFloatVars(): Promise<Map<string, Variable>> {
  if (floatVarCache) return floatVarCache;
  const map = new Map<string, Variable>();
  try {
    const vars = await figma.variables.getLocalVariablesAsync('FLOAT');
    for (const v of vars) map.set(v.name, v);
  } catch {
    /* variables API unavailable — no suffixes */
  }
  floatVarCache = map;
  return map;
}

/** Resolve a FLOAT variable to its default-mode number, chasing aliases up to
 *  4 levels — mirrors resolveVariableColor exactly. */
async function resolveVariableNumber(v: Variable, depth = 0): Promise<number | null> {
  if (depth > 4) return null;
  try {
    const collection = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    const modeId = collection?.defaultModeId;
    if (!modeId) return null;
    const value = v.valuesByMode[modeId];
    if (value && typeof value === 'object' && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS') {
      const aliased = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
      return aliased ? resolveVariableNumber(aliased, depth + 1) : null;
    }
    if (typeof value === 'number') return value;
  } catch {
    /* unresolved → no suffix */
  }
  return null;
}

/** Resolve a token name to its default-mode number, or null if it isn't a
 *  known FLOAT token. */
export async function resolveTokenNumber(token: string): Promise<number | null> {
  const map = await loadFloatVars();
  const v = map.get(token);
  return v ? resolveVariableNumber(v) : null;
}

// Local text styles, loaded once, keyed by name — used to append a typography
// suffix (family / style / size) to a token matching a text style.
let textStyleCache: Map<string, TextStyle> | null = null;

async function loadTextStyles(): Promise<Map<string, TextStyle>> {
  if (textStyleCache) return textStyleCache;
  const map = new Map<string, TextStyle>();
  try {
    const styles = await figma.getLocalTextStylesAsync();
    for (const s of styles) map.set(s.name, s);
  } catch {
    /* text styles API unavailable — no suffixes */
  }
  textStyleCache = map;
  return map;
}

/** Resolve a token name to a "family style size" summary for a matching text
 *  style, or null. Best-effort: mixed fontName/fontSize or any throw → null. */
export async function resolveTokenTypography(token: string): Promise<string | null> {
  try {
    const map = await loadTextStyles();
    const style = map.get(token);
    if (!style) return null;
    const fontName = style.fontName;
    if (typeof fontName !== 'object' || !('family' in fontName)) return null;
    if (typeof style.fontSize !== 'number') return null;
    return `${fontName.family} ${fontName.style} ${style.fontSize}`;
  } catch {
    return null;
  }
}

/** Null out every resolved-value cache. Called at the top of each doc-frame
 *  build so a rebuild after the user edits variables/text styles resolves
 *  fresh values instead of stale, previously-cached ones. */
export function resetTokenResolveCaches(): void {
  colorVarCache = null;
  floatVarCache = null;
  textStyleCache = null;
}

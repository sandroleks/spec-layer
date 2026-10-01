/// <reference types="@figma/plugin-typings" />
import { collectionById } from './frameKit';

// Token names to swatch colours, numbers or typography summaries for docFrame's
// chips. Each lookup is a bridge round trip and a doc repeats the same tokens
// in every variant card, so answers are cached per build
// (resetTokenResolveCaches; collections through frameKit's per-build cache).

// Drop any name that appears more than once: a spec token has no collection
// context, so resolving an ambiguous name would be a confident guess.
function indexByUniqueName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const it of items) {
    if (ambiguous.has(it.name)) continue;
    if (map.has(it.name)) { map.delete(it.name); ambiguous.add(it.name); }
    else map.set(it.name, it);
  }
  return map;
}

/** One list read, indexed by unique name. A failed read is an empty index. */
function loadIndex<T extends { name: string }>(read: () => Promise<readonly T[]>): Promise<Map<string, T>> {
  return Promise.resolve().then(read).then(indexByUniqueName, () => new Map<string, T>());
}

let colorVars: Promise<Map<string, Variable>> | null = null;
let floatVars: Promise<Map<string, Variable>> | null = null;
let textStyles: Promise<Map<string, TextStyle>> | null = null;
let variableReads = new Map<string, Promise<Variable | null>>();
let displayByToken = new Map<string, Promise<TokenDisplay>>();

function variableById(id: string): Promise<Variable | null> {
  let hit = variableReads.get(id);
  if (!hit) {
    hit = Promise.resolve()
      .then(() => figma.variables.getVariableByIdAsync(id))
      .catch((): Variable | null => null);
    variableReads.set(id, hit);
  }
  return hit;
}

function isAlias(value: VariableValue | undefined): value is VariableAlias {
  return Boolean(value && typeof value === 'object' && 'type' in value
    && (value as VariableAlias).type === 'VARIABLE_ALIAS');
}

/**
 * A variable's default-mode value, chasing aliases up to 4 levels, through
 * `pick` (null when the value is not the kind asked for). The reads it makes
 * are cached; the answer is not, because it depends on where the chain began.
 */
async function resolveVariable<T>(
  v: Variable,
  pick: (value: VariableValue | undefined) => T | null,
  depth = 0,
): Promise<T | null> {
  if (depth > 4) return null;
  try {
    const collection = await collectionById(v.variableCollectionId);
    const modeId = collection?.defaultModeId;
    if (!modeId) return null;
    const value = v.valuesByMode[modeId];
    if (isAlias(value)) {
      const aliased = await variableById(value.id);
      return aliased ? resolveVariable(aliased, pick, depth + 1) : null;
    }
    return pick(value);
  } catch {
    return null;
  }
}

const pickColor = (value: VariableValue | undefined): RGB | null => {
  if (!value || typeof value !== 'object' || !('r' in value)) return null;
  const c = value as RGBA;
  return { r: c.r, g: c.g, b: c.b };
};

const pickNumber = (value: VariableValue | undefined): number | null =>
  typeof value === 'number' ? value : null;

/** Resolve a token name to its swatch color, or null if it isn't a known color. */
export async function resolveTokenColor(token: string): Promise<RGB | null> {
  colorVars ??= loadIndex(() => figma.variables.getLocalVariablesAsync('COLOR'));
  const v = (await colorVars).get(token);
  return v ? resolveVariable(v, pickColor) : null;
}

/** Resolve a token name to its default-mode number, or null if it isn't a
 *  known FLOAT token. */
export async function resolveTokenNumber(token: string): Promise<number | null> {
  floatVars ??= loadIndex(() => figma.variables.getLocalVariablesAsync('FLOAT'));
  const v = (await floatVars).get(token);
  return v ? resolveVariable(v, pickNumber) : null;
}

/** Resolve a token name to a "family style size" summary for a matching text
 *  style, or null. Best-effort: mixed fontName/fontSize or any throw → null. */
export async function resolveTokenTypography(token: string): Promise<string | null> {
  try {
    textStyles ??= loadIndex(() => figma.getLocalTextStylesAsync());
    const style = (await textStyles).get(token);
    if (!style) return null;
    const fontName = style.fontName;
    if (typeof fontName !== 'object' || !('family' in fontName)) return null;
    if (typeof style.fontSize !== 'number') return null;
    return `${fontName.family} ${fontName.style} ${style.fontSize}`;
  } catch {
    return null;
  }
}

/** What a bound token's chip shows: a swatch, or else a muted value suffix. */
export interface TokenDisplay {
  color: RGB | null;
  suffix: string | null;
}

/**
 * The swatch, or the resolved number or text-style summary when there is no
 * swatch, for one bound token. Cached per token for the build, so a token in
 * every variant card resolves once.
 */
export function resolveTokenDisplay(token: string): Promise<TokenDisplay> {
  let hit = displayByToken.get(token);
  if (!hit) {
    hit = (async (): Promise<TokenDisplay> => {
      const color = await resolveTokenColor(token);
      if (color) return { color, suffix: null };
      const n = await resolveTokenNumber(token);
      if (n !== null) return { color: null, suffix: `· ${n}` };
      const typo = await resolveTokenTypography(token);
      return { color: null, suffix: typo ? `· ${typo}` : null };
    })();
    displayByToken.set(token, hit);
  }
  return hit;
}

/** Called at the top of each doc-frame build, so edited variables and text
 *  styles resolve fresh. */
export function resetTokenResolveCaches(): void {
  colorVars = null;
  floatVars = null;
  textStyles = null;
  variableReads = new Map();
  displayByToken = new Map();
}

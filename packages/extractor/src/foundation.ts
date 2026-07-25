/**
 * foundation.ts — the pure, Figma-free model for the file's design foundation:
 * variable collections (with modes and alias chains) and text styles.
 *
 * Mirrors the serialize.ts → extract.ts boundary used for components. The
 * plugin dumps raw Figma data (aliases left as {type,id}); everything here is
 * synchronous and fixture-testable, including alias resolution.
 */

// ---------------------------------------------------------------------------
// Raw dump — produced by packages/plugin/src/serializeFoundation.ts
// ---------------------------------------------------------------------------

export interface RawVariableAlias { type: 'VARIABLE_ALIAS'; id: string }
export interface RawRGBA { r: number; g: number; b: number; a: number }
export type RawVariableValue = RawRGBA | number | string | boolean | RawVariableAlias;

export type FoundationVariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface RawVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
}

export interface RawCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: RawVariable[];
}

export interface RawTextStyle {
  name: string;
  description: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: { unit: 'AUTO' | 'PIXELS' | 'PERCENT'; value?: number };
  letterSpacing: { unit: 'PIXELS' | 'PERCENT'; value: number };
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
  boundVariables: Record<string, string>;
}

/** An alias target that lives in a library, not in this file's local dump. */
export interface RawExternalRef { id: string; name: string; collectionName: string }

export interface SerializedFoundation {
  fileKey: string;
  collections: RawCollection[];
  textStyles: RawTextStyle[];
  externals: RawExternalRef[];
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Resolved model
// ---------------------------------------------------------------------------

export interface FoundationMode { modeId: string; name: string }

export type FoundationValue =
  | { kind: 'color'; hex: string; alpha: number }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'alias'; targetName: string; targetCollection: string;
      external: boolean; resolved: FoundationValue | null }
  | { kind: 'unresolved'; reason: 'cycle' | 'missing' | 'external' | 'depth' };

export interface FoundationVariable {
  name: string;
  group: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FoundationValue>;
}

export interface FoundationCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: FoundationVariable[];
}

export interface FoundationTextStyle extends RawTextStyle { group: string }

export interface FoundationSpec {
  fileKey: string;
  collections: FoundationCollection[];
  textStyles: FoundationTextStyle[];
  extractedAt: string;
}

export type FoundationScope =
  | { target: 'collection'; collectionId: string; collectionName: string;
      group?: string; modeIds: string[] }
  | { target: 'textStyles'; group?: string };

/** Rows per output unit, above which a unit splits by top-level group. */
export const SPLIT_THRESHOLD = 150;
/** Hard ceiling on rendered mode columns. */
export const MAX_MODE_COLUMNS = 4;
/** Alias chain depth ceiling, matching resolveVariableColor in tokenResolve.ts. */
const MAX_ALIAS_DEPTH = 4;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Top-level path segment. "color/bg/brand" → "color"; "standalone" → itself. */
export function groupOf(name: string): string {
  const i = name.indexOf('/');
  return i <= 0 ? name : name.slice(0, i);
}

function hex2(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
}

function isAlias(v: RawVariableValue): v is RawVariableAlias {
  return typeof v === 'object' && v !== null && (v as RawVariableAlias).type === 'VARIABLE_ALIAS';
}

function isRgba(v: RawVariableValue): v is RawRGBA {
  return typeof v === 'object' && v !== null && 'r' in v;
}

/** Convert one non-alias raw value. Returns null when the shape is unusable. */
function plainValue(raw: RawVariableValue): FoundationValue | null {
  if (isRgba(raw)) {
    return { kind: 'color', hex: `#${hex2(raw.r)}${hex2(raw.g)}${hex2(raw.b)}`, alpha: raw.a };
  }
  if (typeof raw === 'number') return { kind: 'number', value: raw };
  if (typeof raw === 'string') return { kind: 'string', value: raw };
  if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
  return null;
}

interface VarIndexEntry { variable: RawVariable; collection: RawCollection }

function indexVariables(dump: SerializedFoundation): Map<string, VarIndexEntry> {
  const map = new Map<string, VarIndexEntry>();
  for (const collection of dump.collections) {
    for (const variable of collection.variables) {
      map.set(variable.id, { variable, collection });
    }
  }
  return map;
}

export function buildFoundation(dump: SerializedFoundation): FoundationSpec {
  const index = indexVariables(dump);
  const externals = new Map(dump.externals.map((e) => [e.id, e]));

  const collections: FoundationCollection[] = dump.collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    defaultModeId: collection.defaultModeId,
    variables: collection.variables.map((variable) => {
      const valuesByMode: Record<string, FoundationValue> = {};
      for (const mode of collection.modes) {
        valuesByMode[mode.modeId] = resolveValue(
          variable.valuesByMode[mode.modeId], mode.name, index, externals, new Set([variable.id]), 0,
        );
      }
      return {
        name: variable.name,
        group: groupOf(variable.name),
        resolvedType: variable.resolvedType,
        description: variable.description,
        codeSyntax: variable.codeSyntax,
        valuesByMode,
      };
    }),
  }));

  return {
    fileKey: dump.fileKey,
    collections,
    textStyles: dump.textStyles.map((s) => ({ ...s, group: groupOf(s.name) })),
    extractedAt: dump.extractedAt,
  };
}

/** Pick the target collection's mode id: name match on the source mode, else default. */
function targetModeId(collection: RawCollection, sourceModeName: string): string {
  const named = collection.modes.find((m) => m.name === sourceModeName);
  return named ? named.modeId : collection.defaultModeId;
}

function resolveValue(
  raw: RawVariableValue | undefined,
  modeName: string,
  index: Map<string, VarIndexEntry>,
  externals: Map<string, RawExternalRef>,
  seen: Set<string>,
  depth: number,
): FoundationValue {
  if (raw === undefined) return { kind: 'unresolved', reason: 'missing' };

  if (!isAlias(raw)) {
    const plain = plainValue(raw);
    return plain ?? { kind: 'unresolved', reason: 'missing' };
  }

  const local = index.get(raw.id);

  if (!local) {
    const ext = externals.get(raw.id);
    if (!ext) return { kind: 'unresolved', reason: 'missing' };
    return {
      kind: 'alias', targetName: ext.name, targetCollection: ext.collectionName,
      external: true, resolved: null,
    };
  }

  const head = {
    kind: 'alias' as const,
    targetName: local.variable.name,
    targetCollection: local.collection.name,
    external: false,
  };

  if (seen.has(raw.id)) return { ...head, resolved: { kind: 'unresolved', reason: 'cycle' } };
  if (depth >= MAX_ALIAS_DEPTH) return { ...head, resolved: { kind: 'unresolved', reason: 'depth' } };

  const nextModeId = targetModeId(local.collection, modeName);
  const nextModeName = local.collection.modes.find((m) => m.modeId === nextModeId)?.name ?? modeName;
  const inner = resolveValue(
    local.variable.valuesByMode[nextModeId], nextModeName, index, externals,
    new Set([...seen, raw.id]), depth + 1,
  );

  // Collapse a chain to one visible hop: the reader sees the immediate target
  // name and the final value. Intermediate hops are an implementation detail of
  // the file's own indirection, not something the doc should enumerate.
  const resolved = inner.kind === 'alias' ? inner.resolved : inner;
  return { ...head, resolved };
}

/**
 * foundation.ts: the pure model for the file's design foundation: variable
 * collections (with modes and alias chains) and text styles. The plugin dumps
 * raw Figma data (aliases left as {type,id}); everything here, alias resolution
 * included, is synchronous and fixture-testable.
 */
import type { EffectLayer } from './effects';
import type { RawEasing } from './motion';
import { canonicalColor } from './v5/color';
import { compareCodeUnits } from './v5/diagnostics';
import { canonicalNumber } from './v5/precision';

// ---------------------------------------------------------------------------
// Raw dump, produced by packages/plugin/src/serializeFoundation.ts
// ---------------------------------------------------------------------------

export interface RawVariableAlias { type: 'VARIABLE_ALIAS'; id: string }
export interface RawRGBA { r: number; g: number; b: number; a: number }
/** An EASING variable's value is a RawEasing; isAlias and isRgba stay exclusive
 *  with it because it has neither `type: 'VARIABLE_ALIAS'` nor an `r`. */
export type RawVariableValue = RawRGBA | number | string | boolean | RawVariableAlias | RawEasing;

/** Figma's resolved types since Plugin API update 133 (EASING, TIMING). */
export type FoundationVariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'EASING' | 'TIMING';
export type FoundationPublishStatus = 'UNPUBLISHED' | 'CURRENT' | 'CHANGED';

/** Publication facts Figma exposes. `publishStatus` is null when the async read
 * failed or was skipped; hidden/remote stay usable facts. */
export interface RawPublicationMetadata {
  hiddenFromPublishing: boolean;
  publishStatus: FoundationPublishStatus | null;
  remote: boolean;
}

export interface RawVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
  /** Figma's source scopes, in source order. Optional only for legacy injected
   *  dumps captured before the direct-v5 extraction path. */
  scopes?: string[];
  publication?: RawPublicationMetadata;
}

export interface RawCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: RawVariable[];
  /** Complete source inventory, including variables whose read failed.
   *  Optional only for legacy injected dumps. */
  variableIds?: string[];
  publication?: RawPublicationMetadata;
}

export interface RawTextStyle {
  /** Stable Figma style id. Optional only for legacy dumps (before Foundation Context v5 Phase 3). */
  id?: string;
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
  /** Exact source binding ids beside the legacy name projection above. */
  bindingIds?: Record<string, string>;
  /** Styles expose remote and publish status, but not a
   * hidden-from-publishing flag, so they cannot truthfully populate the v5
   * `publication` pair. */
  source?: { remote: boolean; publishStatus: FoundationPublishStatus | null };
}

/**
 * One effect style, layers already in the shared EffectLayer union. Exact source
 * binding ids sit in `bindings`, beside that projection, so the export joins by
 * stable identity without changing older YAML or canvas hashes.
 */
export interface RawEffectStyle {
  /** Stable Figma style id. Optional only for legacy injected dumps. */
  id?: string;
  name: string;
  description: string;
  effects: EffectLayer[];
  /** Exact layer/property -> variable relationships. */
  bindings?: Array<{ property: string; tokenId: string }>;
  source?: { remote: boolean; publishStatus: FoundationPublishStatus | null };
}

/** An alias target outside this file's declared local inventory. */
export interface RawExternalRef {
  id: string;
  name: string | null;
  collectionId: string | null;
  collectionName: string | null;
  remote: boolean | null;
  external: true;
}

/** One read serializeFoundation performs. Named so a failure can be reported as
 *  a fact rather than inferred from an empty result. */
export type FoundationRead = 'variables' | 'textStyles' | 'effectStyles';

export interface SerializedFoundation {
  fileKey: string;
  fileName?: string;
  collections: RawCollection[];
  textStyles: RawTextStyle[];
  effectStyles: RawEffectStyle[];
  externals: RawExternalRef[];
  extractedAt: string;
  /**
   * Which reads failed; absent on a clean read, never `[]`. serializeFoundation
   * returns an empty foundation on failure, so this is what tells it from a file
   * with no variables (the `unavailable` resolution status).
   */
  unavailable?: FoundationRead[];
  /** Stable source ids/names that could not be read. Absent on a complete
   *  read, never an empty array. */
  unavailableSources?: string[];
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

export interface FoundationResolutionStep { tokenId: string; modeId: string }

export type FoundationProvenanceLiteral =
  | { kind: 'color'; hex: string; alpha: number; channels?: [number, number, number] }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean };

export type FoundationUnresolvedReason =
  | 'cycle' | 'missing' | 'external' | 'depth' | 'type_mismatch'
  | 'target_mode_unresolvable' | 'target_mode_value_missing'
  | 'invalid_source_value';

export type FoundationProvenanceValue =
  | FoundationProvenanceLiteral
  | {
      kind: 'alias';
      targetId: string;
      targetName: string;
      targetPath: string[];
      targetCollectionId: string | null;
      targetCollection: string;
      external: boolean;
      resolved: FoundationProvenanceLiteral
        | { kind: 'unresolved'; reason: FoundationUnresolvedReason }
        | null;
      chain: FoundationResolutionStep[];
    }
  | { kind: 'unresolved'; reason: FoundationUnresolvedReason };

export interface FoundationVariableProvenance {
  id: string;
  scopes: string[];
  valuesByMode: Record<string, FoundationProvenanceValue>;
  staleModeIds: string[];
}

export interface FoundationSourceIssue {
  kind: 'stale_mode_value';
  collectionId: string;
  tokenId: string;
  modeId: string;
  declaredModeIds: string[];
}

export interface FoundationVariable {
  name: string;
  group: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FoundationValue>;
  provenance: FoundationVariableProvenance;
  publication?: RawPublicationMetadata;
}

export interface FoundationCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: FoundationVariable[];
  publication?: RawPublicationMetadata;
}

export interface FoundationTextStyle extends RawTextStyle { group: string }

export interface FoundationEffectStyle extends RawEffectStyle { group: string }

export interface FoundationSpec {
  fileKey: string;
  fileName?: string;
  collections: FoundationCollection[];
  textStyles: FoundationTextStyle[];
  effectStyles: FoundationEffectStyle[];
  extractedAt: string;
  /** Carried straight through from the dump. See SerializedFoundation. */
  unavailable?: FoundationRead[];
  unavailableSources?: string[];
  sourceIssues?: FoundationSourceIssue[];
}

export type FoundationScope =
  | { target: 'collection'; collectionId: string; collectionName: string;
      group?: string; modeIds: string[] }
  | { target: 'textStyles'; group?: string }
  | { target: 'effectStyles'; group?: string };

/** Rows per output unit, above which a unit splits by top-level group. */
export const SPLIT_THRESHOLD = 150;
/** Hard ceiling on rendered mode columns. */
export const MAX_MODE_COLUMNS = 4;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Top-level path segment ("color/bg/brand" → "color"): the SPLIT key dividing a
 * large collection into documents. `folderOf` is the finer BLOCK key that groups
 * one document's rows.
 */
export function groupOf(name: string): string {
  const i = name.indexOf('/');
  return i <= 0 ? name : name.slice(0, i);
}

/**
 * A variable's folder, its name minus the leaf ("color/surface/primary/light" →
 * "color/surface/primary"), as Figma's variables panel shows it. '' for no
 * folder, drawn without a heading. The immediate parent, not a fixed depth,
 * since sets nest arbitrarily.
 */
export function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i <= 0 ? '' : name.slice(0, i);
}

/** Capitalize the first character only, so "iOS" and "light-press" survive. */
function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

function segmentsOf(folder: string): string[] {
  return folder.split('/').filter(Boolean);
}

/** The last `depth` segments of a folder, capitalized: "Surface", "Color / Surface". */
function titleAtDepth(folder: string, depth: number): string {
  const parts = segmentsOf(folder);
  return parts.slice(Math.max(parts.length - depth, 0)).map(capitalize).join(' / ');
}

/** A block's heading: the final folder segment, capitalized ("colors/blue" reads "Blue"). */
export function groupTitle(folder: string): string {
  return titleAtDepth(folder, 1);
}

/**
 * Titles for one document's groups. When two would collide ("color/surface",
 * "brand/surface"), every title takes one more segment, so the set stays
 * uniform. Same order as `folders`.
 */
export function groupTitles(folders: string[]): string[] {
  const maxDepth = Math.max(1, ...folders.map((f) => segmentsOf(f).length));
  let depth = 1;
  let titles = folders.map((f) => titleAtDepth(f, depth));
  while (depth < maxDepth && new Set(titles).size < titles.length) {
    depth += 1;
    titles = folders.map((f) => titleAtDepth(f, depth));
  }
  return titles;
}

/** One titled block of rows within a document. */
export interface FoundationRowGroup<T extends { name: string } = FoundationVariableRow> {
  /** The shared folder path, or '' for rows that sit at the root. */
  folder: string;
  rows: T[];
}

/**
 * Group rows by folder in first-appearance order, keeping row order. Shared,
 * because the frame builder and the AI description pass (keyed by folder) must
 * group identically or a description lands on the wrong block.
 */
export function groupRowsByFolder<T extends { name: string }>(rows: T[]): FoundationRowGroup<T>[] {
  const groups: FoundationRowGroup<T>[] = [];
  const byFolder = new Map<string, FoundationRowGroup<T>>();
  for (const row of rows) {
    const folder = folderOf(row.name);
    const existing = byFolder.get(folder);
    if (existing) {
      existing.rows.push(row);
    } else {
      const group: FoundationRowGroup<T> = { folder, rows: [row] };
      byFolder.set(folder, group);
      groups.push(group);
    }
  }
  return groups;
}

function isAlias(v: RawVariableValue): v is RawVariableAlias {
  return typeof v === 'object' && v !== null && (v as RawVariableAlias).type === 'VARIABLE_ALIAS';
}

function isRgba(v: RawVariableValue): v is RawRGBA {
  return typeof v === 'object' && v !== null && 'r' in v;
}

/** Convert one non-alias source value without losing source precision. */
function provenanceLiteral(raw: RawVariableValue): FoundationProvenanceValue {
  if (isRgba(raw)) {
    const color = canonicalColor(raw);
    if (!color.ok) return { kind: 'unresolved', reason: 'invalid_source_value' };
    return {
      kind: 'color', hex: color.value.hex, alpha: color.value.alpha,
      ...(color.value.channels ? { channels: color.value.channels } : {}),
    };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'number', value: canonicalNumber(raw) }
      : { kind: 'unresolved', reason: 'invalid_source_value' };
  }
  if (typeof raw === 'string') return { kind: 'string', value: raw };
  if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
  return { kind: 'unresolved', reason: 'invalid_source_value' };
}

interface VarIndexEntry { variable: RawVariable; collection: RawCollection }

function indexVariables(dump: SerializedFoundation): Map<string, VarIndexEntry> {
  const map = new Map<string, VarIndexEntry>();
  for (const collection of dump.collections) {
    for (const variable of collection.variables) {
      // Keep the first declaration: the v5 exporter diagnoses duplicates, and
      // taking the last would let source order change the resolved graph.
      if (!map.has(variable.id)) map.set(variable.id, { variable, collection });
    }
  }
  return map;
}

const pairKey = (tokenId: string, modeId: string): string =>
  JSON.stringify([tokenId, modeId]);

type ProvenanceAlias = Extract<FoundationProvenanceValue, { kind: 'alias' }>;
type ProvenanceResolved = ProvenanceAlias['resolved'];

type AliasHead = Omit<ProvenanceAlias, 'resolved' | 'chain'>;

interface PendingAlias {
  key: string;
  head: AliasHead;
  step: FoundationResolutionStep;
  targetReadable: boolean;
}

function pathOf(name: string): string[] {
  return name.split('/');
}

/** Select the target mode once, for both provenance and the legacy projection.
 *  A duplicate exact-name match is ambiguous and therefore unresolved. */
function targetModeId(
  sourceCollection: RawCollection,
  sourceModeId: string,
  targetCollection: RawCollection,
): string | undefined {
  if (sourceCollection.id === targetCollection.id) {
    return targetCollection.modes.some((mode) => mode.modeId === sourceModeId)
      ? sourceModeId
      : undefined;
  }
  const sourceMode = sourceCollection.modes.find((mode) => mode.modeId === sourceModeId);
  if (!sourceMode) return undefined;
  const exact = targetCollection.modes.filter((mode) => mode.name === sourceMode.name);
  if (exact.length === 1) return exact[0].modeId;
  if (exact.length > 1) return undefined;
  return targetCollection.modes.some((mode) => mode.modeId === targetCollection.defaultModeId)
    ? targetCollection.defaultModeId
    : undefined;
}

function terminalOf(value: FoundationProvenanceValue): {
  resolved: Exclude<ProvenanceResolved, null>;
  chain: FoundationResolutionStep[];
} {
  if (value.kind !== 'alias') return { resolved: value, chain: [] };
  return {
    resolved: value.resolved ?? { kind: 'unresolved', reason: 'external' },
    chain: value.chain,
  };
}

function aliasFromTarget(
  edge: PendingAlias,
  targetValue: FoundationProvenanceValue,
): ProvenanceAlias {
  const terminal = terminalOf(targetValue);
  let resolved = terminal.resolved;
  if (
    resolved.kind === 'unresolved'
    && resolved.reason === 'missing'
    && edge.targetReadable
  ) {
    resolved = { kind: 'unresolved', reason: 'target_mode_value_missing' };
  }
  return {
    ...edge.head,
    resolved,
    chain: [edge.step, ...terminal.chain],
  };
}

function legacyValueOf(value: FoundationProvenanceValue): FoundationValue {
  switch (value.kind) {
    case 'color': return { kind: 'color', hex: value.hex, alpha: value.alpha };
    case 'number': return { kind: 'number', value: value.value };
    case 'string': return { kind: 'string', value: value.value };
    case 'boolean': return { kind: 'boolean', value: value.value };
    case 'unresolved': {
      const reason = value.reason === 'cycle' || value.reason === 'depth'
        || value.reason === 'external'
        ? value.reason
        : 'missing';
      return { kind: 'unresolved', reason };
    }
    case 'alias':
      // An unreadable or missing target keeps the bare missing shape for
      // render/v4; provenance keeps the full alias identity.
      if (value.resolved?.kind === 'unresolved' && value.resolved.reason === 'missing') {
        return { kind: 'unresolved', reason: 'missing' };
      }
      return {
        kind: 'alias',
        targetName: value.targetName,
        targetCollection: value.targetCollection,
        external: value.external,
        resolved: value.resolved === null ? null : legacyValueOf(value.resolved),
      };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function applyDepthLimit(
  value: FoundationProvenanceValue,
  maxAliasDepth: number,
): FoundationProvenanceValue {
  if (value.kind !== 'alias' || value.chain.length <= maxAliasDepth) return value;
  return {
    ...value,
    resolved: { kind: 'unresolved', reason: 'depth' },
    chain: value.chain.slice(0, maxAliasDepth),
  };
}

export interface BuildFoundationOptions { maxAliasDepth?: number }

export function buildFoundation(
  dump: SerializedFoundation,
  options: BuildFoundationOptions = {},
): FoundationSpec {
  const index = indexVariables(dump);
  const externals = new Map(dump.externals.map((external) => [external.id, external]));
  const declaredOwners = new Map<string, RawCollection>();
  for (const collection of dump.collections) {
    const declaredIds = collection.variableIds
      ?? collection.variables.map((variable) => variable.id);
    for (const id of declaredIds) {
      if (!declaredOwners.has(id)) declaredOwners.set(id, collection);
    }
  }

  const pairCount = dump.collections.reduce(
    (count, collection) => count + collection.variables.length * collection.modes.length,
    0,
  );
  const maxAliasDepth = options.maxAliasDepth ?? Math.max(1, pairCount + 1);
  if (!Number.isInteger(maxAliasDepth) || maxAliasDepth <= 0) {
    throw new RangeError('maxAliasDepth must be a positive integer.');
  }

  const memo = new Map<string, FoundationProvenanceValue>();

  const finishPath = (
    path: PendingAlias[], terminal: FoundationProvenanceValue,
  ): FoundationProvenanceValue => {
    let suffix = terminal;
    for (let i = path.length - 1; i >= 0; i--) {
      const resolved = aliasFromTarget(path[i], suffix);
      memo.set(path[i].key, resolved);
      suffix = resolved;
    }
    return suffix;
  };

  const resolvePair = (start: VarIndexEntry, startModeId: string): FoundationProvenanceValue => {
    const startKey = pairKey(start.variable.id, startModeId);
    const cached = memo.get(startKey);
    if (cached) return cached;

    const path: PendingAlias[] = [];
    const pathIndex = new Map<string, number>();
    let current = start;
    let currentModeId = startModeId;

    while (true) {
      const key = pairKey(current.variable.id, currentModeId);
      const cachedCurrent = memo.get(key);
      if (cachedCurrent) return finishPath(path, cachedCurrent);

      const cycleAt = pathIndex.get(key);
      if (cycleAt !== undefined) {
        const cycleResult = { kind: 'unresolved', reason: 'cycle' } as const;
        for (let i = cycleAt; i < path.length; i++) {
          const rotated = [
            ...path.slice(i), ...path.slice(cycleAt, i),
          ].map((edge) => edge.step);
          memo.set(path[i].key, {
            ...path[i].head,
            resolved: cycleResult,
            chain: rotated,
          });
        }
        let suffix = memo.get(path[cycleAt].key)!;
        for (let i = cycleAt - 1; i >= 0; i--) {
          suffix = aliasFromTarget(path[i], suffix);
          memo.set(path[i].key, suffix);
        }
        return memo.get(startKey)!;
      }

      const raw = current.variable.valuesByMode[currentModeId];
      if (raw === undefined) {
        const missing = { kind: 'unresolved', reason: 'missing' } as const;
        memo.set(key, missing);
        return finishPath(path, missing);
      }
      if (!isAlias(raw)) {
        const literal = provenanceLiteral(raw);
        memo.set(key, literal);
        return finishPath(path, literal);
      }

      const declaredCollection = declaredOwners.get(raw.id);
      const external = declaredCollection === undefined ? externals.get(raw.id) : undefined;
      if (external) {
        const externalAlias: ProvenanceAlias = {
          kind: 'alias',
          targetId: raw.id,
          targetName: external.name ?? raw.id,
          targetPath: external.name ? pathOf(external.name) : [raw.id],
          targetCollectionId: external.collectionId,
          targetCollection: external.collectionName ?? '',
          external: true,
          resolved: null,
          chain: [],
        };
        memo.set(key, externalAlias);
        return finishPath(path, externalAlias);
      }

      if (!declaredCollection) {
        const missingAlias: ProvenanceAlias = {
          kind: 'alias', targetId: raw.id, targetName: raw.id, targetPath: [raw.id],
          targetCollectionId: null, targetCollection: '', external: false,
          resolved: { kind: 'unresolved', reason: 'missing' }, chain: [],
        };
        memo.set(key, missingAlias);
        return finishPath(path, missingAlias);
      }

      const target = index.get(raw.id);
      const targetMode = targetModeId(current.collection, currentModeId, declaredCollection);
      const head: AliasHead = {
        kind: 'alias',
        targetId: raw.id,
        targetName: target?.variable.name ?? raw.id,
        targetPath: target ? pathOf(target.variable.name) : [raw.id],
        targetCollectionId: declaredCollection.id,
        targetCollection: declaredCollection.name,
        external: false,
      };
      if (targetMode === undefined) {
        const unresolved: ProvenanceAlias = {
          ...head,
          resolved: { kind: 'unresolved', reason: 'target_mode_unresolvable' },
          chain: [],
        };
        memo.set(key, unresolved);
        return finishPath(path, unresolved);
      }

      const step = { tokenId: raw.id, modeId: targetMode };
      if (!target) {
        const unreadable: ProvenanceAlias = {
          ...head,
          resolved: { kind: 'unresolved', reason: 'missing' },
          chain: [step],
        };
        memo.set(key, unreadable);
        return finishPath(path, unreadable);
      }
      if (current.variable.resolvedType !== target.variable.resolvedType) {
        const mismatch: ProvenanceAlias = {
          ...head,
          resolved: { kind: 'unresolved', reason: 'type_mismatch' },
          chain: [step],
        };
        memo.set(key, mismatch);
        return finishPath(path, mismatch);
      }

      pathIndex.set(key, path.length);
      path.push({
        key,
        head,
        step,
        targetReadable: true,
      });
      current = target;
      currentModeId = targetMode;
    }
  };

  const sourceIssues: FoundationSourceIssue[] = [];
  const collections: FoundationCollection[] = dump.collections.map((collection) => {
    const declaredModeIds = collection.modes.map((mode) => mode.modeId);
    const declaredModes = new Set(declaredModeIds);
    return {
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
      defaultModeId: collection.defaultModeId,
      variables: collection.variables.map((variable) => {
        const staleModeIds = Object.keys(variable.valuesByMode)
          .filter((modeId) => !declaredModes.has(modeId))
          .sort(compareCodeUnits);
        for (const modeId of staleModeIds) {
          sourceIssues.push({
            kind: 'stale_mode_value', collectionId: collection.id,
            tokenId: variable.id, modeId, declaredModeIds: [...declaredModeIds],
          });
        }
        const provenanceValues: Record<string, FoundationProvenanceValue> = {};
        const valuesByMode: Record<string, FoundationValue> = {};
        const entry = index.get(variable.id) ?? { variable, collection };
        for (const mode of collection.modes) {
          const full = resolvePair(entry, mode.modeId);
          const provenance = applyDepthLimit(full, maxAliasDepth);
          provenanceValues[mode.modeId] = provenance;
          valuesByMode[mode.modeId] = legacyValueOf(provenance);
        }
        return {
          name: variable.name,
          group: groupOf(variable.name),
          resolvedType: variable.resolvedType,
          description: variable.description,
          codeSyntax: variable.codeSyntax,
          valuesByMode,
          provenance: {
            id: variable.id,
            scopes: [...(variable.scopes ?? [])],
            valuesByMode: provenanceValues,
            staleModeIds,
          },
          ...(variable.publication ? { publication: variable.publication } : {}),
        };
      }),
      ...(collection.publication ? { publication: collection.publication } : {}),
    };
  });

  return {
    fileKey: dump.fileKey,
    ...(dump.fileName !== undefined ? { fileName: dump.fileName } : {}),
    collections,
    textStyles: dump.textStyles.map((style) => ({ ...style, group: groupOf(style.name) })),
    effectStyles: dump.effectStyles.map((style) => ({ ...style, group: groupOf(style.name) })),
    extractedAt: dump.extractedAt,
    ...(dump.unavailable ? { unavailable: dump.unavailable } : {}),
    ...(dump.unavailableSources ? { unavailableSources: dump.unavailableSources } : {}),
    ...(sourceIssues.length > 0 ? { sourceIssues } : {}),
  };
}

// ---------------------------------------------------------------------------
// Unit planning
// ---------------------------------------------------------------------------

export interface FoundationSelection {
  /** Collections the user chose, with the mode ids they chose for each. */
  collections: { collectionId: string; modeIds: string[] }[];
  textStyles: boolean;
  effectStyles: boolean;
}

export interface FoundationUnit {
  scope: FoundationScope;
  /** Frame/document title: "Semantic", "Primitives · color", "Text styles". */
  title: string;
  rowCount: number;
  /** Mode names present in the collection but not rendered, for the footer note. */
  omittedModeNames: string[];
}

/** The one place the title format lives: "Semantic", "Primitives · color". */
function titleOf(base: string, group?: string): string {
  return group ? `${base} · ${group}` : base;
}

/** Titles for the style units, which have no collection to name. */
const TEXT_STYLES_TITLE = 'Text styles';
const EFFECT_STYLES_TITLE = 'Effect styles';

/**
 * One unit's document title, from its scope and rendered content. Planning, the
 * renderer, and single-doc update all call this, so they agree, and it reads
 * only fields the drift hash already covers.
 */
export function foundationUnitTitle(
  scope: FoundationScope, content: FoundationUnitContent,
): string {
  const base = scope.target === 'textStyles' ? TEXT_STYLES_TITLE
    : scope.target === 'effectStyles' ? EFFECT_STYLES_TITLE
    : content.collectionName;
  return titleOf(base, content.group);
}

/** Distinct top-level groups in first-appearance order. */
function groupsInOrder(names: string[]): string[] {
  const seen = new Set<string>();
  for (const name of names) seen.add(groupOf(name));
  return [...seen];
}

export function planFoundationUnits(
  spec: FoundationSpec, selection: FoundationSelection,
): FoundationUnit[] {
  const units: FoundationUnit[] = [];

  for (const chosen of selection.collections) {
    const collection = spec.collections.find((c) => c.id === chosen.collectionId);
    if (!collection) continue;

    const requested = chosen.modeIds.filter((id) => collection.modes.some((m) => m.modeId === id));
    const source = requested.length > 0 ? requested : collection.modes.map((m) => m.modeId);
    const modeIds = source.slice(0, MAX_MODE_COLUMNS);
    const omittedModeNames = collection.modes
      .filter((m) => !modeIds.includes(m.modeId))
      .map((m) => m.name);

    const base = {
      target: 'collection' as const,
      collectionId: collection.id,
      collectionName: collection.name,
      modeIds,
    };

    if (collection.variables.length <= SPLIT_THRESHOLD) {
      units.push({
        scope: base, title: titleOf(collection.name),
        rowCount: collection.variables.length, omittedModeNames,
      });
      continue;
    }

    const groups = groupsInOrder(collection.variables.map((v) => v.name));
    if (groups.length <= 1) {
      // Cannot split further. One tall frame is the faithful outcome.
      units.push({
        scope: base, title: titleOf(collection.name),
        rowCount: collection.variables.length, omittedModeNames,
      });
      continue;
    }

    for (const group of groups) {
      units.push({
        scope: { ...base, group },
        title: titleOf(collection.name, group),
        rowCount: collection.variables.filter((v) => v.group === group).length,
        omittedModeNames,
      });
    }
  }

  if (selection.textStyles) {
    units.push(...planStyleUnits('textStyles', TEXT_STYLES_TITLE, spec.textStyles.map((s) => s.name)));
  }
  if (selection.effectStyles) {
    units.push(...planStyleUnits('effectStyles', EFFECT_STYLES_TITLE, spec.effectStyles.map((s) => s.name)));
  }
  return units;
}

/** Units for a style list: one, or one per top-level group past SPLIT_THRESHOLD. */
function planStyleUnits(
  target: 'textStyles' | 'effectStyles', title: string, names: string[],
): FoundationUnit[] {
  if (names.length === 0) return [];
  const groups = groupsInOrder(names);
  if (names.length <= SPLIT_THRESHOLD || groups.length <= 1) {
    // A lone group cannot split further; one tall frame is the faithful outcome.
    return [{ scope: { target }, title: titleOf(title), rowCount: names.length, omittedModeNames: [] }];
  }
  return groups.map((group) => ({
    scope: { target, group },
    title: titleOf(title, group),
    rowCount: names.filter((n) => groupOf(n) === group).length,
    omittedModeNames: [],
  }));
}

// ---------------------------------------------------------------------------
// Row building: the single source of rendered content
// ---------------------------------------------------------------------------

/**
 * One value cell, drawn as the swatch and label. No renderer reads `modeName`
 * (headers come from modeNames, matched by position), but it cannot break
 * "hashed implies rendered": unitContent builds both from one `modes` array, so
 * cells[i].modeName is always the drawn modeNames[i].
 */
export interface FoundationRowCell { modeName: string; value: FoundationValue }

/**
 * What a number cell draws beside its value, derived from the variable's Figma
 * scopes. First matching row of this table wins; the raw scope list stays off
 * the row so a scope change that would draw nothing different moves no hash.
 */
export type FoundationGlyph =
  | 'bar' | 'radius' | 'stroke' | 'opacity' | 'fontSize' | 'lineHeight' | 'letterSpacing';

const GLYPH_BY_SCOPE: ReadonlyArray<[readonly string[], FoundationGlyph]> = [
  [['GAP', 'WIDTH_HEIGHT', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT'], 'bar'],
  [['CORNER_RADIUS'], 'radius'],
  [['STROKE_FLOAT'], 'stroke'],
  [['OPACITY'], 'opacity'],
  [['FONT_SIZE'], 'fontSize'],
  [['LINE_HEIGHT'], 'lineHeight'],
  [['LETTER_SPACING'], 'letterSpacing'],
];

export function glyphForScopes(
  scopes: readonly string[], resolvedType: FoundationVariableType,
): FoundationGlyph | null {
  if (resolvedType !== 'FLOAT') return null;
  if (scopes.length === 0 || scopes.includes('ALL_SCOPES')) return null;
  for (const [members, glyph] of GLYPH_BY_SCOPE) {
    if (members.some((s) => scopes.includes(s))) return glyph;
  }
  return null;
}

/** The text-style metrics the specimen list names, and so the only bindings it shows. */
export const TEXT_METRIC_FIELDS = [
  'fontFamily', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing',
] as const;

/**
 * The fields the effect specimen line names per layer type, and so the only
 * bindings an effect row carries (as TEXT_METRIC_FIELDS does for text). In the
 * renderer's spelling (`blur`, `offset_x`): `layerLines` in
 * packages/plugin/src/foundationSpecimens.ts prints chips only in its shadow and
 * blur branches, and any other binding would be hashed but never drawn. Change
 * one side and this list moves with it. An absent layer type draws no chip.
 */
const DRAWN_EFFECT_FIELDS: Record<string, readonly string[]> = {
  'drop-shadow': ['offset_x', 'offset_y', 'blur', 'spread', 'color'],
  'inner-shadow': ['offset_x', 'offset_y', 'blur', 'spread', 'color'],
  'layer-blur': ['blur'],
  'background-blur': ['blur'],
};

/**
 * ONLY what a frame draws for a variable: name, description, one cell per
 * rendered mode, and the declared type. `resolvedType` selects the layout (COLOR
 * as swatches, else a table row), so it is rendered and hashed. The declared
 * type, not the value's `kind`: a colour aliased into a library resolves to no
 * local value and must still render as a colour.
 */
export interface FoundationVariableRow {
  kind: 'variable';
  name: string;
  description: string;
  resolvedType: FoundationVariableType;
  /** Figma's code syntax per platform as stored (`WEB`, `ANDROID`, `iOS`); each
   *  entry is drawn as a chip, so all of it is hashed. Nothing is derived. */
  codeSyntax: Record<string, string>;
  /** The scale drawing a number cell shows above its value; null draws nothing. */
  glyph: FoundationGlyph | null;
  cells: FoundationRowCell[];
}

/**
 * The metrics the text-style specimen draws. `boundTokens` names the variable
 * bound to each shown metric (keyed by `TEXT_METRIC_FIELDS`), drawn as a chip.
 * `paragraphIndent` and other bindings reach no pixel, so they stay out of the hash.
 */
export interface FoundationTextMetrics {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: RawTextStyle['lineHeight'];
  letterSpacing: RawTextStyle['letterSpacing'];
  paragraphSpacing: number;
  textCase: string;
  textDecoration: string;
  boundTokens: Record<string, string>;
}

export interface FoundationTextRow {
  kind: 'textStyle';
  name: string;
  description: string;
  metrics: FoundationTextMetrics;
}

/**
 * ONLY what the effect frame draws: the card applies `layers`, the text lists
 * them, and `boundTokens` (keyed `effects[<index>].<field>`, filtered to
 * DRAWN_EFFECT_FIELDS) names each drawn binding. Layers drop their `bindings`
 * key: ids are not drawn and must never move the hash.
 */
export interface FoundationEffectRow {
  kind: 'effectStyle';
  name: string;
  description: string;
  layers: EffectLayer[];
  boundTokens: Record<string, string>;
}

export type FoundationRow = FoundationVariableRow | FoundationTextRow | FoundationEffectRow;

export interface FoundationUnitContent {
  collectionName: string;   // '' for the text-styles unit
  group?: string;
  modeNames: string[];
  rows: FoundationRow[];
  /**
   * Mirrors FoundationUnit.omittedModeNames from the same inputs. It lives here
   * because the drift hash consumes unitContent: the footer note names these,
   * so a mode rename must move the hash.
   */
  omittedModeNames: string[];
  /**
   * Set only when a source was split into several units (`scope.group` set);
   * drawn as "Part {index + 1} of {total}, covering {group}." Derived here so the
   * note is hashed, and from the scope alone so a batch render and a single-doc
   * rebuild number parts the same.
   */
  part?: { index: number; total: number };
}

/**
 * Part numbering for a group-scoped unit. Undefined for a lone group ("Part 1 of
 * 1" is noise), absent rather than suppressed, so the hash covers the note
 * exactly when it is drawn.
 */
function partOf(groups: string[], group: string): { index: number; total: number } | undefined {
  if (groups.length <= 1) return undefined;
  const index = groups.indexOf(group);
  return index < 0 ? undefined : { index, total: groups.length };
}

/** Only platforms with a non-empty declared syntax, in code-unit key order so the hash is stable. */
function definedCodeSyntax(codeSyntax: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(codeSyntax).sort(compareCodeUnits)) {
    const value = codeSyntax[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

/** The bound variable names for the metrics the specimen line draws, nothing else. */
function boundMetricTokens(bound: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of TEXT_METRIC_FIELDS) {
    const name = bound[field];
    if (typeof name === 'string' && name !== '') out[field] = name;
  }
  return out;
}

/**
 * The binding keys the effect line prints for these layers, as
 * `effects[<index>].<field>` (serializeFoundation's shape). `spread` only when
 * the layer has one, since layerLines omits it otherwise.
 */
function drawnEffectBindingKeys(layers: EffectLayer[]): Set<string> {
  const keys = new Set<string>();
  layers.forEach((layer, index) => {
    const fields = DRAWN_EFFECT_FIELDS[layer.type];
    if (fields === undefined) return;
    for (const field of fields) {
      if (field === 'spread' && (layer as { spread?: number }).spread === undefined) continue;
      keys.add(`effects[${index}].${field}`);
    }
  });
  return keys;
}

/** A layer without its `bindings` key. Ids are not drawn, so they must not be hashed. */
function stripBindings(layer: EffectLayer): EffectLayer {
  if (!('bindings' in layer)) return layer;
  const { bindings: _bindings, ...rest } = layer as EffectLayer & { bindings?: unknown };
  return rest as EffectLayer;
}

/**
 * The rows and mode columns for one output unit. Every renderer AND the drift
 * hash consume this, which guarantees the hash covers exactly what is rendered.
 * Null when the scope's source is gone (a missing collection or an empty group).
 */
export function unitContent(
  spec: FoundationSpec, scope: FoundationScope,
): FoundationUnitContent | null {
  if (scope.target === 'textStyles') {
    const styles = scope.group
      ? spec.textStyles.filter((s) => s.group === scope.group)
      : spec.textStyles;
    // Groups come from style names, so an empty named group is gone; a valid
    // empty unit would read "In sync" over an empty frame.
    if (scope.group && styles.length === 0) return null;
    const part = scope.group
      ? partOf(groupsInOrder(spec.textStyles.map((s) => s.name)), scope.group)
      : undefined;
    return {
      collectionName: '',
      ...(scope.group ? { group: scope.group } : {}),
      modeNames: [],
      omittedModeNames: [],
      ...(part ? { part } : {}),
      rows: styles.map((s): FoundationTextRow => ({
        kind: 'textStyle',
        name: s.name,
        description: s.description,
        metrics: {
          fontFamily: s.fontFamily, fontStyle: s.fontStyle,
          fontSize: s.fontSize, lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing, paragraphSpacing: s.paragraphSpacing,
          textCase: s.textCase, textDecoration: s.textDecoration,
          boundTokens: boundMetricTokens(s.boundVariables),
        },
      })),
    };
  }

  if (scope.target === 'effectStyles') {
    const styles = scope.group
      ? spec.effectStyles.filter((s) => s.group === scope.group)
      : spec.effectStyles;
    if (scope.group && styles.length === 0) return null;
    const part = scope.group
      ? partOf(groupsInOrder(spec.effectStyles.map((s) => s.name)), scope.group)
      : undefined;
    const nameById = new Map<string, string>();
    for (const c of spec.collections) for (const v of c.variables) nameById.set(v.provenance.id, v.name);
    return {
      collectionName: '',
      ...(scope.group ? { group: scope.group } : {}),
      modeNames: [],
      omittedModeNames: [],
      ...(part ? { part } : {}),
      rows: styles.map((s): FoundationEffectRow => {
        const boundTokens: Record<string, string> = {};
        // Only the bindings the specimen line draws: see DRAWN_EFFECT_FIELDS.
        const drawn = drawnEffectBindingKeys(s.effects);
        for (const b of s.bindings ?? []) {
          if (!drawn.has(b.property)) continue;
          const name = nameById.get(b.tokenId);
          if (name) boundTokens[b.property] = name;
        }
        return {
          kind: 'effectStyle',
          name: s.name,
          description: s.description,
          layers: s.effects.map(stripBindings),
          boundTokens,
        };
      }),
    };
  }

  const collection = spec.collections.find((c) => c.id === scope.collectionId);
  if (!collection) return null;

  // Drop stale mode ids so a deleted mode narrows the table instead of
  // producing a blank column.
  const modes = scope.modeIds
    .map((id) => collection.modes.find((m) => m.modeId === id))
    .filter((m): m is FoundationMode => m !== undefined);

  const variables = scope.group
    ? collection.variables.filter((v) => v.group === scope.group)
    : collection.variables;

  // As for text styles, an empty group is gone. An empty collection with no
  // group is legitimate and returns a valid, empty unit.
  if (scope.group && variables.length === 0) return null;

  const omittedModeNames = collection.modes
    .filter((m) => !scope.modeIds.includes(m.modeId))
    .map((m) => m.name);

  const part = scope.group
    ? partOf(groupsInOrder(collection.variables.map((v) => v.name)), scope.group)
    : undefined;

  return {
    collectionName: collection.name,
    ...(scope.group ? { group: scope.group } : {}),
    modeNames: modes.map((m) => m.name),
    omittedModeNames,
    ...(part ? { part } : {}),
    rows: variables.map((v): FoundationVariableRow => ({
      kind: 'variable',
      name: v.name,
      description: v.description,
      resolvedType: v.resolvedType,
      codeSyntax: definedCodeSyntax(v.codeSyntax),
      glyph: glyphForScopes(v.provenance.scopes, v.resolvedType),
      cells: modes.map((m) => ({
        modeName: m.name,
        value: v.valuesByMode[m.modeId] ?? { kind: 'unresolved', reason: 'missing' },
      })),
    })),
  };
}

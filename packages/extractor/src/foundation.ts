/**
 * foundation.ts — the pure, Figma-free model for the file's design foundation:
 * variable collections (with modes and alias chains) and text styles.
 *
 * Mirrors the serialize.ts → extract.ts boundary used for components. The
 * plugin dumps raw Figma data (aliases left as {type,id}); everything here is
 * synchronous and fixture-testable, including alias resolution.
 */
import type { EffectLayer } from './effects';
import { canonicalColor } from './v5/color';
import { compareCodeUnits } from './v5/diagnostics';
import { canonicalNumber } from './v5/precision';

// ---------------------------------------------------------------------------
// Raw dump — produced by packages/plugin/src/serializeFoundation.ts
// ---------------------------------------------------------------------------

export interface RawVariableAlias { type: 'VARIABLE_ALIAS'; id: string }
export interface RawRGBA { r: number; g: number; b: number; a: number }
export type RawVariableValue = RawRGBA | number | string | boolean | RawVariableAlias;

export type FoundationVariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
export type FoundationPublishStatus = 'UNPUBLISHED' | 'CURRENT' | 'CHANGED';

/** Source publication facts Figma exposes independently. `publishStatus` is
 * null when the async status read failed; hidden/remote remain usable facts. */
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
  /** Stable Figma style id. Optional only for legacy injected dumps captured
   * before Foundation Context v5 Phase 3. */
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
 * One effect style from the file, with each layer already converted through the
 * shared EffectLayer union.
 *
 * Literal layers stay in the shared EffectLayer union used by v4/component
 * briefs. Phase 3 additionally keeps exact source binding ids in `bindings`,
 * beside rather than inside that legacy projection, so canonical export can
 * join by stable identity without changing older YAML or canvas hashes.
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
   * Which reads failed. Absent on a clean read, never `[]`.
   *
   * serializeFoundation catches an API failure and returns an empty foundation,
   * which makes total failure indistinguishable from a file that genuinely has
   * no variables. This is the difference, and it is a prerequisite for the
   * `unavailable` resolution status rather than a nicety.
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
  /**
   * Present only on a narrowed spec. Lets a resolver distinguish "excluded by
   * scope" from "not present locally" — two causes that a lookup returning
   * nothing collapses into one.
   */
  narrowedTo?: FoundationCopyTarget;
}

export type FoundationScope =
  | { target: 'collection'; collectionId: string; collectionName: string;
      group?: string; modeIds: string[] }
  | { target: 'textStyles'; group?: string };

/**
 * What a single Copy-for-AI request covers.
 *
 * Deliberately coarser than FoundationScope, which additionally carries a
 * `group` and a `modeIds` subset. Both of those are artifacts of drawing a
 * frame — modes are capped at MAX_MODE_COLUMNS because a frame has four
 * columns, and a collection over SPLIT_THRESHOLD is divided into one document
 * per group — and the clipboard has neither limit. A copy that inherited them
 * would silently hide modes and whole token families from the agent reading it.
 */
export type FoundationCopyTarget =
  | { target: 'collection'; collectionId: string }
  | { target: 'textStyles' };

/**
 * Reduce a whole-file spec to the part one Copy covers, so foundationBrief and
 * colorContrast can run over it unmodified.
 *
 * Returns null when the target resolves to nothing: a collection deleted since
 * its document was generated, or a text-styles target in a file whose styles
 * are all gone. Null rather than an empty spec, because "there is nothing here
 * any more" is a message the caller must show, not a brief it should copy.
 *
 * Alias values are untouched. They were resolved during buildFoundation, so a
 * variable aliasing into a collection this narrowing drops still carries both
 * its target name and its resolved concrete value.
 *
 * The kept collection is not cloned: it is the same object reference as in
 * `spec`. Treat both the input and the returned spec's collection as
 * read-only, since mutating one mutates the other.
 */
export function narrowFoundation(
  spec: FoundationSpec,
  target: FoundationCopyTarget,
): FoundationSpec | null {
  if (target.target === 'textStyles') {
    if (spec.textStyles.length === 0) return null;
    // Effect styles are narrowed away here as well as on the collection branch:
    // FoundationCopyTarget has no effect-styles target, so no scoped copy claims
    // to cover them and the whole-file copy is where they appear.
    return { ...spec, collections: [], textStyles: spec.textStyles, effectStyles: [], narrowedTo: target };
  }
  const collection = spec.collections.find((c) => c.id === target.collectionId);
  if (!collection) return null;
  return { ...spec, collections: [collection], textStyles: [], effectStyles: [], narrowedTo: target };
}

/** Rows per output unit, above which a unit splits by top-level group. */
export const SPLIT_THRESHOLD = 150;
/** Hard ceiling on rendered mode columns. */
export const MAX_MODE_COLUMNS = 4;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Top-level path segment. "color/bg/brand" → "color"; "standalone" → itself.
 *
 * This is the SPLIT key: it decides how a large collection is divided into
 * separate documents. `folderOf` is the finer BLOCK key used to divide one
 * document's rows into titled groups. Both exist because they answer different
 * questions, and a design system that names everything `color/...` needs the
 * finer one to get any grouping at all.
 */
export function groupOf(name: string): string {
  const i = name.indexOf('/');
  return i <= 0 ? name : name.slice(0, i);
}

/**
 * The folder a variable sits in, which is its whole name minus the leaf:
 * "color/surface/primary/light" → "color/surface/primary".
 *
 * This mirrors what Figma's own variables panel shows, where a slash is a
 * folder, so grouping on it means the document's blocks match the structure the
 * user built. Returns '' for a name with no folder at all, which the renderer
 * draws without a heading rather than inventing one.
 *
 * Deliberately the immediate parent rather than a fixed depth: token sets nest
 * to whatever depth they nest to, and any fixed level is wrong for somebody.
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

/**
 * A block's heading: the final folder segment, capitalized. "colors/blue" reads
 * as "Blue", "color/surface" as "Surface".
 *
 * Not the whole path, which is what the tokens spell but not what a reader wants
 * at the top of a block.
 */
export function groupTitle(folder: string): string {
  return titleAtDepth(folder, 1);
}

/**
 * Titles for one document's groups, widened only if they would collide.
 *
 * Two folders can end in the same segment ("color/surface" and "brand/surface"),
 * and two blocks both headed "Surface" in one frame is worse than a longer
 * heading. When that happens every title in the document takes one more segment,
 * so the set stays uniform rather than one odd heading out. Returned in the same
 * order as `folders`.
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
export interface FoundationRowGroup {
  /** The shared folder path, or '' for rows that sit at the root. */
  folder: string;
  rows: FoundationVariableRow[];
}

/**
 * Group rows by their folder, in first-appearance order, preserving row order
 * inside each group.
 *
 * Shared rather than done in the renderer because two callers need to agree: the
 * frame builder draws these blocks, and the AI description pass keys its output
 * by folder. If they grouped separately, a description could land on the wrong
 * block or on none.
 */
export function groupRowsByFolder(rows: FoundationVariableRow[]): FoundationRowGroup[] {
  const groups: FoundationRowGroup[] = [];
  for (const row of rows) {
    const folder = folderOf(row.name);
    const existing = groups.find((g) => g.folder === folder);
    if (existing) existing.rows.push(row);
    else groups.push({ folder, rows: [row] });
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
      // Keep the first source declaration. Duplicate stable ids are diagnosed
      // by the v5 exporter; silently switching to the last declaration would
      // make source order change which graph is resolved.
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
      // Legacy buildFoundation returned a bare missing value when the target
      // entity itself could not be read or found. Keep that render/v4 shape;
      // the richer alias identity remains available in provenance.
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

/** Title for the text-styles unit, which has no collection to name. */
const TEXT_STYLES_TITLE = 'Text styles';

/**
 * The document title for one unit, derived from its scope and rendered content.
 *
 * Three places need this title: planFoundationUnits (building the batch), the
 * renderer (drawing the header band), and updateFoundationDoc (rebuilding one
 * doc from its stored scope, with no batch around it). Deriving it in one place
 * is what stops those three from disagreeing about what a document is called,
 * and derives it from fields the drift hash already covers rather than from a
 * separately stored string.
 */
export function foundationUnitTitle(
  scope: FoundationScope, content: FoundationUnitContent,
): string {
  const base = scope.target === 'textStyles' ? TEXT_STYLES_TITLE : content.collectionName;
  return titleOf(base, content.group);
}

/** Distinct top-level groups in first-appearance order. */
function groupsInOrder(names: string[]): string[] {
  const seen: string[] = [];
  for (const name of names) {
    const g = groupOf(name);
    if (!seen.includes(g)) seen.push(g);
  }
  return seen;
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

  if (selection.textStyles && spec.textStyles.length > 0) {
    if (spec.textStyles.length <= SPLIT_THRESHOLD) {
      units.push({
        scope: { target: 'textStyles' }, title: titleOf(TEXT_STYLES_TITLE),
        rowCount: spec.textStyles.length, omittedModeNames: [],
      });
    } else {
      const groups = groupsInOrder(spec.textStyles.map((s) => s.name));
      if (groups.length <= 1) {
        // Cannot split further. One tall frame is the faithful outcome, same
        // as the collection path's identical case.
        units.push({
          scope: { target: 'textStyles' }, title: titleOf(TEXT_STYLES_TITLE),
          rowCount: spec.textStyles.length, omittedModeNames: [],
        });
      } else {
        for (const group of groups) {
          units.push({
            scope: { target: 'textStyles', group },
            title: titleOf(TEXT_STYLES_TITLE, group),
            rowCount: spec.textStyles.filter((s) => s.group === group).length,
            omittedModeNames: [],
          });
        }
      }
    }
  }

  return units;
}

// ---------------------------------------------------------------------------
// Row building — the single source of rendered content
// ---------------------------------------------------------------------------

/**
 * One value cell. `value` is drawn as the swatch and label.
 *
 * `modeName` is the one field in this projection no renderer reads: the column
 * headers come from FoundationUnitContent.modeNames, and cells are matched to
 * them positionally. It stays because it is not independently variable, so it
 * cannot break "hashed implies rendered". unitContent builds it and modeNames
 * from the same `modes` array in the same order, so cells[i].modeName is always
 * modeNames[i], and no change to the file can move the hash through this field
 * without also moving it through the column header that is drawn. It keeps each
 * cell self-describing for any renderer that does not iterate positionally.
 */
export interface FoundationRowCell { modeName: string; value: FoundationValue }

/**
 * ONLY what a frame actually draws for a variable: the name, the optional
 * description column, one cell per rendered mode, and the declared type.
 *
 * `resolvedType` was deliberately absent while nothing read it. It is here now
 * because it selects the layout: a COLOR variable renders as a swatch list with
 * its formats, everything else renders as a table row. That makes it the single
 * most visible field in the projection rather than an unrendered one, so both
 * directions of the invariant hold. Retyping a variable from COLOR to FLOAT
 * moves the hash and the Update that follows produces a genuinely different
 * frame.
 *
 * It has to be the declared type rather than the resolved value's own `kind`.
 * A colour variable aliased entirely into a published library resolves to no
 * local value at all, and inferring "not a colour" from that would drop a whole
 * semantic collection into the numbers table.
 */
export interface FoundationVariableRow {
  kind: 'variable';
  name: string;
  description: string;
  resolvedType: FoundationVariableType;
  cells: FoundationRowCell[];
}

/**
 * ONLY the metrics a frame actually draws: the specimen is set in
 * family/style at fontSize, and the metrics line reads
 * "family style size/lineHeight". Nothing else belongs here.
 *
 * letterSpacing, paragraphSpacing, paragraphIndent, textCase, and
 * textDecoration are deliberately absent even though extraction captures all
 * of them on FoundationTextStyle. They reach no pixel, so including them here
 * would make the drift hash fire on changes whose Update produces a
 * byte-identical frame. When a later phase renders them, move them back here
 * and the hash picks them up with no other change.
 */
export interface FoundationTextMetrics {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: RawTextStyle['lineHeight'];
}

export interface FoundationTextRow {
  kind: 'textStyle';
  name: string;
  description: string;
  metrics: FoundationTextMetrics;
}

export type FoundationRow = FoundationVariableRow | FoundationTextRow;

export interface FoundationUnitContent {
  collectionName: string;   // '' for the text-styles unit
  group?: string;
  modeNames: string[];
  rows: FoundationRow[];
  /**
   * Mirrors FoundationUnit.omittedModeNames — computed from the same inputs
   * (the collection's modes vs. scope.modeIds) and must always agree with it.
   * It also has to live here, not just on FoundationUnit, because unitContent
   * is what the drift hash consumes: if a footer note names an omitted mode
   * but that name is absent from this return, renaming the mode changes what
   * the frame renders while leaving the hash unchanged.
   */
  omittedModeNames: string[];
  /**
   * Present only when this unit is one of several a single source was split
   * into, which is exactly when `scope.group` is set. Frames render it as
   * "Part {index + 1} of {total}, covering {group}."
   *
   * Derived here rather than passed in, for two reasons. It has to be inside
   * unitContent's return or the footer note it drives is rendered but not
   * hashed, which is how adding a group to a large collection used to leave
   * surviving frames with stale part numbers and no "Update available" to say
   * so. And deriving it from the scope alone is what makes the numbers agree
   * between a whole-batch render and a single-doc rebuild: updateFoundationDoc
   * has no batch around it to count, so any numbering the batch computed for
   * itself would be lost on the next Update.
   */
  part?: { index: number; total: number };
}

/**
 * The part numbering for a group-scoped unit, given the source's full ordered
 * group list. Undefined when there is nothing to number: a lone group is not a
 * split, and a frame that says "Part 1 of 1" would be noise. Absent rather
 * than present-and-suppressed so that the hash covers the note exactly when
 * the note is drawn.
 */
function partOf(groups: string[], group: string): { index: number; total: number } | undefined {
  if (groups.length <= 1) return undefined;
  const index = groups.indexOf(group);
  return index < 0 ? undefined : { index, total: groups.length };
}

/**
 * The rows and mode columns for one output unit. Every renderer AND the drift
 * hash consume this, which is what mechanically guarantees "the hash covers
 * exactly what is rendered".
 *
 * Returns null when the scope's source is gone: a collection id that is no
 * longer in the file, or a named group that matches nothing.
 */
export function unitContent(
  spec: FoundationSpec, scope: FoundationScope,
): FoundationUnitContent | null {
  if (scope.target === 'textStyles') {
    const styles = scope.group
      ? spec.textStyles.filter((s) => s.group === scope.group)
      : spec.textStyles;
    // A group is derived from style names, so a named group with no members
    // cannot legitimately exist: zero rows means the group is gone (renamed,
    // or its last style deleted). Reporting that as a valid empty unit would
    // let the doc read "In sync" while rebuilding to an empty frame.
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
        },
      })),
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

  // Same reasoning as the text-styles branch: a group with zero variables is
  // a group that no longer exists. A collection-scoped unit (no group) with
  // zero variables is a different, legitimate case — an empty collection — and
  // still returns a valid, empty unit.
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
      cells: modes.map((m) => ({
        modeName: m.name,
        value: v.valuesByMode[m.modeId] ?? { kind: 'unresolved', reason: 'missing' },
      })),
    })),
  };
}

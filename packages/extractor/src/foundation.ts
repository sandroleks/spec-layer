/**
 * foundation.ts — the pure, Figma-free model for the file's design foundation:
 * variable collections (with modes and alias chains) and text styles.
 *
 * Mirrors the serialize.ts → extract.ts boundary used for components. The
 * plugin dumps raw Figma data (aliases left as {type,id}); everything here is
 * synchronous and fixture-testable, including alias resolution.
 */
import type { EffectLayer } from './effects';

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

/**
 * One effect style from the file, with each layer already converted through the
 * shared EffectLayer union.
 *
 * Per-field variable bindings on a style's layers are deliberately NOT resolved
 * here. Node-level inline effects carry them (see extractNodeEffects); a style
 * layer emits its literal values. Resolving them would need `remote` on
 * ReaderVariable and a second resolution path for a case the design does not
 * cover; when that changes, this comment is the place to start.
 */
export interface RawEffectStyle {
  name: string;
  description: string;
  effects: EffectLayer[];
}

/** An alias target that lives in a library, not in this file's local dump. */
export interface RawExternalRef { id: string; name: string; collectionName: string }

/** One read serializeFoundation performs. Named so a failure can be reported as
 *  a fact rather than inferred from an empty result. */
export type FoundationRead = 'variables' | 'textStyles' | 'effectStyles';

export interface SerializedFoundation {
  fileKey: string;
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

export interface FoundationEffectStyle extends RawEffectStyle { group: string }

export interface FoundationSpec {
  fileKey: string;
  collections: FoundationCollection[];
  textStyles: FoundationTextStyle[];
  effectStyles: FoundationEffectStyle[];
  extractedAt: string;
  /** Carried straight through from the dump. See SerializedFoundation. */
  unavailable?: FoundationRead[];
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
/** Alias chain depth ceiling, matching resolveVariableColor in tokenResolve.ts. */
const MAX_ALIAS_DEPTH = 4;

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
    effectStyles: dump.effectStyles.map((s) => ({ ...s, group: groupOf(s.name) })),
    extractedAt: dump.extractedAt,
    // Spread, not `unavailable: dump.unavailable`: a clean read has no key at
    // all rather than one holding undefined, matching how every other optional
    // field in this model behaves.
    ...(dump.unavailable ? { unavailable: dump.unavailable } : {}),
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

/**
 * libraryDiff.ts: the typed diff between two published library bundles, and
 * the semantic version bump it requires.
 *
 * Figma-free and deterministic. The proxy runs it on every publish and stores
 * the result, so two machines must produce byte-identical output for the same
 * pair of bundles: every sort here uses compareCodeUnits, never localeCompare.
 *
 * Only Figma facts feed the diff: component properties, variant axes and their
 * options, states, anatomy parts, token bindings, layout and effect values,
 * foundation collections, modes, tokens and their per-mode values, and
 * styles. Prose, descriptions, diagnostics, completeness, the export envelope,
 * the AI projections and the bundle's file and plugin metadata are never read.
 *
 * Built on `diffKeyed` from diff.ts. `diff.ts` explains changes to a designer
 * on the Library screen; this module explains them to a version number and a
 * history pane, so its output is structured rather than prose.
 */
import { diffKeyed } from './diff';
import { canonicalJson } from './v5/canonical';
import { compareCodeUnits } from './v5/diagnostics';
import type { LibraryBundleV1 } from './libraryBundle';
import type { CanonicalValue, TypedValue } from './v5/value';

export type ChangeKind = 'added' | 'removed' | 'renamed' | 'changed';

/**
 * The v5 component artifact carries variant axes and their options but no
 * variant instance list, so there is no `variant` entity: an added option is
 * the observable event when a variant appears.
 */
export type ChangeEntity =
  | 'component' | 'property' | 'option' | 'variant_axis'
  | 'state' | 'anatomy_part' | 'binding' | 'value'
  | 'collection' | 'mode' | 'token' | 'token_value' | 'style';

export type Bump = 'major' | 'minor' | 'patch';

export interface LibraryChange {
  kind: ChangeKind;
  entity: ChangeEntity;
  /** Component display name after the change, null for foundation changes. */
  component: string | null;
  /** Stable identity within its scope. */
  id: string;
  /** Display name after the change. */
  name: string;
  /** Rendered previous value, when meaningful. */
  from: string | null;
  /** Rendered new value, when meaningful. */
  to: string | null;
  /** Variant condition or mode, when meaningful. */
  scope: string | null;
  bump: Bump;
}

export interface LibraryDiff {
  /** Sorted with compareChanges; deterministic. */
  changes: LibraryChange[];
  /** The highest bump across changes; null when changes is empty. */
  minimumBump: Bump | null;
  counts: { major: number; minor: number; patch: number };
}

/**
 * Entities whose removal or rename breaks a consumer and whose addition is a
 * compatible extension. Everything else is a value and moves the patch number.
 */
const STRUCTURAL: ReadonlySet<ChangeEntity> = new Set<ChangeEntity>([
  'component', 'property', 'option', 'variant_axis', 'state', 'anatomy_part',
  'collection', 'mode', 'token',
]);

export function bumpFor(entity: ChangeEntity, kind: ChangeKind): Bump {
  if (!STRUCTURAL.has(entity)) return 'patch';
  if (kind === 'removed' || kind === 'renamed') return 'major';
  if (kind === 'added') return 'minor';
  return 'patch';
}

const BUMP_RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export function compareBump(a: Bump, b: Bump): number {
  return BUMP_RANK[a] - BUMP_RANK[b];
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Three dotted integers. No prerelease, no build metadata, no leading `v`. */
export function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/** `null` means no version yet, and the first version is always 1.0.0. */
export function nextVersion(current: string | null, bump: Bump): string {
  if (current === null) return '1.0.0';
  const match = SEMVER_RE.exec(current);
  if (!match) throw new RangeError(`Not a semantic version: ${current}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Foundation first (null component sorts before any name), then by component, entity, id, scope, kind. */
export function compareChanges(a: LibraryChange, b: LibraryChange): number {
  return compareCodeUnits(a.component ?? '', b.component ?? '')
    || compareCodeUnits(a.entity, b.entity)
    || compareCodeUnits(a.id, b.id)
    || compareCodeUnits(a.scope ?? '', b.scope ?? '')
    || compareCodeUnits(a.kind, b.kind);
}

/**
 * The version log a published library carries, declared here beside the
 * change type because three packages read it: the proxy writes it, the plugin's
 * history pane renders it, and the CLI will read it. Same reasoning as the
 * bundle contract in libraryBundle.ts.
 */
export interface VersionRecord {
  version: string;
  publishedAt: string;
  /** The applied bump. `initial` for the first versioned publish. */
  bump: Bump | 'initial';
  /** What the rules required; null on a first publish, where there is no baseline. */
  minimumBump: Bump | null;
  /** Publisher note, trimmed, at most 500 characters. */
  note: string | null;
  /** libraryBundleContentHash of the stored bundle. */
  contentHash: string;
  /** sha256 of the stored bytes, the pull ETag. */
  bundleHash: string;
  extractorVersion: string;
  pluginVersion: string;
  /** Always the full diff's counts, even when `changes` is truncated. */
  counts: { major: number; minor: number; patch: number };
  changes: LibraryChange[];
  changesTruncated: boolean;
}

/** Newest record first. */
export interface VersionLog { v: 1; records: VersionRecord[] }

function summarize(changes: LibraryChange[]): LibraryDiff {
  const sorted = [...changes].sort(compareChanges);
  const counts = { major: 0, minor: 0, patch: 0 };
  let minimumBump: Bump | null = null;
  for (const change of sorted) {
    counts[change.bump] += 1;
    if (minimumBump === null || compareBump(change.bump, minimumBump) > 0) minimumBump = change.bump;
  }
  return { changes: sorted, minimumBump, counts };
}

// Facts readers and the diff itself follow in Task 2 and Task 3.
export function libraryDiff(before: LibraryBundleV1, after: LibraryBundleV1): LibraryDiff {
  void before; void after; void diffKeyed; void canonicalJson;
  return summarize([]);
}

export type { CanonicalValue, TypedValue };

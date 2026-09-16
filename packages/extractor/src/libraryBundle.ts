/**
 * The library bundle the plugin publishes, the proxy stores, and the CLI
 * pulls, defined once so the three cannot drift apart.
 *
 * This is an envelope contract, not a v5 contract: it checks that each entry
 * carries a name, its AI YAML, and an artifact with a content hash, and leaves
 * the artifacts themselves to the v5 validators. It is Figma-free and
 * dependency-free so the CLI can inline it at build time.
 */

export const LIBRARY_BUNDLE_SCHEMA = 'spec-layer-library-bundle';
export const LIBRARY_BUNDLE_VERSION = '1.0.0';

export interface LibraryBundleArtifact { spec_layer: { export: { content_hash: string } } }
/** One variant instance of a component set: its Figma name and its axis values. A lone
 *  component is one variant with no values. The diff expands token bindings over these. */
export interface LibraryBundleVariant { name: string; values: Record<string, string> }
export interface LibraryBundleComponent {
  name: string;
  ai: string;
  artifact: LibraryBundleArtifact;
  /** Absent in bundles written before variants were carried; the diff then falls back to rule identity. */
  variants?: LibraryBundleVariant[];
}
export interface LibraryBundleV1 {
  schema: typeof LIBRARY_BUNDLE_SCHEMA;
  version: string;
  fileName: string | null;
  pluginVersion: string | null;
  extractorVersion: string;
  foundation: { ai: string; artifact: LibraryBundleArtifact } | null;
  components: LibraryBundleComponent[];
}

export type LibraryBundleErrorCode = 'not_json' | 'not_bundle' | 'unsupported_version' | 'malformed';

export class LibraryBundleError extends Error {
  readonly code: LibraryBundleErrorCode;

  constructor(code: LibraryBundleErrorCode, message: string) {
    super(message);
    this.name = 'LibraryBundleError';
    this.code = code;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function hasContentHash(artifact: unknown): artifact is LibraryBundleArtifact {
  if (!isRecord(artifact) || !isRecord(artifact.spec_layer)) return false;
  const exp = artifact.spec_layer.export;
  return isRecord(exp) && typeof exp.content_hash === 'string';
}

/** The variants list when every item is well formed, else undefined: an
 *  unreadable list is dropped rather than failing the whole bundle, since
 *  nothing but the diff's per-variant path needs it. */
function readVariants(value: unknown): LibraryBundleVariant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: LibraryBundleVariant[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string' || !isRecord(item.values)) return undefined;
    const values: Record<string, string> = {};
    for (const [axis, v] of Object.entries(item.values)) {
      if (typeof v !== 'string') return undefined;
      values[axis] = v;
    }
    out.push({ name: item.name, values });
  }
  return out;
}

function entry(v: unknown, where: string): LibraryBundleComponent {
  if (!isRecord(v) || typeof v.name !== 'string' || typeof v.ai !== 'string' || !hasContentHash(v.artifact)) {
    throw new LibraryBundleError('malformed', `The ${where} entry in this bundle is malformed.`);
  }
  const variants = readVariants(v.variants);
  return { name: v.name, ai: v.ai, artifact: v.artifact, ...(variants ? { variants } : {}) };
}

/** Major version 1 is the only one this code reads. */
function supportedVersion(version: unknown): version is string {
  return typeof version === 'string' && /^1\.\d+\.\d+$/.test(version);
}

/**
 * Parse a bundle from its JSON text or an already-parsed value. Throws a
 * LibraryBundleError whose `code` tells the caller which plain message to
 * print; the message itself is already plain enough to show as is.
 */
export function parseLibraryBundle(input: unknown): LibraryBundleV1 {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new LibraryBundleError('not_json', 'This is not valid JSON.');
    }
  }
  if (!isRecord(parsed) || parsed.schema !== LIBRARY_BUNDLE_SCHEMA) {
    throw new LibraryBundleError('not_bundle', 'This is not a Spec Layer library bundle.');
  }
  if (!supportedVersion(parsed.version)) {
    const version = typeof parsed.version === 'string' ? parsed.version : String(parsed.version);
    throw new LibraryBundleError(
      'unsupported_version',
      `This bundle is version ${version}, which this reader does not support.`,
    );
  }
  if (typeof parsed.extractorVersion !== 'string' || !Array.isArray(parsed.components)) {
    throw new LibraryBundleError('malformed', 'This bundle is missing required fields.');
  }
  const foundationRaw = parsed.foundation ?? null;
  let foundation: LibraryBundleV1['foundation'] = null;
  if (foundationRaw !== null) {
    if (!isRecord(foundationRaw) || typeof foundationRaw.ai !== 'string' || !hasContentHash(foundationRaw.artifact)) {
      throw new LibraryBundleError('malformed', 'The foundation entry in this bundle is malformed.');
    }
    foundation = { ai: foundationRaw.ai, artifact: foundationRaw.artifact };
  }
  return {
    schema: LIBRARY_BUNDLE_SCHEMA,
    version: parsed.version,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
    pluginVersion: typeof parsed.pluginVersion === 'string' ? parsed.pluginVersion : null,
    extractorVersion: parsed.extractorVersion,
    foundation,
    components: parsed.components.map((c, i) => entry(c, `component ${i}`)),
  };
}

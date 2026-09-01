export interface ArtifactLike { spec_layer: { export: { content_hash: string } } }
export interface BundleEntry { name: string; ai: string; artifact: ArtifactLike }
export interface BundleV1 {
  schema: 'spec-layer-library-bundle';
  version: string;
  fileName: string | null;
  pluginVersion: string | null;
  extractorVersion: string;
  foundation: { ai: string; artifact: ArtifactLike } | null;
  components: BundleEntry[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function contentHash(artifact: unknown): string | null {
  if (!isRecord(artifact) || !isRecord(artifact.spec_layer)) return null;
  const exp = (artifact.spec_layer as Record<string, unknown>).export;
  if (!isRecord(exp) || typeof exp.content_hash !== 'string') return null;
  return exp.content_hash;
}

function entry(v: unknown, where: string): BundleEntry {
  if (!isRecord(v) || typeof v.name !== 'string' || typeof v.ai !== 'string' || contentHash(v.artifact) === null) {
    throw new Error(`The ${where} entry in this bundle is malformed.`);
  }
  return v as unknown as BundleEntry;
}

export function parseBundle(raw: string): BundleV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The server response is not valid JSON.'); }
  if (!isRecord(parsed) || parsed.schema !== 'spec-layer-library-bundle') {
    throw new Error('The server response is not a Spec Layer library bundle.');
  }
  if (typeof parsed.version !== 'string' || typeof parsed.extractorVersion !== 'string' || !Array.isArray(parsed.components)) {
    throw new Error('This bundle is missing required fields.');
  }
  const foundation = parsed.foundation ?? null;
  if (foundation !== null) {
    if (!isRecord(foundation) || typeof foundation.ai !== 'string' || contentHash(foundation.artifact) === null) {
      throw new Error('The foundation entry in this bundle is malformed.');
    }
  }
  const components = (parsed.components as unknown[]).map((c, i) => entry(c, `component ${i}`));
  return {
    schema: 'spec-layer-library-bundle',
    version: parsed.version,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
    pluginVersion: typeof parsed.pluginVersion === 'string' ? parsed.pluginVersion : null,
    extractorVersion: parsed.extractorVersion,
    foundation: foundation as BundleV1['foundation'],
    components,
  };
}

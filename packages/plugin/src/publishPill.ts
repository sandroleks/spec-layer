/**
 * The publish record a doc Section carries and its pill state; pure, so the
 * state table tests in Node, and pillNode.ts draws it.
 *
 * The pill compares the canvas drift hash (specContentHash or
 * foundationContentHash) against the same hash taken at publish time. Not the
 * v5 artifact hash: that depends on the Foundation slice and cannot be
 * recomputed on Generate.
 *
 * The pill enters no hash: collectGeneratedText skips it through PILL_KEY, so
 * it never reads as a hand edit, and it is in no projection.
 */

/** Section plugin data key holding a serialized DocPublishRecord. */
export const PUBLISH_RECORD_KEY = 'specLayerPublish';
/** '1' on the pill frame and its text, found by data, never by name. */
export const PILL_KEY = 'specLayerPill';
export const PILL_NODE_NAME = 'Spec Layer publish status';

export interface DocPublishRecord {
  v: 1;
  libraryId: string;
  version: string;
  /** ISO time the proxy reported for this publish. */
  publishedAt: string;
  /** This doc's drift hash over the live source at publish time. */
  sourceHash: string;
}

export type PillState =
  | { kind: 'published'; version: string }
  | { kind: 'changed'; version: string }
  | { kind: 'unpublished' };

/** A null `currentSourceHash` reads as changed, never published: the pill
 *  states only what it can prove. */
export function pillState(record: DocPublishRecord | null, currentSourceHash: string | null): PillState {
  if (record === null) return { kind: 'unpublished' };
  if (currentSourceHash !== null && currentSourceHash === record.sourceHash) {
    return { kind: 'published', version: record.version };
  }
  return { kind: 'changed', version: record.version };
}

/** Middle dot, U+00B7. Plugin copy never carries an em dash. */
export function pillLabel(state: PillState): string {
  switch (state.kind) {
    case 'published': return `v${state.version} · Published`;
    case 'changed': return `Changed since v${state.version}`;
    case 'unpublished': return 'Not published';
  }
}

export function serializePublishRecord(record: DocPublishRecord): string {
  return JSON.stringify(record);
}

export function parsePublishRecord(raw: string): DocPublishRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DocPublishRecord> | null;
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.libraryId !== 'string' || typeof parsed.version !== 'string' || parsed.version.length === 0
      || typeof parsed.publishedAt !== 'string' || typeof parsed.sourceHash !== 'string') return null;
    return { v: 1, libraryId: parsed.libraryId, version: parsed.version, publishedAt: parsed.publishedAt, sourceHash: parsed.sourceHash };
  } catch {
    return null;
  }
}

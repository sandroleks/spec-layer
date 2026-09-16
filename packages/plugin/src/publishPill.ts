/**
 * publishPill.ts: the publish record a doc Section carries and the pill state
 * it renders as. Pure and Figma-free so the state table is testable in Node;
 * pillNode.ts draws it.
 *
 * The pill answers "does this doc's source still match what was published".
 * It compares the canvas drift hash the plugin already computes on Generate
 * and Update (specContentHash for a component doc, foundationContentHash for
 * a foundation unit) against the same hash taken from the live source at
 * publish time. The v5 artifact hash is not used here: it is computed only on
 * publish and Copy for AI, and depends on the Foundation dependency slice, so
 * the plugin cannot recompute it on Generate to compare.
 *
 * The pill enters no hash. Its text is skipped by collectGeneratedText through
 * PILL_KEY, so a stamped version never reads as a hand edit; it is not part of
 * any projection, so it cannot move a drift hash; and it never reaches the
 * extractor, so it cannot move an artifact hash.
 */

/** Section plugin data key holding a serialized DocPublishRecord. */
export const PUBLISH_RECORD_KEY = 'specLayerPublish';
/** Set to '1' on the pill frame and its text node, so hashing and repainting can find them by data, not by name. */
export const PILL_KEY = 'specLayerPill';
export const PILL_NODE_NAME = 'Spec Layer publish pill';

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

/**
 * `currentSourceHash` null means the plugin could not compute one. That reads
 * as changed, never as published: the pill states only what it can prove.
 */
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
    case 'changed': return `v${state.version} · Changed since`;
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

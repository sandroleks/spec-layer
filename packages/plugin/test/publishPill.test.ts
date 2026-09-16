import { describe, it, expect } from 'vitest';
import {
  PILL_KEY, PILL_NODE_NAME, PUBLISH_RECORD_KEY,
  pillState, pillLabel, serializePublishRecord, parsePublishRecord, type DocPublishRecord,
} from '../src/publishPill';

const record: DocPublishRecord = {
  v: 1, libraryId: 'lib_aaaaaaaaaaaaaaaaaaaaaaaa', version: '1.5.0',
  publishedAt: '2026-09-12T10:00:00.000Z', sourceHash: 'h1',
};

describe('pillState', () => {
  it('is unpublished with no record, whatever the current hash', () => {
    expect(pillState(null, 'h1')).toEqual({ kind: 'unpublished' });
    expect(pillState(null, null)).toEqual({ kind: 'unpublished' });
  });

  it('is published when the current hash equals the recorded one', () => {
    expect(pillState(record, 'h1')).toEqual({ kind: 'published', version: '1.5.0' });
  });

  it('is changed when the hash differs', () => {
    expect(pillState(record, 'h2')).toEqual({ kind: 'changed', version: '1.5.0' });
  });

  it('is changed, not published, when the current hash is unknown: the plugin cannot prove a match', () => {
    expect(pillState(record, null)).toEqual({ kind: 'changed', version: '1.5.0' });
  });
});

describe('pillLabel', () => {
  it('uses a middle dot, never an em dash', () => {
    expect(pillLabel({ kind: 'published', version: '1.5.0' })).toBe('v1.5.0 · Published');
    expect(pillLabel({ kind: 'changed', version: '1.5.0' })).toBe('v1.5.0 · Changed since');
    expect(pillLabel({ kind: 'unpublished' })).toBe('Not published');
    for (const state of [{ kind: 'published', version: '1.0.0' }, { kind: 'changed', version: '1.0.0' }, { kind: 'unpublished' }] as const) {
      expect(pillLabel(state)).not.toContain('—');
    }
  });
});

describe('publish record round trip', () => {
  it('serializes and parses', () => {
    expect(parsePublishRecord(serializePublishRecord(record))).toEqual(record);
  });

  it('reads an empty string, junk, and a wrong version as null', () => {
    expect(parsePublishRecord('')).toBeNull();
    expect(parsePublishRecord('{')).toBeNull();
    expect(parsePublishRecord(JSON.stringify({ ...record, v: 2 }))).toBeNull();
    expect(parsePublishRecord(JSON.stringify({ ...record, sourceHash: 7 }))).toBeNull();
  });

  it('rejects an empty version string rather than stamping a pill with nothing to show', () => {
    expect(parsePublishRecord(JSON.stringify({ ...record, version: '' }))).toBeNull();
  });

  it('names the keys other modules look for', () => {
    expect(PUBLISH_RECORD_KEY).toBe('specLayerPublish');
    expect(PILL_KEY).toBe('specLayerPill');
    expect(PILL_NODE_NAME).toBe('Spec Layer publish pill');
  });
});

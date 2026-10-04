import { describe, it, expect } from 'vitest';
import {
  parseSyncRecord, serializeSyncRecord, ownDescription, ownDocumentationLink, annotationHash, descriptionHash,
  type SyncRecord,
} from '../src/syncRecord';

const RECORD: SyncRecord = {
  v: 1, syncedAt: 1, pluginVersion: '6.1.0',
  description: { hash: descriptionHash('Ours'), bodyHash: 'b', origin: 'authored' },
  link: { uri: 'https://www.figma.com/design/K/?node-id=1-2' },
  annotations: [{ nodeId: '1:2', hash: 'h' }],
};

describe('sync record', () => {
  it('round-trips', () => {
    expect(parseSyncRecord(serializeSyncRecord(RECORD))).toEqual(RECORD);
  });

  it('reads anything malformed as absent, which never overwrites', () => {
    for (const raw of ['', 'nope', '{}', '{"v":2}', JSON.stringify({ ...RECORD, annotations: [{ nodeId: 1 }] }),
      JSON.stringify({ ...RECORD, description: { hash: 'x', bodyHash: 'y', origin: 'robot' } })]) {
      expect(parseSyncRecord(raw)).toBeNull();
    }
  });

  it('recognises only the exact description and link it wrote', () => {
    expect(ownDescription('Ours', RECORD)).toBe(true);
    expect(ownDescription('Ours ', RECORD)).toBe(false);
    expect(ownDescription('Ours', null)).toBe(false);
    expect(ownDocumentationLink([RECORD.link!.uri], RECORD)).toBe(true);
    expect(ownDocumentationLink([RECORD.link!.uri, 'x'], RECORD)).toBe(false);
    expect(ownDocumentationLink([], RECORD)).toBe(false);
  });

  it('hashes an annotation by label and pinned properties, not category or order', () => {
    const a = annotationHash({ label: '1 Icon', properties: [{ type: 'padding' }, { type: 'cornerRadius' }] });
    const b = annotationHash({ label: '1 Icon', properties: [{ type: 'cornerRadius' }, { type: 'padding' }], categoryId: 'c' } as never);
    expect(a).toBe(b);
    expect(annotationHash({ label: '2 Icon', properties: [] })).not.toBe(a);
  });
});

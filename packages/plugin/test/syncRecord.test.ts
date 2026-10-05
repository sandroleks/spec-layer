import { describe, it, expect } from 'vitest';
import {
  parseSyncRecord, serializeSyncRecord, ownDescription, ownDocumentationLink, annotationHash, descriptionHash,
  sameClaims, writableAnnotation, type SyncRecord,
} from '../src/syncRecord';

const RECORD: SyncRecord = {
  v: 1, syncedAt: 1, pluginVersion: '6.1.0',
  description: { hash: descriptionHash('Ours'), bodyHash: 'b', origin: 'authored' },
  link: { uri: 'https://www.figma.com/design/K/?node-id=1-2' },
  annotations: [{ nodeId: '1:2', hash: 'h', proposed: 'p' }, { nodeId: '1:3', hash: 'g' }],
  held: 'k',
};

describe('sync record', () => {
  it('round-trips', () => {
    expect(parseSyncRecord(serializeSyncRecord(RECORD))).toEqual(RECORD);
  });

  it('reads anything malformed as unreadable', () => {
    for (const raw of ['', 'nope', '{}', '{"v":2}', JSON.stringify({ ...RECORD, annotations: [{ nodeId: 1 }] }),
      JSON.stringify({ ...RECORD, description: { hash: 'x', bodyHash: 'y', origin: 'robot' } }),
      JSON.stringify({ ...RECORD, annotations: [{ nodeId: '1:2', hash: 'h', proposed: 3 }] }),
      JSON.stringify({ ...RECORD, held: 4 })]) {
      expect(parseSyncRecord(raw)).toBeNull();
    }
  });

  it('compares what two records claim, not when or by which build they were written', () => {
    const later = { ...RECORD, syncedAt: 99, pluginVersion: '6.2.0', annotations: [...RECORD.annotations].reverse() };
    expect(sameClaims(RECORD, later)).toBe(true);
    expect(sameClaims(RECORD, parseSyncRecord(serializeSyncRecord(RECORD))!)).toBe(true);
    const noHeld: SyncRecord = { ...RECORD };
    delete noHeld.held;
    const noLink: SyncRecord = { ...RECORD };
    delete noLink.link;
    expect(sameClaims(RECORD, noHeld)).toBe(false);
    expect(sameClaims(RECORD, noLink)).toBe(false);
    expect(sameClaims(RECORD, { ...RECORD, annotations: [{ nodeId: '1:2', hash: 'h' }, { nodeId: '1:3', hash: 'g' }] })).toBe(false);
  });

  it('writes an annotation back with one label field, keeping a designer’s formatting', () => {
    expect(writableAnnotation({ label: 'Use **bold**', labelMarkdown: 'Use **bold**', properties: [{ type: 'padding' }], categoryId: 'c' }))
      .toEqual({ labelMarkdown: 'Use **bold**', properties: [{ type: 'padding' }], categoryId: 'c' });
    expect(writableAnnotation({ label: 'Plain' })).toEqual({ label: 'Plain' });
    expect(writableAnnotation({ label: '', labelMarkdown: '', properties: [{ type: 'width' }] })).toEqual({ properties: [{ type: 'width' }] });
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

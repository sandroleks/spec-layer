import { describe, it, expect } from 'vitest';
import type { LibraryChange } from '@spec-layer/extractor';
import {
  truncateChanges, readVersionLog, currentVersion, resolveBump, readNote, proposalFor, bundlesToPrune, compactLog,
  MAX_CHANGES_BYTES, RETAINED_BUNDLES, MAX_NOTE_LENGTH, DETAILED_RECORDS, versionsKey, versionBundleKey,
  type VersionLog, type VersionRecord,
} from '../src/versions';

const change = (id: string, bump: LibraryChange['bump'] = 'patch'): LibraryChange => ({
  kind: 'changed', entity: 'token_value', component: null, id, name: id, from: 'a', to: 'b', scope: 'Light', bump,
});

const record = (version: string): VersionRecord => ({
  version, publishedAt: '2026-09-12T00:00:00.000Z', bump: 'patch', minimumBump: 'patch', note: null,
  contentHash: 'c', bundleHash: 'b', extractorVersion: '2', pluginVersion: '5.1.0',
  counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
});

/** A record with a non-empty change list, so compactLog has something to strip. */
const detailedRecord = (version: string): VersionRecord => ({
  ...record(version), counts: { major: 0, minor: 0, patch: 1 }, changes: [change(`c-${version}`)],
});

describe('keys', () => {
  it('names the log and per-version bundle keys', () => {
    expect(versionsKey('lib_1')).toBe('lib:lib_1:versions');
    expect(versionBundleKey('lib_1', '1.2.3')).toBe('lib:lib_1:bundle:1.2.3');
  });
});

describe('truncateChanges', () => {
  it('keeps every change when the JSON fits', () => {
    const changes = [change('a'), change('b')];
    expect(truncateChanges(changes)).toEqual({ changes, changesTruncated: false });
  });

  it('cuts after the last change that fits, in the given order, and says so', () => {
    const changes = Array.from({ length: 50 }, (_, i) => change(`token-${i}`));
    const cap = JSON.stringify(changes.slice(0, 10)).length + 5;
    const out = truncateChanges(changes, cap);
    expect(out.changesTruncated).toBe(true);
    expect(out.changes).toEqual(changes.slice(0, 10));
    expect(JSON.stringify(out.changes).length).toBeLessThanOrEqual(cap);
  });

  it('defaults to the 64 KB cap', () => {
    expect(MAX_CHANGES_BYTES).toBe(65_536);
  });

  it('measures bytes, not code units, with UTF-8 encoding', () => {
    const name = '色'.repeat(40);
    const changes = Array.from({ length: 50 }, (_, _i) => change(name, 'patch'));
    const first10 = changes.slice(0, 10);
    const cap = new TextEncoder().encode(JSON.stringify(first10)).byteLength + 5;
    const out = truncateChanges(changes, cap);
    expect(out.changesTruncated).toBe(true);
    expect(out.changes).toEqual(first10);
    expect(new TextEncoder().encode(JSON.stringify(out.changes)).byteLength).toBeLessThanOrEqual(cap);
  });
});

describe('readVersionLog and currentVersion', () => {
  const store = (value: string | null) => ({
    get: async () => value, put: async () => {}, delete: async () => {},
  });

  it('reads an empty log when the key is missing', async () => {
    expect(await readVersionLog(store(null), 'lib_1')).toEqual({ v: 1, records: [] });
  });

  it('reads a stored log and the newest version', async () => {
    const log: VersionLog = { v: 1, records: [record('1.1.0'), record('1.0.0')] };
    expect(await readVersionLog(store(JSON.stringify(log)), 'lib_1')).toEqual(log);
    expect(currentVersion(log)).toBe('1.1.0');
    expect(currentVersion({ v: 1, records: [] })).toBeNull();
  });
});

describe('resolveBump', () => {
  it('first versioned publish is initial 1.0.0, or the valid initialVersion', () => {
    expect(resolveBump({ storedVersion: null, minimumBump: null, bump: undefined, initialVersion: undefined }))
      .toEqual({ ok: true, version: '1.0.0', bump: 'initial', minimumBump: null });
    expect(resolveBump({ storedVersion: null, minimumBump: null, bump: undefined, initialVersion: '2.3.0' }))
      .toEqual({ ok: true, version: '2.3.0', bump: 'initial', minimumBump: null });
  });

  it('refuses an initialVersion that is not a semver', () => {
    expect(resolveBump({ storedVersion: null, minimumBump: null, bump: undefined, initialVersion: '2.0' }))
      .toEqual({ ok: false, status: 400, body: { error: 'invalid_initial_version' } });
  });

  it('a content change with no property changes is at least a patch', () => {
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: null, bump: undefined, initialVersion: undefined }))
      .toEqual({ ok: true, version: '1.4.3', bump: 'patch', minimumBump: 'patch' });
  });

  it('applies the minimum when the client sends no bump', () => {
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: 'minor', bump: undefined, initialVersion: undefined }))
      .toEqual({ ok: true, version: '1.5.0', bump: 'minor', minimumBump: 'minor' });
  });

  it('lets the client raise, never lower', () => {
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: 'minor', bump: 'major', initialVersion: undefined }))
      .toEqual({ ok: true, version: '2.0.0', bump: 'major', minimumBump: 'minor' });
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: 'minor', bump: 'patch', initialVersion: undefined }))
      .toEqual({ ok: false, status: 400, body: { error: 'bump_below_minimum', minimumBump: 'minor', proposedVersion: '1.5.0' } });
  });

  it('refuses a bump that is not one of the three words', () => {
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: 'minor', bump: 'huge', initialVersion: undefined }))
      .toEqual({ ok: false, status: 400, body: { error: 'invalid_bump' } });
  });

  it('ignores initialVersion once a version exists', () => {
    expect(resolveBump({ storedVersion: '1.4.2', minimumBump: 'patch', bump: undefined, initialVersion: '9.9.9' }))
      .toEqual({ ok: true, version: '1.4.3', bump: 'patch', minimumBump: 'patch' });
  });
});

describe('readNote', () => {
  it('accepts absent, null, and a string up to 500 characters', () => {
    expect(readNote(undefined)).toBeNull();
    expect(readNote(null)).toBeNull();
    expect(readNote('  Raised for the new axis.  ')).toBe('Raised for the new axis.');
    expect(readNote('')).toBeNull();
    expect(readNote('x'.repeat(MAX_NOTE_LENGTH))).toBe('x'.repeat(MAX_NOTE_LENGTH));
  });

  it('rejects a longer note and a non-string', () => {
    expect(readNote('x'.repeat(MAX_NOTE_LENGTH + 1))).toBeUndefined();
    expect(readNote(42)).toBeUndefined();
  });
});

describe('proposalFor', () => {
  it('describes a first publish', () => {
    expect(proposalFor(null, null)).toEqual({
      currentVersion: null, minimumBump: null, proposedVersion: '1.0.0',
      counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
    });
  });

  it('describes a change against a stored version', () => {
    const diff = { changes: [change('a', 'minor')], minimumBump: 'minor' as const, counts: { major: 0, minor: 1, patch: 0 } };
    expect(proposalFor('1.4.2', diff)).toEqual({
      currentVersion: '1.4.2', minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: diff.counts, changes: diff.changes, changesTruncated: false,
    });
  });

  it('a changed bundle with no property changes proposes a patch', () => {
    const diff = { changes: [], minimumBump: null, counts: { major: 0, minor: 0, patch: 0 } };
    expect(proposalFor('1.4.2', diff)).toMatchObject({ minimumBump: 'patch', proposedVersion: '1.4.3' });
  });

  it('keeps the stored version when the bundle could not be parsed', () => {
    expect(proposalFor('1.4.2', null)).toEqual({
      currentVersion: '1.4.2', minimumBump: 'patch', proposedVersion: '1.4.3',
      counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
    });
  });

  it('previews a valid initialVersion on a first publish', () => {
    expect(proposalFor(null, null, '2.1.0')).toMatchObject({ proposedVersion: '2.1.0' });
  });

  it('falls back to 1.0.0 for an invalid initialVersion; proposalFor itself does not reject it', () => {
    expect(proposalFor(null, null, '2.0')).toMatchObject({ proposedVersion: '1.0.0' });
  });

  it('ignores initialVersion once a version is already stored', () => {
    const diff = { changes: [change('a', 'minor')], minimumBump: 'minor' as const, counts: { major: 0, minor: 1, patch: 0 } };
    expect(proposalFor('1.4.2', diff, '9.9.9')).toMatchObject({ proposedVersion: '1.5.0' });
  });
});

describe('bundlesToPrune', () => {
  it('names only the one version that just fell past the newest ten, not every older one', () => {
    const versions = Array.from({ length: 12 }, (_, i) => `1.${11 - i}.0`);
    const log: VersionLog = { v: 1, records: versions.map(record) };
    expect(RETAINED_BUNDLES).toBe(10);
    // Only the record that just fell out of the retained window (index 10):
    // a publish only ever pushes one record onto the log, so at most one
    // bundle ever falls out. Naming every older one too (the old behavior)
    // means one subrequest per publish forever, which crosses the Worker's
    // subrequest limit by roughly the thousandth publish.
    expect(bundlesToPrune(log)).toEqual(['1.1.0']);
    expect(bundlesToPrune({ v: 1, records: versions.slice(0, 10).map(record) })).toEqual([]);
  });
});

describe('compactLog', () => {
  it('leaves the newest DETAILED_RECORDS records untouched', () => {
    expect(DETAILED_RECORDS).toBe(50);
    const records = Array.from({ length: DETAILED_RECORDS }, (_, i) => detailedRecord(`1.${DETAILED_RECORDS - i}.0`));
    const log: VersionLog = { v: 1, records };
    expect(compactLog(log)).toEqual(log);
  });

  it('empties changes and flags truncation for records past the newest 50, keeping counts, note, version and dates', () => {
    const records = Array.from({ length: 52 }, (_, i) => detailedRecord(`1.${51 - i}.0`));
    const log: VersionLog = { v: 1, records };
    const out = compactLog(log);
    expect(out.records).toHaveLength(52);
    for (const rec of out.records.slice(0, 50)) expect(rec.changes.length).toBeGreaterThan(0);
    for (const rec of out.records.slice(50)) {
      expect(rec.changes).toEqual([]);
      expect(rec.changesTruncated).toBe(true);
    }
    // Nothing but `changes`/`changesTruncated` moved on the compacted ones.
    const compacted = out.records[50];
    const original = records[50];
    expect(compacted).toEqual({ ...original, changes: [], changesTruncated: true });
    expect(compacted.counts).toEqual(original.counts);
    expect(compacted.version).toBe(original.version);
    expect(compacted.publishedAt).toBe(original.publishedAt);
    expect(compacted.note).toBe(original.note);
  });

  it('is idempotent and leaves a record with no changes alone', () => {
    const log: VersionLog = { v: 1, records: [record('1.0.0'), detailedRecord('2.0.0')] };
    const once = compactLog(log);
    expect(compactLog(once)).toEqual(once);
    // An already-empty record (an 'initial' publish, say) gains no
    // changesTruncated flag it did not already carry: it was never truncated,
    // just genuinely empty.
    expect(once.records.find((r) => r.version === '1.0.0')?.changesTruncated).toBe(false);
  });
});

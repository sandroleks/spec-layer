import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { SerializedFoundation } from '@spec-layer/extractor';
import type { PublishComponentSource, UiToMain } from '../src/messages';
import {
  buildPublishBundle, publishBundle, rotatePullKey, setupCommand,
  type PublishSources, type PublishSourcesMsg,
} from '../src/ui/publish';
import type { ProxyAuth } from '../src/ui/proxy';

// ---------------------------------------------------------------------------
// Fixtures — lifted from copyBrief.test.ts and copyFoundation.test.ts so this
// module exercises the same synthetic SerializedNode / SerializedFoundation
// shapes those two files already validate, rather than a hand-invented one.
// ---------------------------------------------------------------------------

/** Same minimal COMPONENT node shape as copyBrief.test.ts's NODE fixture. */
function componentNode(id: string, name: string, key: string) {
  return {
    id, name, type: 'COMPONENT', visible: true, key,
    children: [], bindings: [],
  } as never;
}

function componentSource(
  docId: string, name: string, id: string, key: string,
): PublishComponentSource {
  return { docId, name, node: componentNode(id, name, key), prose: null };
}

/** Same SerializedFoundation fixture as copyFoundation.test.ts's DUMP. */
const FOUNDATION: SerializedFoundation = {
  fileKey: 'F1',
  fileName: 'Company DS',
  extractedAt: '2026-08-14T00:00:00.000Z',
  externals: [],
  textStyles: [],
  effectStyles: [],
  collections: [{
    id: 'C1', name: 'Color', defaultModeId: 'm1',
    modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [
      {
        id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, scopes: ['FRAME_FILL'],
        valuesByMode: { m1: { r: 0.1401, g: 0.3901, b: 0.9201, a: 0.125 } },
      },
      {
        id: 'V:gap', name: 'space/gap', resolvedType: 'FLOAT', description: '',
        codeSyntax: {}, scopes: ['GAP'], valuesByMode: { m1: 8 },
      },
    ],
  }],
};

const GENERATED_AT = '2026-09-01T00:00:00.000Z';

function baseSources(overrides: Partial<PublishSources> = {}): PublishSources {
  return {
    foundation: FOUNDATION,
    groupDescriptions: {},
    components: [
      componentSource('doc-button', 'button', '1:100', 'k-button'),
      componentSource('doc-badge', 'Badge', '1:200', 'k-badge'),
    ],
    fileKey: 'F1',
    fileName: 'Design System',
    ...overrides,
  };
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

describe('buildPublishBundle', () => {
  it('builds a bundle with foundation and components sorted by code units', () => {
    const bundle = buildPublishBundle(baseSources(), GENERATED_AT);

    // schema/version/extractorVersion fields exact; fileName from sources.
    expect(bundle.schema).toBe('spec-layer-library-bundle');
    expect(bundle.version).toBe('1.0.0');
    expect(bundle.fileName).toBe('Design System');
    expect(typeof bundle.extractorVersion).toBe('string');
    expect(bundle.extractorVersion.length).toBeGreaterThan(0);

    // Two components named 'button' and 'Badge': 'Badge' first (code-unit order).
    expect(bundle.components.map((c) => c.name)).toEqual(['Badge', 'button']);

    // foundation.ai is a non-empty YAML string; each component ai likewise.
    expect(typeof bundle.foundation?.ai).toBe('string');
    expect(bundle.foundation!.ai.length).toBeGreaterThan(0);
    for (const component of bundle.components) {
      expect(typeof component.ai).toBe('string');
      expect(component.ai.length).toBeGreaterThan(0);
    }

    // Every artifact has spec_layer.export.content_hash (string, 64 hex).
    const foundationArtifact = bundle.foundation!.artifact as unknown as
      { spec_layer: { export: { content_hash: string } } };
    expect(foundationArtifact.spec_layer.export.content_hash).toMatch(HASH_RE);
    for (const component of bundle.components) {
      const artifact = component.artifact as { spec_layer: { export: { content_hash: string } } };
      expect(artifact.spec_layer.export.content_hash).toMatch(HASH_RE);
    }
  });

  it('embeds the foundation into component artifacts', () => {
    const bundle = buildPublishBundle(baseSources(), GENERATED_AT);
    // With a foundation present, a component artifact gains foundation_content_hash.
    for (const component of bundle.components) {
      const artifact = component.artifact as { foundation_content_hash?: string };
      expect(typeof artifact.foundation_content_hash).toBe('string');
      expect(artifact.foundation_content_hash).toMatch(HASH_RE);
    }
  });

  it('applies group descriptions as generated guidelines', () => {
    const bundle = buildPublishBundle(baseSources({
      groupDescriptions: { Color: { 'color/bg': 'Backgrounds behind content.' } },
    }), GENERATED_AT);
    // Non-empty groupDescriptions -> bundle.foundation.artifact.guidelines.origin === 'generated'.
    expect(bundle.foundation?.artifact.guidelines?.origin).toBe('generated');
  });

  it('builds foundation: null when sources.foundation is null', () => {
    const bundle = buildPublishBundle(baseSources({ foundation: null }), GENERATED_AT);
    expect(bundle.foundation).toBeNull();
    // No foundation to embed, so components go without foundation_content_hash.
    for (const component of bundle.components) {
      const artifact = component.artifact as { foundation_content_hash?: string };
      expect(artifact.foundation_content_hash).toBeUndefined();
    }
  });

  it('is deterministic for a fixed generatedAt', () => {
    // Two calls with identical inputs produce identical JSON.stringify output.
    const sources = baseSources();
    const first = buildPublishBundle(sources, GENERATED_AT);
    const second = buildPublishBundle(sources, GENERATED_AT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('publishBundle', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };
  const BUNDLE = buildPublishBundle(baseSources(), GENERATED_AT);

  function jsonResponse(status: number, body: unknown): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }

  it('creates on 201 and returns the pull key', async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse((init as RequestInit).body as string) as { bundle: unknown; libraryId?: string };
      expect(parsed.bundle).toEqual(BUNDLE);
      expect('libraryId' in parsed).toBe(false);
      return jsonResponse(201, {
        libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
      });
    });
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'created', libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('updates on 200 with libraryId in the body', async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse((init as RequestInit).body as string) as { bundle: unknown; libraryId?: string };
      expect(parsed.libraryId).toBe('lib_existing');
      return jsonResponse(200, {
        libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z',
      });
    });
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_existing', fetcher });
    expect(outcome).toEqual({
      kind: 'updated', libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z',
    });
  });

  it('maps 404/not_owner on republish to gone', async () => {
    const notFound = vi.fn(async () => jsonResponse(404, {}));
    expect(await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_gone', fetcher: notFound }))
      .toEqual({ kind: 'gone' });

    const notOwner = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    expect(await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_stolen', fetcher: notOwner }))
      .toEqual({ kind: 'gone' });
  });

  it('maps 401 license errors to plugin-voice copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, { error: 'license_not_active' }));
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'Publishing needs an active Pro license.' });
  });

  it('maps 429 rate limiting to copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(429, {}));
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Too many requests just now. Give it a minute.',
    });
  });

  it('maps bundle_too_large with the sizes', async () => {
    const fetcher = vi.fn(async () => jsonResponse(413, {
      error: 'bundle_too_large', size: 120000, limit: 100000,
    }));
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'This library is larger than the publish limit (120000 of 100000 characters).',
    });
  });

  it('maps library_limit (403) with the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 3 }));
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'This license already publishes 3 libraries, which is the limit.',
    });
  });

  it('maps an unmapped status to a generic HTTP message', async () => {
    const fetcher = vi.fn(async () => jsonResponse(500, {}));
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Publishing failed with HTTP 500.',
    });
  });

  it('maps network failure to unreachable copy', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network down'); });
    const outcome = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Could not reach the publish service. Check your connection and try again.',
    });
  });

  it('refuses locally with no license identity, never hitting the network', async () => {
    const fetcher = vi.fn();
    const noAuth: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };
    const outcome = await publishBundle(BUNDLE, { auth: noAuth, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'Publishing needs an active Pro license.' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('rotatePullKey', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };

  it('returns the new key on 200 and copy on error', async () => {
    const okFetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ pullKey: 'sl_new_pull' }),
    } as unknown as Response));
    expect(await rotatePullKey('lib_1', AUTH, okFetch)).toEqual({ kind: 'rotated', pullKey: 'sl_new_pull' });

    const unauthorizedFetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}),
    } as unknown as Response));
    expect(await rotatePullKey('lib_1', AUTH, unauthorizedFetch)).toEqual({
      kind: 'error', message: 'Rotating the key needs an active Pro license.',
    });

    const serverErrorFetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({}),
    } as unknown as Response));
    expect(await rotatePullKey('lib_1', AUTH, serverErrorFetch)).toEqual({
      kind: 'error', message: 'Rotating the key failed with HTTP 500.',
    });

    const networkFailFetch = vi.fn(async () => { throw new Error('offline'); });
    expect(await rotatePullKey('lib_1', AUTH, networkFailFetch)).toEqual({
      kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.',
    });

    const noAuth: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };
    const unusedFetch = vi.fn();
    expect(await rotatePullKey('lib_1', noAuth, unusedFetch)).toEqual({
      kind: 'error', message: 'Rotating the key needs an active Pro license.',
    });
    expect(unusedFetch).not.toHaveBeenCalled();
  });
});

describe('voice: no em dashes in error copy', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };
  const NO_AUTH: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };

  function jsonResponse(status: number, body: unknown): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }

  /**
   * Drives every publishBundle/rotatePullKey branch that can produce an
   * error message through the REAL functions with stubbed fetch responses,
   * so an em dash introduced into publish.ts's own copy fails this test
   * instead of a hand-copied duplicate of that copy.
   */
  it('collects every real error message and finds no em dash', async () => {
    const bundle = buildPublishBundle(baseSources(), GENERATED_AT);
    const messages: string[] = [];

    const publishCases: Array<{ auth: ProxyAuth; libraryId: string | null; fetcher: typeof fetch }> = [
      // 401 license_not_active
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(401, { error: 'license_not_active' })) },
      // 429 rate limited
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(429, {})) },
      // 403 library_limit with a limit value
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 5 })) },
      // 413 bundle_too_large with sizes
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(413, { error: 'bundle_too_large', size: 999, limit: 500 })) },
      // unmapped status
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(500, {})) },
      // network throw
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => { throw new Error('offline'); }) },
      // missing auth, never reaches the network
      { auth: NO_AUTH, libraryId: null, fetcher: vi.fn() },
    ];
    for (const testCase of publishCases) {
      const outcome = await publishBundle(bundle, testCase);
      if (outcome.kind === 'error') messages.push(outcome.message);
    }

    // 404/not_owner on republish maps to `gone`, which carries no message, so
    // it contributes nothing to this sweep by construction.

    const rotateCases: Array<{ auth: ProxyAuth; fetcher: typeof fetch }> = [
      { auth: AUTH, fetcher: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)) },
      { auth: AUTH, fetcher: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)) },
      { auth: AUTH, fetcher: vi.fn(async () => { throw new Error('offline'); }) },
      { auth: NO_AUTH, fetcher: vi.fn() },
    ];
    for (const testCase of rotateCases) {
      const outcome = await rotatePullKey('lib_1', testCase.auth, testCase.fetcher);
      if (outcome.kind === 'error') messages.push(outcome.message);
    }

    // Every branch above produces a kind: 'error' outcome, so the sweep is
    // proof the loops above actually ran rather than silently matching zero.
    expect(messages.length).toBe(publishCases.length + rotateCases.length);
    for (const message of messages) {
      expect(message).not.toContain('—');
    }
  });
});

describe('setupCommand', () => {
  it('produces the exact one-liner', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48)))
      .toBe('SPEC_LAYER_KEY=sl_' + 'b'.repeat(48) + ' npx spec-layer pull --id lib_aaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

// ---------------------------------------------------------------------------
// Publish controller — module state driving the Library screen's "Publish for
// developers" section. Each test starts from a fresh module instance
// (vi.resetModules + a dynamic re-import) rather than a hand-rolled reset
// helper, the same approach copyFoundation.test.ts uses for actions.ts: a
// reset export would put test scaffolding in production code for one
// assertion's sake.
// ---------------------------------------------------------------------------

describe('publish controller', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };

  function jsonResponse(status: number, body: unknown): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }

  function sourcesMsg(overrides: Partial<PublishSourcesMsg> = {}): PublishSourcesMsg {
    return {
      type: 'publishSources',
      foundation: null,
      groupDescriptions: {},
      components: [componentSource('doc-button', 'Button', '1:100', 'k-button')],
      skipped: [],
      fileKey: 'F1',
      fileName: 'Design System',
      ...overrides,
    };
  }

  let publish: typeof import('../src/ui/publish');
  let sent: UiToMain[];
  let repaintCount: number;

  beforeEach(async () => {
    vi.resetModules();
    publish = await import('../src/ui/publish');
    sent = [];
    repaintCount = 0;
    publish.setPublishHost({
      repaint: () => { repaintCount += 1; },
      send: (msg) => { sent.push(msg); },
    });
  });

  it('onPublishClick moves to collecting and requests sources', () => {
    publish.onPublishClick(AUTH);
    expect(publish.publishState().status).toBe('collecting');
    expect(publish.publishState().message).toBeNull();
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);
    expect(repaintCount).toBe(1);

    // A second click while already collecting is a no-op: no extra request,
    // no extra repaint, and the status is untouched.
    publish.onPublishClick(AUTH);
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);
    expect(repaintCount).toBe(1);
  });

  it('blocks publish when sources arrive with skipped components', async () => {
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn();
    await publish.onPublishSources(
      sourcesMsg({ skipped: [{ name: 'Button', reason: 'missing binding' }] }),
      AUTH,
      fetcher,
    );
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Nothing was published. 1 component could not be read: Button. Fix or remove those docs, then publish again.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.libraryId).toBeNull();
    expect(state.pullKey).toBeNull();
  });

  it('publishes fresh sources and stores the new key', async () => {
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      expect('libraryId' in body).toBe(false);
      return jsonResponse(201, {
        libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
      });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(state.status).toBe('done');
    expect(state.libraryId).toBe('lib_new');
    expect(state.pullKey).toBe('sl_pull');
    expect(state.lastPublishedAt).toBe('2026-09-01T00:00:01.000Z');
    expect(state.message).toBe('Published. Anyone with the key can pull this version.');
    expect(sent).toContainEqual({
      type: 'setPublishInfo', fileKey: 'F1', libraryId: 'lib_new', pullKey: 'sl_pull',
    });
  });

  it('republishes with the known libraryId', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_existing', pullKey: 'sl_pull_1', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);
    expect(publish.publishState().libraryId).toBe('lib_existing');

    publish.onPublishClick(AUTH);
    const updateFetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      expect(body.libraryId).toBe('lib_existing');
      return jsonResponse(200, { libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z' });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, updateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('done');
    expect(state.libraryId).toBe('lib_existing');
    // The pull key never changes on an update: only a create or a rotate mint
    // a new one.
    expect(state.pullKey).toBe('sl_pull_1');
    expect(state.message).toBe('Published. Developers get this version on their next pull.');
    expect(updateFetcher).toHaveBeenCalledTimes(1);
  });

  it('retries as a fresh create when the republish target is gone', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_old', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);
    expect(publish.publishState().libraryId).toBe('lib_old');

    publish.onPublishClick(AUTH);
    let call = 0;
    const fetcher = vi.fn(async (_url, init) => {
      call += 1;
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      if (call === 1) {
        expect(body.libraryId).toBe('lib_old');
        return jsonResponse(404, {});
      }
      expect('libraryId' in body).toBe(false);
      return jsonResponse(201, {
        libraryId: 'lib_new', pullKey: 'sl_new', publishedAt: '2026-09-01T00:00:02.000Z',
      });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(state.status).toBe('done');
    expect(state.libraryId).toBe('lib_new');
    expect(state.pullKey).toBe('sl_new');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent.filter((msg) => msg.type === 'setPublishInfo')).toHaveLength(2);
    expect(sent.at(-1)).toEqual({
      type: 'setPublishInfo', fileKey: 'F1', libraryId: 'lib_new', pullKey: 'sl_new',
    });
  });

  it('surfaces publish errors verbatim in state', async () => {
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(500, {}));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe('Publishing failed with HTTP 500.');
  });

  it('onPublishSourcesError sets an honest error, without touching any stored key', () => {
    publish.onPublishInfo({ type: 'publishInfo', fileKey: 'F1', libraryId: 'lib_1', pullKey: 'sl_1' });
    publish.onPublishSourcesError('the selection has no components');
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Could not read the library. Nothing was published. the selection has no components',
    );
    // A failed source read leaves any already-known library identity intact.
    expect(state.libraryId).toBe('lib_1');
    expect(state.pullKey).toBe('sl_1');
  });

  it('onPublishInfo seeds libraryId/pullKey only while idle', () => {
    publish.onPublishInfo({ type: 'publishInfo', fileKey: 'F1', libraryId: 'lib_seed', pullKey: 'sl_seed' });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
    expect(repaintCount).toBeGreaterThan(0);

    // Once a publish has started this session, a slow/stale publishInfo reply
    // must not clobber what already happened.
    publish.onPublishClick(AUTH);
    publish.onPublishInfo({ type: 'publishInfo', fileKey: 'F1', libraryId: 'lib_other', pullKey: 'sl_other' });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
  });

  it('onRotateClick replaces the stored key', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_1', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);

    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.pullKey).toBe('sl_rotated');
    expect(state.libraryId).toBe('lib_1');
    expect(state.message).toBe(
      'Key rotated. The old key no longer works. Share the new command with your developers.',
    );
    expect(sent).toContainEqual({
      type: 'setPublishInfo', fileKey: 'F1', libraryId: 'lib_1', pullKey: 'sl_rotated',
    });
  });

  it('onRotateClick surfaces a rotate failure without losing the current key', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_1', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);

    const rotateFetcher = vi.fn(async () => jsonResponse(401, {}));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe('Rotating the key needs an active Pro license.');
    expect(state.pullKey).toBe('sl_old');
  });
});

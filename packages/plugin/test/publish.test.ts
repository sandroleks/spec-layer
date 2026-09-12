import { beforeEach, describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { libraryBundleContentHash, type SerializedFoundation } from '@spec-layer/extractor';
import type { PublishComponentSource, UiToMain } from '../src/messages';
import {
  agentSetupMessage, buildPublishBundle, publishBundle, rotatePullKey, setupCommand,
  type PublishSources, type PublishSourcesMsg,
} from '../src/ui/publish';
import type { ProxyAuth } from '../src/ui/proxy';
import { downloadBytes } from '../src/ui/download';

// The Node test environment has no Blob/document/URL, so downloadBytes'
// real DOM contact would throw here. Keep the real zipFiles (it is pure and
// exercised for real below) and stub only the DOM-touching half; the actual
// browser behaviour is covered by the manual Figma matrix, not unit tests.
vi.mock('../src/ui/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/download')>();
  return { ...actual, downloadBytes: vi.fn() };
});

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

    // foundation.ai is a non-empty DTCG resolver document as JSON text; each
    // component ai is still a non-empty YAML string.
    expect(typeof bundle.foundation?.ai).toBe('string');
    expect(bundle.foundation!.ai.length).toBeGreaterThan(0);
    expect((JSON.parse(bundle.foundation!.ai) as { version: string }).version).toBe('2025.10');
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

  it('keeps one content identity across build times, though the bytes differ', () => {
    // The bug this pins: every artifact's export envelope carries the build
    // timestamp, so a byte hash of the bundle changes on every click of
    // Publish and the proxy can never see an unchanged republish.
    const sources = baseSources();
    const first = buildPublishBundle(sources, '2026-09-01T00:00:00.000Z');
    const second = buildPublishBundle(sources, '2026-09-01T00:00:05.000Z');
    expect(sha256(JSON.stringify(first))).not.toBe(sha256(JSON.stringify(second)));
    expect(libraryBundleContentHash(first)).toBe(libraryBundleContentHash(second));
  });

  it('changes its content identity when a source changes', () => {
    const base = libraryBundleContentHash(buildPublishBundle(baseSources(), GENERATED_AT));
    const renamed = buildPublishBundle(baseSources({ fileName: 'Renamed' }), GENERATED_AT);
    expect(libraryBundleContentHash(renamed)).not.toBe(base);
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
  const LIB = 'lib_' + 'b'.repeat(24);

  /** A response with real headers, since publishBundle reads the quota off them. */
  function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      json: async () => body,
    } as unknown as Response;
  }

  const PUBLISH_QUOTA_HEADERS = {
    'X-Tier': 'free', 'X-Quota-Used': '3', 'X-Quota-Limit': '10',
    'X-Quota-Remaining': '7', 'X-Quota-Resets-At': '2026-10-01T00:00:00.000Z',
  };

  it('creates on 201 and returns the pull key', async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse((init as RequestInit).body as string) as { bundle: unknown; libraryId?: string };
      expect(parsed.bundle).toEqual(BUNDLE);
      expect('libraryId' in parsed).toBe(false);
      return jsonResponse(201, {
        libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
      });
    });
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
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
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_existing', fetcher });
    expect(outcome).toEqual({
      kind: 'updated', libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z',
    });
  });

  it('maps 404 on republish to gone', async () => {
    const notFound = vi.fn(async () => jsonResponse(404, {}));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_gone', fetcher: notFound })).outcome)
      .toEqual({ kind: 'gone' });
  });

  it('keeps a not_owner refusal as an error, never as gone', async () => {
    // A teammate who is not the owner must not wipe the file's library id.
    const notOwner = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_theirs', fetcher: notOwner })).outcome)
      .toEqual({
        kind: 'error',
        message: 'This library was published by another account, or from a device that no longer holds its key. Nothing was published.',
      });
  });

  it('sends the pull key with a republish and never with a create', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher = vi.fn(async (_url, init) => {
      seen.push((init as RequestInit).headers as Record<string, string>);
      return jsonResponse(200, { libraryId: 'lib_mine', publishedAt: '2026-09-01T00:00:02.000Z' });
    });
    await publishBundle(BUNDLE, { auth: AUTH, libraryId: 'lib_mine', pullKey: 'sl_pull', fetcher });
    await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, pullKey: 'sl_pull', fetcher });
    expect(seen[0]['X-Pull-Key']).toBe('sl_pull');
    expect('X-Pull-Key' in seen[1]).toBe(false);
  });

  it('maps 401 to a plain sign-in problem, not a Pro requirement', async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, { error: 'unauthenticated' }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'Publishing needs a signed-in Figma account or a license key.' });
  });

  it('maps a 401 for a key that is not active to the key, not to signing in', async () => {
    const expired = vi.fn(async () => jsonResponse(401, { error: 'license_not_active', reason: 'expired' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: expired })).outcome).toEqual({
      kind: 'error',
      message: 'This license key is not active. Renew it in Settings, or sign in to Figma to publish on the free plan.',
    });
    const unreachable = vi.fn(async () => jsonResponse(401, { error: 'license_not_active', reason: 'unreachable' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: unreachable })).outcome).toEqual({
      kind: 'error',
      message: 'Could not check your license key just now. Nothing was published. Try again in a minute.',
    });
  });

  it('counts the libraries a lapsed license still owns in the free limit copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, owned: 3, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: 'Marketing DS' },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect((outcome as { message: string }).message)
      .toBe('Free plans publish one Figma file. This account already publishes 3 files, including Marketing DS. Upgrade to Pro to publish up to 10 files.');
  });

  it('maps 402 to the monthly updates message with the reset date', async () => {
    const fetcher = vi.fn(async () => jsonResponse(402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'You have used your 10 free updates for this month. Upgrade to Pro or publish again after Oct 1.',
    });
  });

  it('maps a free library_limit to the one-file message naming the other file', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: 'Marketing DS' },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Free plans publish one Figma file. This account already publishes Marketing DS. Upgrade to Pro to publish up to 10 files.',
    });
  });

  it('says "another file" when the existing library has no stored name', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: null },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect((outcome as { message: string }).message)
      .toBe('Free plans publish one Figma file. This account already publishes another file. Upgrade to Pro to publish up to 10 files.');
  });

  it('maps a Pro library_limit to the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 10 }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'This plan already publishes 10 Figma files, which is the limit.' });
  });

  it('reports an unchanged republish as its own outcome', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', unchanged: true }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome).toEqual({ kind: 'unchanged', libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('returns the publish allowance the response headers state', async () => {
    const fetcher = vi.fn(async () => jsonResponse(
      200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z' }, PUBLISH_QUOTA_HEADERS,
    ));
    const { outcome, quota } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome.kind).toBe('updated');
    expect(quota).toEqual({
      tier: 'free', used: 3, limit: 10, remaining: 7, resetsAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('returns the allowance from a 402 refusal too', async () => {
    const exhausted = {
      ...PUBLISH_QUOTA_HEADERS, 'X-Quota-Used': '10', 'X-Quota-Remaining': '0',
    };
    const fetcher = vi.fn(async () => jsonResponse(
      402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' }, exhausted,
    ));
    const { outcome, quota } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome.kind).toBe('error');
    expect(quota).toMatchObject({ used: 10, remaining: 0 });
  });

  it('returns a null allowance when the response carried no quota headers', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: 'x' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher })).quota).toBeNull();
    const offline = vi.fn(async () => { throw new Error('offline'); });
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher: offline })).quota).toBeNull();
  });

  it('maps 409 publish_pending to a wait-and-retry message', async () => {
    const fetcher = vi.fn(async () => jsonResponse(409, { error: 'publish_pending' }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'A publish is already running. Give it a moment and try again.',
    });
  });

  it('maps 429 rate limiting to copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(429, {}));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Too many requests just now. Give it a minute.',
    });
  });

  it('maps bundle_too_large with the sizes', async () => {
    const fetcher = vi.fn(async () => jsonResponse(413, {
      error: 'bundle_too_large', size: 5_640_000, limit: 5_000_000,
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'This library is larger than the publish limit (5.6 MB of 5 MB).',
    });
  });

  it('maps library_limit (403) with the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 3 }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'This plan already publishes 3 Figma files, which is the limit.',
    });
  });

  it('maps an unmapped status to a generic HTTP message', async () => {
    const fetcher = vi.fn(async () => jsonResponse(500, {}));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Publishing failed with HTTP 500.',
    });
  });

  it('maps network failure to unreachable copy', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network down'); });
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Could not reach the publish service. Check your connection and try again.',
    });
  });

  it('refuses locally with no license identity, never hitting the network', async () => {
    const fetcher = vi.fn();
    const noAuth: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };
    const { outcome } = await publishBundle(BUNDLE, { auth: noAuth, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'Publishing needs a signed-in Figma account or a license key.' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('rotatePullKey', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };

  it('returns the new key on 200 and copy on error', async () => {
    const okFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => ({ pullKey: 'sl_new_pull' }),
    } as unknown as Response));
    expect(await rotatePullKey('lib_1', AUTH, okFetch, 'sl_current')).toEqual({ kind: 'rotated', pullKey: 'sl_new_pull' });
    // The current key rides along so a free-plan owner can prove the library is theirs.
    expect(okFetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Pull-Key': 'sl_current' });

    const unauthorizedFetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}),
    } as unknown as Response));
    expect(await rotatePullKey('lib_1', AUTH, unauthorizedFetch)).toEqual({
      kind: 'error', message: 'Rotating the key failed with HTTP 401.',
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
      kind: 'error', message: 'Rotating the key needs a signed-in Figma account or a license key.',
    });
    expect(unusedFetch).not.toHaveBeenCalled();
  });
});

describe('voice: no em dashes in error copy', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };
  const NO_AUTH: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };

  /** A response with real headers, since publishBundle reads the quota off them. */
  function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
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
      // 409 publish_pending
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(409, { error: 'publish_pending' })) },
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
      const { outcome } = await publishBundle(bundle, testCase);
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
      .toBe('npx spec-layer setup --id lib_aaaaaaaaaaaaaaaaaaaaaaaa --key sl_' + 'b'.repeat(48));
  });

  // The voice rules forbid em dashes anywhere in plugin UI copy, and this
  // string is rendered into the publish screen.
  it('carries no em dash', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48))).not.toContain('—');
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
  const LIB = 'lib_1';
  const KEY = 'sl_old';

  /** A response with real headers, since publishBundle reads the quota off them. */
  function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
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
      publishInfo: { libraryId: null, pullKey: null, publishedAt: null },
      ...overrides,
    };
  }

  let publish: typeof import('../src/ui/publish');
  let sent: UiToMain[];
  let repaintCount: number;
  let quotaSnapshots: Array<import('../src/ui/publish').PublishQuotaSnapshot>;
  let notified: string[];

  beforeEach(async () => {
    vi.resetModules();
    publish = await import('../src/ui/publish');
    sent = [];
    repaintCount = 0;
    quotaSnapshots = [];
    notified = [];
    publish.setPublishHost({
      repaint: () => { repaintCount += 1; },
      send: (msg) => { sent.push(msg); },
      onPublishQuota: (snapshot) => { quotaSnapshots.push(snapshot); },
      notify: (message) => { notified.push(message); },
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
    // Success is a toast, not a line under the blocks.
    expect(state.message).toBeNull();
    expect(notified).toEqual(['Published. Anyone with the key can pull this version.']);
    expect(sent).toContainEqual({
      type: 'setPublishInfo', libraryId: 'lib_new', pullKey: 'sl_pull',
    });
  });

  it('hands the host the allowance a create reports, before repainting', async () => {
    const headers = {
      'X-Tier': 'free', 'X-Quota-Used': '1', 'X-Quota-Limit': '10',
      'X-Quota-Remaining': '9', 'X-Quota-Resets-At': '2026-10-01T00:00:00.000Z',
    };
    publish.onPublishClick(AUTH);
    const repaintsBeforePublish = repaintCount;
    const fetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
    }, headers));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(quotaSnapshots).toEqual([{
      tier: 'free', used: 1, limit: 10, remaining: 9, resetsAt: '2026-10-01T00:00:00.000Z',
    }]);
    // The meter is handed over while the result is still being applied, so one
    // paint shows both. This is why the count is not a fetch behind the screen.
    expect(repaintCount).toBeGreaterThan(repaintsBeforePublish);
  });

  it('hands the host the allowance a 402 refusal reports', async () => {
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(402, {
      error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z',
    }, {
      'X-Tier': 'free', 'X-Quota-Used': '10', 'X-Quota-Limit': '10',
      'X-Quota-Remaining': '0', 'X-Quota-Resets-At': '2026-10-01T00:00:00.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState().status).toBe('error');
    expect(quotaSnapshots).toEqual([{
      tier: 'free', used: 10, limit: 10, remaining: 0, resetsAt: '2026-10-01T00:00:00.000Z',
    }]);
  });

  it('leaves the allowance alone when the response carried no quota headers', async () => {
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState().status).toBe('done');
    expect(quotaSnapshots).toEqual([]);
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
    expect(state.message).toBeNull();
    expect(notified).toContain('Published. Developers get this version on their next pull.');
    expect(updateFetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the identity on a not_owner refusal, so a teammate cannot strand the owner', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_theirs', pullKey: null, publishedAt: '2026-08-30T09:12:00.000Z' });
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'This library was published by another account, or from a device that no longer holds its key. Nothing was published.',
    );
    // The id in the file is still the one developers pull; nothing is cleared.
    expect(state.libraryId).toBe('lib_theirs');
    expect(state.lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
    expect(sent).not.toContainEqual({ type: 'clearPublishInfo' });
  });

  it('stops on a gone republish target, clears the identity, and never recreates', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_old', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);
    expect(publish.publishState().libraryId).toBe('lib_old');

    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      expect(body.libraryId).toBe('lib_old');
      // The stored key rides along with every republish.
      expect((init as RequestInit).headers).toMatchObject({ 'X-Pull-Key': 'sl_old' });
      return jsonResponse(404, { error: 'not_found' });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'That library no longer exists on the publish service. Nothing was published. '
      + 'Publish again to create a new library, then share its setup command with your developers.',
    );
    // The stale identity is dropped locally and in the file, so the next
    // click is a deliberate create rather than another failed republish.
    expect(state.libraryId).toBeNull();
    expect(state.pullKey).toBeNull();
    expect(sent.at(-1)).toEqual({ type: 'clearPublishInfo' });

    publish.onPublishClick(AUTH);
    const recreate = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      expect('libraryId' in body).toBe(false);
      return jsonResponse(201, { libraryId: 'lib_new', pullKey: 'sl_new', publishedAt: '2026-09-01T00:00:03.000Z' });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, recreate);
    expect(publish.publishState().libraryId).toBe('lib_new');
  });

  it('republishes with the identity carried by publishSources when the session has none', async () => {
    // No publishInfo reply reached this session before the click: the main
    // thread read the file's identity in the same round trip as the sources.
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { libraryId?: string };
      expect(body.libraryId).toBe('lib_file');
      return jsonResponse(200, { libraryId: 'lib_file', publishedAt: '2026-09-01T00:00:02.000Z' });
    });
    await publish.onPublishSources(
      sourcesMsg({ publishInfo: { libraryId: 'lib_file', pullKey: 'sl_file', publishedAt: null } }), AUTH, fetcher,
    );
    const state = publish.publishState();
    expect(state.status).toBe('done');
    expect(state.libraryId).toBe('lib_file');
    expect(state.pullKey).toBe('sl_file');
    expect(fetcher).toHaveBeenCalledTimes(1);
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
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: null });
    publish.onPublishSourcesError('the selection has no components');
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Could not read the library. Nothing was published. the selection has no components. '
      + 'Try again, or reopen the plugin if it keeps happening.',
    );
    // A failed source read leaves any already-known library identity intact.
    expect(state.libraryId).toBe('lib_1');
    expect(state.pullKey).toBe('sl_1');
  });

  /**
   * `requestPublishSources`'s outer catch (main.ts) is reachable from a
   * download exactly as from a publish, so this error must never tell a
   * download user something was "published" -- the same fabrication the
   * skipped-guard fix (c72fb81) already stopped for the sibling guard above.
   */
  it('tells a download user honestly when the source read itself fails, never claiming a publish', () => {
    publish.onDownloadSkillClick();
    publish.onPublishSourcesError('the file has no docs');
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Could not read the library. Nothing was downloaded. the file has no docs. '
      + 'Try again, or reopen the plugin if it keeps happening.',
    );
    expect(state.message).not.toContain('published');
  });

  /**
   * `message` is a caught error's own text (main.ts forwards `err.message`
   * verbatim), which is not guaranteed to end in punctuation. Without
   * normalizing it first, the retry sentence runs on with no boundary, e.g.
   * "...reading 'name') Try again...". A message that already ends in
   * punctuation must not get a second, doubled terminator.
   */
  it('does not double a terminator when the caught message already ends in one', () => {
    publish.onPublishSourcesError("Cannot read properties of null (reading 'name').");
    expect(publish.publishState().message).toBe(
      "Could not read the library. Nothing was published. Cannot read properties of null (reading 'name'). "
      + 'Try again, or reopen the plugin if it keeps happening.',
    );
  });

  it('onPublishInfo seeds libraryId/pullKey only while idle', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_seed', pullKey: 'sl_seed', publishedAt: null });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
    expect(repaintCount).toBeGreaterThan(0);

    // Once a publish has started this session, a slow/stale publishInfo reply
    // must not clobber what already happened.
    publish.onPublishClick(AUTH);
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_other', pullKey: 'sl_other', publishedAt: null });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
  });

  it('records the publish date in the file after a create, an update, and an unchanged publish', async () => {
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-09-01T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({
      type: 'setPublishedAt', libraryId: 'lib_1', publishedAt: '2026-09-01T00:00:01.000Z',
    });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({
      type: 'setPublishedAt', libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z',
    });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z', unchanged: true,
    })));
    // The unchanged answer carries the stored library's existing date, which
    // is the true last-published time, so it is recorded too.
    expect(sent.filter((m) => m.type === 'setPublishedAt')).toHaveLength(3);
    expect(publish.publishState().lastPublishedAt).toBe('2026-09-02T00:00:01.000Z');
  });

  it('records no date after a failed publish', async () => {
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(500, {})));
    expect(sent.some((m) => m.type === 'setPublishedAt')).toBe(false);
  });

  it('seeds the date from the file while idle', () => {
    publish.onPublishInfo({
      type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z',
    });
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
  });

  it('falls back to the date carried by publishSources when the session has none', async () => {
    publish.onPublishClick(AUTH);
    // The publish fails, so the only date the state can hold is the one the
    // main thread read from the file in the same round trip as the sources.
    await publish.onPublishSources(
      sourcesMsg({
        publishInfo: { libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z' },
      }),
      AUTH, vi.fn(async () => jsonResponse(500, {})),
    );
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
  });

  it('drops the date with the id when the library is gone', async () => {
    publish.onPublishInfo({
      type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z',
    });
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(
      sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(404, { error: 'not_found' })),
    );
    expect(publish.publishState().lastPublishedAt).toBeNull();
    expect(publish.publishState().libraryId).toBeNull();
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
    expect(state.status).toBe('done');
    expect(state.message).toBeNull();
    expect(notified).toContain(
      'Key rotated. The old key stops working within about a minute. Share the new command with your developers.',
    );
    expect(sent).toContainEqual({
      type: 'setPublishInfo', libraryId: 'lib_1', pullKey: 'sl_rotated',
    });
  });

  it('ignores rotate while a publish is collecting or uploading', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_old', publishedAt: null });
    publish.onPublishClick(AUTH);
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(rotateFetcher).not.toHaveBeenCalled();
    expect(publish.publishState().status).toBe('collecting');
    expect(publish.publishState().pullKey).toBe('sl_old');
  });

  it('a rotate that succeeds after a failed publish reads as done, not as an error', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_old', publishedAt: null });
    publish.onPublishSourcesError('the file has no docs');
    expect(publish.publishState().status).toBe('error');
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(publish.publishState().status).toBe('done');
    expect(publish.publishState().pullKey).toBe('sl_rotated');
  });

  it('rotates with only a library id known, so a second device can recover a key', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_1', pullKey: null, publishedAt: null });
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_fresh' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(publish.publishState().pullKey).toBe('sl_fresh');
    expect(sent).toContainEqual({ type: 'setPublishInfo', libraryId: 'lib_1', pullKey: 'sl_fresh' });
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
    expect(state.message).toBe('Rotating the key failed with HTTP 401.');
    expect(state.pullKey).toBe('sl_old');
  });

  it('explains a not_owner refusal in plain words, since a teammate can reach the button', async () => {
    // A teammate sees the file's library id but never held the key, and the
    // server refuses their rotate because ownership is the publisher's.
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_1', pullKey: null, publishedAt: null });
    const rotateFetcher = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe('Only the account that published this library can rotate its key.');
    expect(state.pullKey).toBeNull();
    expect(notified).toEqual([]);
  });

  it('reports nothing changed on an unchanged republish and keeps the key', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-02T00:00:00.000Z', unchanged: true }));
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null });
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher as unknown as typeof fetch);
    const s = publish.publishState();
    expect(s.status).toBe('done');
    expect(s.message).toBeNull();
    expect(notified).toEqual(['Nothing changed since the last publish.']);
    expect(s.pullKey).toBe(KEY);
    // No new key, so nothing rewrites the stored one. The date is recorded
    // because the unchanged answer carries the stored library's real one.
    expect(sent.filter((m) => m.type === 'setPublishInfo')).toEqual([]);
    expect(sent).toEqual([
      { type: 'setPublishedAt', libraryId: LIB, publishedAt: '2026-09-02T00:00:00.000Z' },
    ]);
  });

  describe('download intent', () => {
    beforeEach(() => {
      vi.mocked(downloadBytes).mockClear();
    });

    it('collects without contacting the proxy', () => {
      publish.onDownloadSkillClick();
      expect(sent).toEqual([{ type: 'requestPublishSources' }]);
      expect(publish.publishState().status).toBe('collecting');
    });

    it('never uploads, and leaves the library identity and publish record untouched', async () => {
      const fetcher = vi.fn();
      publish.onDownloadSkillClick();
      await publish.onPublishSources(sourcesMsg(), AUTH, fetcher as unknown as typeof fetch);
      expect(fetcher).not.toHaveBeenCalled();
      expect(publish.publishState().libraryId).toBeNull();
      expect(publish.publishState().status).toBe('idle');
      // The exact arguments, not just the call count: a swapped filename/MIME
      // order would still pass a bare toHaveBeenCalledTimes(1).
      expect(downloadBytes).toHaveBeenCalledTimes(1);
      expect(downloadBytes).toHaveBeenCalledWith(
        expect.any(Uint8Array), 'spec-layer-design-system-skill.zip', 'application/zip',
      );
      expect(notified).toEqual(['Downloaded. Unzip it into .claude/skills/ in your repository.']);
      // "A snapshot is not a publish" means these two durable writes to the
      // file never fire on the download path, not just that the state object
      // looks right in memory.
      expect(sent.some((m) => m.type === 'setPublishInfo')).toBe(false);
      expect(sent.some((m) => m.type === 'setPublishedAt')).toBe(false);
    });

    it('tells a download user honestly when components could not be read, never claiming a publish', async () => {
      publish.onDownloadSkillClick();
      await publish.onPublishSources(
        { ...sourcesMsg(), skipped: [{ name: 'Button', reason: 'gone' }] }, AUTH,
      );
      const state = publish.publishState();
      expect(state.status).toBe('error');
      expect(state.message).toBe(
        'Nothing was downloaded. 1 component could not be read: Button. Fix or remove those docs, then download again.',
      );
      expect(state.message).not.toContain('published');
      expect(downloadBytes).not.toHaveBeenCalled();
    });

    it('still tells a publish user the publish wording for the same skipped guard', async () => {
      // The guard is shared and unchanged; only the wording is intent-aware.
      // This pins the publish side so the download fix cannot regress it.
      publish.onPublishClick(AUTH);
      const fetcher = vi.fn();
      await publish.onPublishSources(
        { ...sourcesMsg(), skipped: [{ name: 'Button', reason: 'gone' }] }, AUTH, fetcher,
      );
      const state = publish.publishState();
      expect(state.status).toBe('error');
      expect(state.message).toBe(
        'Nothing was published. 1 component could not be read: Button. Fix or remove those docs, then publish again.',
      );
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('recovers to an honest error when the download itself throws, instead of wedging in collecting', async () => {
      vi.mocked(downloadBytes).mockImplementationOnce(() => {
        throw new Error('Blob is not defined');
      });
      publish.onDownloadSkillClick();
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn());
      const state = publish.publishState();
      expect(state.status).toBe('error');
      expect(state.message).toBe(
        'The download could not be created. Nothing was saved. Try again, or reopen the plugin if it keeps happening.',
      );
      expect(state.message).not.toContain('—');
      // Not wedged: a fresh click is accepted rather than guard-blocked on
      // a status that never left 'collecting'.
      publish.onDownloadSkillClick();
      expect(publish.publishState().status).toBe('collecting');
    });

    it('runs the publish path, not the download branch, for a publish click that follows a completed download', async () => {
      // This is the regression the shared `intent` flag exists to prevent: if
      // onPublishClick ever stopped setting intent back to 'publish', a
      // publish click right after a download would silently re-run the
      // download branch and never call the fetcher.
      publish.onDownloadSkillClick();
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn());
      expect(publish.publishState().status).toBe('idle');

      publish.onPublishClick(AUTH);
      const fetcher = vi.fn(async () => jsonResponse(201, {
        libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z',
      }));
      await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const state = publish.publishState();
      expect(state.status).toBe('done');
      expect(state.libraryId).toBe('lib_new');
      expect(state.pullKey).toBe('sl_pull');
    });
  });
});

describe('agentSetupMessage', () => {
  const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
  const KEY = 'sl_' + 'b'.repeat(48);

  it('carries the setup command with --yes, the skill install, and the tools command', () => {
    const message = agentSetupMessage(LIB, KEY);
    expect(message).toContain(`npx --yes spec-layer setup --id ${LIB} --key ${KEY}`);
    expect(message).toContain('npx --yes spec-layer skill --install');
    expect(message).toContain('npx --yes spec-layer tools');
    expect(message).toContain('Never print, commit, or copy the key');
  });

  it('is plain text a person can read back: numbered steps, no em dash, no markup', () => {
    const message = agentSetupMessage(LIB, KEY);
    expect(message.split('\n').filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    expect(message).not.toContain('—');
    expect(message).not.toMatch(/<[a-z]/);
  });
});

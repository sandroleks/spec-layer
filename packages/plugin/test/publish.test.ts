import { beforeEach, describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { unzipSync } from 'fflate';
import { extract, libraryBundleContentHash, specContentHash, type SerializedFoundation } from '@spec-layer/extractor';
import type { PublishComponentSource, UiToMain } from '../src/messages';
import {
  agentSetupMessage, buildPublishArtifacts, buildPublishBundle, dryRunBundle, isBump, publishBundle, rotatePullKey, setupCommand,
  type PublishSources, type PublishSourcesMsg,
} from '../src/ui/publish';
import type { ProxyAuth } from '../src/ui/proxy';
import { downloadBytes } from '../src/ui/download';
import { publishHeaderMarkup } from '../src/ui/screens/publish';

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

const NO_IDENTITY =
  'Couldn’t publish without a Figma account or license key. '
  + 'Sign in to Figma, or activate your license key on the License screen.';
const UNREACHABLE = 'Couldn’t reach Spec Layer. Check your connection and try again.';
const FREE_LIMIT_PREFIX = 'Couldn’t publish. The free plan publishes 1 Figma file.';
const GENERIC_500 =
  'Couldn’t publish. Spec Layer returned an error. Try again, or reopen the plugin if it keeps happening. (HTTP 500)';
const rotateHttp = (status: number): string =>
  `Couldn’t rotate the pull key. Spec Layer returned an error. Try again in a minute. (HTTP ${status})`;

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

describe('isBump', () => {
  it('accepts patch, minor, major and nothing else', () => {
    expect(['patch', 'minor', 'major'].every(isBump)).toBe(true);
    expect(isBump('Major')).toBe(false);
    expect(isBump('')).toBe(false);
  });
});

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

  it('returns one stamp per component with the visible and hidden drift hashes, and whether a foundation shipped', () => {
    const sources = (): PublishSources => ({
      foundation: null,
      groupDescriptions: {},
      components: [componentSource('doc-button', 'Button', '1:100', 'k-button')],
      fileKey: 'F1',
      fileName: 'Design System',
    });
    const { bundle, stamps } = buildPublishArtifacts(sources(), '2026-09-12T00:00:00.000Z');
    expect(bundle).toEqual(buildPublishBundle(sources(), '2026-09-12T00:00:00.000Z'));
    expect(stamps.foundation).toBeNull();
    expect(stamps.components).toEqual([{
      sourceNodeId: '1:100',
      hashes: {
        visible: specContentHash(extract(sources().components[0].node, { figmaFile: 'F1', figmaFileName: 'Design System' }), { includeHidden: false }),
        hidden: specContentHash(extract(sources().components[0].node, { figmaFile: 'F1', figmaFileName: 'Design System' }), { includeHidden: true }),
      },
    }]);
  });

  it('carries each component\'s variant instances beside the artifact', () => {
    const set = {
      id: 'set', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k-set',
      propertyDefinitions: { size: { type: 'VARIANT', variantOptions: ['Small', 'Large'] } },
      children: [
        { id: 'v0', name: 'size=Small', type: 'COMPONENT', visible: true, children: [], bindings: [] },
        { id: 'v1', name: 'size=Large', type: 'COMPONENT', visible: true, children: [], bindings: [] },
      ],
    } as never;
    const bundle = buildPublishBundle(baseSources({
      components: [{ docId: 'doc-set', name: 'Button', node: set, prose: null }],
    }), GENERATED_AT);
    expect(bundle.components[0].variants).toEqual([
      { name: 'size=Small', values: { size: 'Small' } },
      { name: 'size=Large', values: { size: 'Large' } },
    ]);
    // A lone component is one variant with no axis values.
    const lone = buildPublishBundle(baseSources(), GENERATED_AT);
    expect(lone.components[0].variants).toEqual([{ name: 'Badge', values: {} }]);
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
      kind: 'created', libraryId: 'lib_new', pullKey: 'sl_pull', publishedAt: '2026-09-01T00:00:01.000Z', version: null,
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
      kind: 'updated', libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z', version: null,
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
        message: 'Couldn’t publish. This library belongs to another account, or this device doesn’t have its current pull key. '
        + 'Publish from the device that first published it or last rotated its key.',
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
    expect(outcome).toEqual({ kind: 'error', message: NO_IDENTITY });
  });

  it('maps a 401 for a key that is not active to the key, not to signing in', async () => {
    const expired = vi.fn(async () => jsonResponse(401, { error: 'license_not_active', reason: 'expired' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: expired })).outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. Your license key isn’t active. Renew or reconnect it on the License screen, '
        + 'or sign in to Figma to publish on the free plan.',
    });
    const unreachable = vi.fn(async () => jsonResponse(401, { error: 'license_not_active', reason: 'unreachable' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: unreachable })).outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. Spec Layer couldn’t check your license key right now. Try again in a minute.',
    });
  });

  it('counts the libraries a lapsed license still owns in the free limit copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, owned: 3, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: 'Marketing DS' },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect((outcome as { message: string }).message)
      .toBe(`${FREE_LIMIT_PREFIX} This account already publishes 3 files, including Marketing DS. Upgrade to Pro to publish up to 10 files.`);
  });

  it('maps 402 to the monthly publishes message, with the limit from the quota headers and the reset date', async () => {
    const exhausted = {
      ...PUBLISH_QUOTA_HEADERS, 'X-Quota-Used': '10', 'X-Quota-Remaining': '0',
    };
    const fetcher = vi.fn(async () => jsonResponse(
      402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' }, exhausted,
    ));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. You’ve used your 10 free publishes this month. Upgrade to Pro or publish again from Oct 1.',
    });
  });

  /**
   * The count is the server's, never a number written into the plugin: a
   * different X-Quota-Limit changes the sentence, and a 402 without quota
   * headers says the same thing with no number rather than a guessed one.
   */
  it('never writes its own number into the 402 message', async () => {
    const seven = vi.fn(async () => jsonResponse(
      402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' },
      { ...PUBLISH_QUOTA_HEADERS, 'X-Quota-Limit': '7', 'X-Quota-Used': '7', 'X-Quota-Remaining': '0' },
    ));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: seven })).outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. You’ve used your 7 free publishes this month. Upgrade to Pro or publish again from Oct 1.',
    });
    const one = vi.fn(async () => jsonResponse(
      402, { error: 'quota_exhausted' },
      { ...PUBLISH_QUOTA_HEADERS, 'X-Quota-Limit': '1', 'X-Quota-Used': '1', 'X-Quota-Remaining': '0' },
    ));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: one })).outcome).toEqual({
      kind: 'error', message: 'Couldn’t publish. You’ve used your 1 free publish this month. Upgrade to Pro.',
    });
    const headerless = vi.fn(async () => jsonResponse(402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' }));
    expect((await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher: headerless })).outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. You’ve used your free publishes this month. Upgrade to Pro or publish again from Oct 1.',
    });
  });

  it('maps a free library_limit to the one-file message naming the other file', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: 'Marketing DS' },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: `${FREE_LIMIT_PREFIX} This account already publishes Marketing DS. Upgrade to Pro to publish up to 10 files.`,
    });
  });

  it('says "another file" when the existing library has no stored name', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: null },
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect((outcome as { message: string }).message)
      .toBe(`${FREE_LIMIT_PREFIX} This account already publishes another file. Upgrade to Pro to publish up to 10 files.`);
  });

  it('maps a Pro library_limit to the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 10 }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Couldn’t publish. This account already publishes 10 Figma files, which is the Pro limit.',
    });
  });

  it('reports an unchanged republish as its own outcome', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', unchanged: true }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome).toEqual({ kind: 'unchanged', libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', version: null });
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
      kind: 'error', message: 'These changes are already being published. Try again in a minute.',
    });
  });

  it('maps 429 rate limiting to copy', async () => {
    const fetcher = vi.fn(async () => jsonResponse(429, {}));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: 'Couldn’t publish. Too many requests in the last minute. Try again in a minute.',
    });
  });

  it('maps bundle_too_large with the sizes', async () => {
    const fetcher = vi.fn(async () => jsonResponse(413, {
      error: 'bundle_too_large', size: 5_640_000, limit: 5_000_000,
    }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. This library is 5.6 MB, over the 5 MB limit. '
        + 'Remove docs you don’t need from this file, then publish again.',
    });
  });

  it('maps library_limit (403) with the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 3 }));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Couldn’t publish. This account already publishes 3 Figma files, which is the Pro limit.',
    });
  });

  it('maps an unmapped status to a generic HTTP message', async () => {
    const fetcher = vi.fn(async () => jsonResponse(500, {}));
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error', message: GENERIC_500,
    });
  });

  it('maps network failure to unreachable copy', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network down'); });
    const { outcome } = await publishBundle(BUNDLE, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: UNREACHABLE });
  });

  it('refuses locally with no license identity, never hitting the network', async () => {
    const fetcher = vi.fn();
    const noAuth: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };
    const { outcome } = await publishBundle(BUNDLE, { auth: noAuth, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: NO_IDENTITY });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('rotatePullKey', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };

  it('returns the new key on 200 and copy on error', async () => {
    const okFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => ({ pullKey: 'sl_new_pull' }),
    } as unknown as Response));
    expect(await rotatePullKey('lib_000000000000000000000001', AUTH, okFetch, 'sl_current')).toEqual({ kind: 'rotated', pullKey: 'sl_new_pull' });
    // The current key rides along so a free-plan owner can prove the library is theirs.
    expect(okFetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Pull-Key': 'sl_current' });

    const unauthorizedFetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}),
    } as unknown as Response));
    expect(await rotatePullKey('lib_000000000000000000000001', AUTH, unauthorizedFetch)).toEqual({
      kind: 'error', message: rotateHttp(401),
    });

    const serverErrorFetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({}),
    } as unknown as Response));
    expect(await rotatePullKey('lib_000000000000000000000001', AUTH, serverErrorFetch)).toEqual({
      kind: 'error', message: rotateHttp(500),
    });

    const networkFailFetch = vi.fn(async () => { throw new Error('offline'); });
    expect(await rotatePullKey('lib_000000000000000000000001', AUTH, networkFailFetch)).toEqual({
      kind: 'error', message: UNREACHABLE,
    });

    const noAuth: ProxyAuth = { licenseKey: null, licenseInstanceId: null, figmaUserId: null };
    const unusedFetch = vi.fn();
    expect(await rotatePullKey('lib_000000000000000000000001', noAuth, unusedFetch)).toEqual({
      kind: 'error',
      message: 'Couldn’t rotate the pull key without a Figma account or license key. '
        + 'Sign in to Figma, or activate your license key on the License screen.',
    });
    expect(unusedFetch).not.toHaveBeenCalled();

    // A stored id that fails the format check never reaches the network.
    expect(await rotatePullKey('not-a-library-id', AUTH, unusedFetch)).toEqual({
      kind: 'error', message: 'Couldn’t rotate the pull key. The library link saved in this file is damaged.',
    });
    expect(unusedFetch).not.toHaveBeenCalled();
  });
});

describe('dryRunBundle', () => {
  const AUTH: ProxyAuth = { licenseKey: 'sl_key', licenseInstanceId: 'inst-1', figmaUserId: null };

  /**
   * No dry-run message is ever shown (a failed dry run reads as the version
   * block's own sentence), so a request that never reached the proxy carries
   * none rather than a string nothing renders.
   */
  it('reports a network throw as an error with no message', async () => {
    const bundle = buildPublishBundle(baseSources(), GENERATED_AT);
    const offline = vi.fn(async () => { throw new Error('offline'); });
    expect(await dryRunBundle(bundle, { auth: AUTH, libraryId: 'lib_000000000000000000000001', fetcher: offline }))
      .toEqual({ kind: 'error' });
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
      // 401 license_not_active, the proxy could not check the key
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(401, { error: 'license_not_active', reason: 'unreachable' })) },
      // 402 quota_exhausted, with and without quota headers
      {
        auth: AUTH, libraryId: null,
        fetcher: vi.fn(async () => jsonResponse(402, { error: 'quota_exhausted' }, { 'X-Tier': 'free', 'X-Quota-Limit': '10' })),
      },
      { auth: AUTH, libraryId: null, fetcher: vi.fn(async () => jsonResponse(402, { error: 'quota_exhausted' })) },
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
      const outcome = await rotatePullKey('lib_000000000000000000000001', testCase.auth, testCase.fetcher);
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
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48), 'yaml'))
      .toBe('npx spec-layer setup --id lib_aaaaaaaaaaaaaaaaaaaaaaaa --key sl_' + 'b'.repeat(48));
  });

  // The voice rules forbid em dashes anywhere in plugin UI copy, and this
  // string is rendered into the publish screen.
  it('carries no em dash', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48), 'yaml')).not.toContain('—');
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
  const LIB = 'lib_000000000000000000000001';
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
      publishInfo: { libraryId: null, pullKey: null, publishedAt: null, version: null },
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
    publish.onPublishInfo({ type: 'publishInfo', libraryId: null, pullKey: null, publishedAt: null, version: null });
    repaintCount = 0; // isolate the click's own repaint from the identity seed's
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
      'Nothing was published. 1 component couldn’t be read: Button. Fix or remove those docs, then publish again.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.libraryId).toBeNull();
    expect(state.pullKey).toBeNull();
  });

  const EMPTY_FOUNDATION = {
    fileKey: 'F1', collections: [], textStyles: [], effectStyles: [], externals: [],
    extractedAt: '2026-09-01T00:00:00.000Z',
  };

  it('blocks a publish that would carry nothing, before any network call', async () => {
    // The proxy accepts an empty bundle, so this is the only thing standing
    // between an empty file and a spent library slot.
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn();
    await publish.onPublishSources(
      sourcesMsg({ components: [], foundation: EMPTY_FOUNDATION }),
      AUTH,
      fetcher,
    );
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Nothing was published. This file has no local variables or styles and no component docs yet. '
      + 'Add a variable or style, or create a doc, then try again.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.libraryId).toBeNull();
  });

  it('names a failed variable read rather than an empty file', () => {
    expect(publish.emptyBundleMessage(
      { components: [], foundation: { ...EMPTY_FOUNDATION, unavailable: ['variables'] } as never },
      'download',
    )).toBe(
      'Nothing was downloaded. Couldn’t read this file’s variables and styles, and it has no component docs. Try again.',
    );
    expect(publish.emptyBundleMessage({ components: [], foundation: null }, 'publish'))
      .toContain('Couldn’t read this file’s variables and styles');
  });

  it('lets tokens alone, or docs alone, publish', () => {
    // No foundation docs are needed: publish reads variables live.
    const tokens = { ...EMPTY_FOUNDATION, textStyles: [{} as never] };
    expect(publish.emptyBundleMessage({ components: [], foundation: tokens }, 'publish')).toBeNull();
    expect(publish.emptyBundleMessage(
      { components: sourcesMsg().components, foundation: null }, 'publish',
    )).toBeNull();
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
    expect(notified).toEqual(['Published. Anyone with the pull key can pull this version.']);
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

  it('sets an unchanged proposal for the assigned version after an update, never a failed one', async () => {
    publish.onPublishClick(AUTH);
    const updateFetcher = vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_existing', publishedAt: '2026-09-01T00:00:02.000Z', version: '2.0.0',
    }));
    await publish.onPublishSources(sourcesMsg({ publishInfo: { libraryId: 'lib_existing', pullKey: 'sl_pull_1', publishedAt: null, version: null } }), AUTH, updateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('done');
    expect(state.proposalStatus).toBe('idle');
    expect(state.proposal).toEqual({
      currentVersion: '2.0.0', unchanged: true, minimumBump: null, proposedVersion: null,
      counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
    });
  });

  it('keeps the identity on a not_owner refusal, so a teammate cannot strand the owner', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_theirs', pullKey: null, publishedAt: '2026-08-30T09:12:00.000Z', version: null });
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Couldn’t publish. This library belongs to another account, or this device doesn’t have its current pull key. '
        + 'Publish from the device that first published it or last rotated its key.',
    );
    // The id in the file is still the one developers pull; nothing is cleared.
    expect(state.libraryId).toBe('lib_theirs');
    expect(state.lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
    expect(sent).not.toContainEqual({ type: 'clearPublishInfo' });
  });

  it('stops on a gone republish target, clears the identity and version state, and never recreates', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_old', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z', version: '1.4.2',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);
    expect(publish.publishState().libraryId).toBe('lib_old');
    expect(publish.publishState().version).toBe('1.4.2');

    // A dry-run proposal and a chosen bump both belong to lib_old; neither
    // may survive the proxy reporting it gone. The create just left an idle
    // "nothing changed since" proposal behind, which reopening Publish would
    // now reuse rather than re-check, so ask for a fresh one explicitly
    // instead of relying on onPublishOpen to skip straight past it.
    publish.onPublishRecheck();
    const dryRunFetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, dryRunFetcher);
    expect(publish.publishState().proposal).not.toBeNull();
    publish.onBumpChoice('major');
    expect(publish.publishState().chosenBump).toBe('major');

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
      'Couldn’t publish. Spec Layer no longer has this library. '
      + 'Publish again to create a new one, then share its new setup command with your developers.',
    );
    // The stale identity is dropped locally and in the file, so the next
    // click is a deliberate create rather than another failed republish.
    expect(state.libraryId).toBeNull();
    expect(state.pullKey).toBeNull();
    // The dead library's version, proposal and chosen bump must not survive
    // it either: a create is coming next, and none of the three belongs to it.
    expect(state.version).toBeNull();
    expect(state.proposal).toBeNull();
    expect(state.chosenBump).toBeNull();
    expect(sent.at(-1)).toEqual({ type: 'clearPublishInfo' });

    publish.onPublishClick(AUTH);
    let recreateBody: Record<string, unknown> = {};
    const recreate = vi.fn(async (_url, init) => {
      recreateBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect('libraryId' in recreateBody).toBe(false);
      return jsonResponse(201, { libraryId: 'lib_new', pullKey: 'sl_new', publishedAt: '2026-09-01T00:00:03.000Z' });
    });
    await publish.onPublishSources(sourcesMsg(), AUTH, recreate);
    expect(publish.publishState().libraryId).toBe('lib_new');
    // No bump left over from the dead library's chosen major rides along on
    // the fresh create.
    expect(recreateBody.bump).toBeUndefined();
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
      sourcesMsg({ publishInfo: { libraryId: 'lib_file', pullKey: 'sl_file', publishedAt: null, version: null } }), AUTH, fetcher,
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
    expect(state.message).toBe(GENERIC_500);
  });

  it('onPublishSourcesError sets an honest error, without touching any stored key', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_1', publishedAt: null, version: null });
    publish.onPublishSourcesError('the selection has no components');
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Couldn’t read this file’s docs. Nothing was published. '
      + 'Try again, or reopen the plugin if it keeps happening. (the selection has no components)',
    );
    // A failed source read leaves any already-known library identity intact.
    expect(state.libraryId).toBe('lib_000000000000000000000001');
    expect(state.pullKey).toBe('sl_1');
  });

  /**
   * `requestPublishSources`'s outer catch (main.ts) is reachable from a
   * download exactly as from a publish, so this error must never tell a
   * download user something was "published" -- the same fabrication the
   * skipped-guard fix (c72fb81) already stopped for the sibling guard above.
   */
  it('tells a download user honestly when the source read itself fails, never claiming a publish', () => {
    publish.onDownloadSkillClick('yaml');
    publish.onPublishSourcesError('the file has no docs');
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Couldn’t read this file’s docs. Nothing was downloaded. '
      + 'Try again, or reopen the plugin if it keeps happening. (the file has no docs)',
    );
    expect(state.message).not.toContain('published');
  });

  /**
   * `message` is a caught error's own text (main.ts forwards `err.message`
   * verbatim): technical detail, so it goes last, in parentheses, after the
   * retry sentence. Its own trailing period is dropped so the parentheses
   * close cleanly, and an empty message adds no bare "()".
   */
  it('puts the caught message last in parentheses, without its own trailing period', () => {
    publish.onPublishSourcesError("Cannot read properties of null (reading 'name').");
    expect(publish.publishState().message).toBe(
      'Couldn’t read this file’s docs. Nothing was published. '
      + "Try again, or reopen the plugin if it keeps happening. (Cannot read properties of null (reading 'name'))",
    );
  });

  it('adds no empty parentheses when the caught message is blank', () => {
    publish.onPublishSourcesError('  ');
    expect(publish.publishState().message).toBe(
      'Couldn’t read this file’s docs. Nothing was published. Try again, or reopen the plugin if it keeps happening.',
    );
  });

  it('onPublishInfo seeds libraryId/pullKey only while idle', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_seed', pullKey: 'sl_seed', publishedAt: null, version: null });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
    expect(repaintCount).toBeGreaterThan(0);

    // Once a publish has started this session, a slow/stale publishInfo reply
    // must not clobber what already happened.
    publish.onPublishClick(AUTH);
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_other', pullKey: 'sl_other', publishedAt: null, version: null });
    expect(publish.publishState().libraryId).toBe('lib_seed');
    expect(publish.publishState().pullKey).toBe('sl_seed');
  });

  it('records the publish date in the file after a create, an update, and an unchanged publish', async () => {
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_000000000000000000000001', pullKey: 'sl_1', publishedAt: '2026-09-01T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({
      type: 'setPublishedAt', libraryId: 'lib_000000000000000000000001', publishedAt: '2026-09-01T00:00:01.000Z',
    });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_000000000000000000000001', publishedAt: '2026-09-02T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({
      type: 'setPublishedAt', libraryId: 'lib_000000000000000000000001', publishedAt: '2026-09-02T00:00:01.000Z',
    });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_000000000000000000000001', publishedAt: '2026-09-02T00:00:01.000Z', unchanged: true,
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
      type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z', version: null,
    });
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
  });

  it('falls back to the date carried by publishSources when the session has none', async () => {
    publish.onPublishClick(AUTH);
    // The publish fails, so the only date the state can hold is the one the
    // main thread read from the file in the same round trip as the sources.
    await publish.onPublishSources(
      sourcesMsg({
        publishInfo: { libraryId: 'lib_000000000000000000000001', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z', version: null },
      }),
      AUTH, vi.fn(async () => jsonResponse(500, {})),
    );
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
  });

  it('drops the date with the id when the library is gone', async () => {
    publish.onPublishInfo({
      type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z', version: null,
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
      libraryId: 'lib_000000000000000000000001', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);

    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.pullKey).toBe('sl_rotated');
    expect(state.libraryId).toBe('lib_000000000000000000000001');
    expect(state.status).toBe('done');
    expect(state.message).toBeNull();
    expect(notified).toContain(
      'Pull key rotated. The old key stops working within about a minute. Share the new setup command.',
    );
    expect(sent).toContainEqual({
      type: 'setPublishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_rotated',
    });
  });

  it('ignores rotate while a publish is collecting or uploading', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_old', publishedAt: null, version: null });
    publish.onPublishClick(AUTH);
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(rotateFetcher).not.toHaveBeenCalled();
    expect(publish.publishState().status).toBe('collecting');
    expect(publish.publishState().pullKey).toBe('sl_old');
  });

  it('a rotate that succeeds after a failed publish reads as done, not as an error', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_old', publishedAt: null, version: null });
    publish.onPublishSourcesError('the file has no docs');
    expect(publish.publishState().status).toBe('error');
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_rotated' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(publish.publishState().status).toBe('done');
    expect(publish.publishState().pullKey).toBe('sl_rotated');
  });

  it('rotates with only a library id known, so a second device can recover a key', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: null, publishedAt: null, version: null });
    const rotateFetcher = vi.fn(async () => jsonResponse(200, { pullKey: 'sl_fresh' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    expect(publish.publishState().pullKey).toBe('sl_fresh');
    expect(sent).toContainEqual({ type: 'setPublishInfo', libraryId: 'lib_000000000000000000000001', pullKey: 'sl_fresh' });
  });

  it('onRotateClick surfaces a rotate failure without losing the current key', async () => {
    publish.onPublishClick(AUTH);
    const createFetcher = vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_000000000000000000000001', pullKey: 'sl_old', publishedAt: '2026-09-01T00:00:01.000Z',
    }));
    await publish.onPublishSources(sourcesMsg(), AUTH, createFetcher);

    const rotateFetcher = vi.fn(async () => jsonResponse(401, {}));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(rotateHttp(401));
    expect(state.pullKey).toBe('sl_old');
  });

  it('explains a not_owner refusal in plain words, since a teammate can reach the button', async () => {
    // A teammate sees the file's library id but never held the key, and the
    // server refuses their rotate because ownership is the publisher's.
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_000000000000000000000001', pullKey: null, publishedAt: null, version: null });
    const rotateFetcher = vi.fn(async () => jsonResponse(403, { error: 'not_owner' }));
    await publish.onRotateClick(AUTH, rotateFetcher);
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toBe(
      'Couldn’t rotate the pull key. That takes the license key this library was published with, '
      + 'or the Figma account that published it on a device with the current pull key.',
    );
    expect(state.pullKey).toBeNull();
    expect(notified).toEqual([]);
  });

  it('reports nothing changed on an unchanged republish and keeps the key', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-02T00:00:00.000Z', unchanged: true }));
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: null });
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

  it('an unchanged publish settles the proposal so the screen stops offering a next version', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const dryFetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, dryFetcher);
    publish.onBumpChoice('major');
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', unchanged: true, version: '1.4.2' })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState()).toMatchObject({
      status: 'done', version: '1.4.2', chosenBump: null,
      proposal: publish.publishedProposal('1.4.2'),
    });
    expect(publish.nextVersionFor(publish.publishState())).toBeNull();
  });

  it('onPublishOpen with a known library id runs a dry run and stores the proposal', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun', proposalStatus: 'loading' });
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);

    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return jsonResponse(200, {
        currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
        counts: { major: 0, minor: 2, patch: 5 }, changes: [], changesTruncated: false,
      });
    }) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg({ publishInfo: { libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' } }), AUTH, fetcher);
    expect(seen[0].body.dryRun).toBe(true);
    expect(seen[0].body.libraryId).toBe(LIB);
    expect(publish.publishState()).toMatchObject({
      status: 'idle', proposalStatus: 'idle',
      proposal: expect.objectContaining({ proposedVersion: '1.5.0', minimumBump: 'minor' }),
    });
  });

  it('reopening Publish keeps this session’s proposal instead of re-running the dry run', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const fetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(sent).toHaveLength(1);

    publish.onPublishOpen();
    expect(sent).toHaveLength(1);
    expect(publish.publishState()).toMatchObject({ status: 'idle', proposalStatus: 'idle' });
    expect(publish.publishState().proposal?.proposedVersion).toBe('1.5.0');
  });

  it('Check again runs the dry run the publisher asked for', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch);
    expect(publish.publishState().proposalStatus).toBe('failed');
    publish.onPublishRecheck();
    expect(sent).toHaveLength(2);
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun', proposalStatus: 'loading' });
  });

  it('Check again does nothing without a library or while busy', () => {
    publish.onPublishRecheck();
    expect(sent).toEqual([]);
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishClick(AUTH);
    publish.onPublishRecheck();
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);
  });

  /** A settled, idle proposal with a chosen bump: what onPublishOpen's reuse
   *  shortcut would otherwise keep showing after any of the events below. */
  async function settleAProposal(): Promise<void> {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const fetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    publish.onBumpChoice('major');
    expect(publish.publishState()).toMatchObject({ proposalStatus: 'idle', chosenBump: 'major' });
    expect(publish.publishState().proposal).not.toBeNull();
  }

  /**
   * `invalidatePublishProposal` is the one shared primitive every event-class
   * call site in ui-vnext.ts calls: docFrameDone and foundationDone (outside
   * a Library batch), docDetached, docRemoved, docFrameError and
   * foundationFrameError (when a render can leave a doc changed on canvas
   * before failing), and finishLibraryOperation (a Library update batch that
   * landed at least one doc). Each of those call sites is a one-line, guard
   * only wire-up with no branching logic of its own to unit test in
   * isolation, and (per this plan's own constraint) ui-vnext.ts cannot be
   * imported from a test; a message-type-to-boolean table would not help
   * either, since several of those sites gate the call on data the message
   * type alone doesn't carry (`msg.created > 0`, "not part of a batch").
   * Call-site coverage for all of them is verified by reading the code
   * (documented per site in the fix reports), plus typecheck, the plugin
   * build, and the real sandbox scan. This test covers the one thing that is
   * unit-testable: what the shared primitive itself does once called.
   */
  it('invalidatePublishProposal clears the held proposal, its chosen bump, while idle', async () => {
    await settleAProposal();
    publish.invalidatePublishProposal();
    expect(publish.publishState()).toMatchObject({ proposal: null, proposalStatus: 'idle', chosenBump: null });
  });

  it('bumps the generation even while busy, without touching the in-flight status', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishClick(AUTH);
    expect(publish.publishState().status).toBe('collecting');
    const before = publish.publishState().proposalGeneration;
    publish.invalidatePublishProposal();
    // A publish already collecting sources ends with its own true answer
    // (the outcome branches in onPublishSources), so clearing the proposal
    // here would only be overwritten a moment later; the status is untouched
    // either way. The generation still bumps, so a dry run's stale-reply
    // check (not exercised by a publish intent) would see it if one were
    // pending.
    expect(publish.publishState().proposalGeneration).toBe(before + 1);
    expect(publish.publishState().status).toBe('collecting');
  });

  it("the file's publish identity changing clears the held proposal", async () => {
    await settleAProposal();
    // A different library id lands while idle: the file's saved identity
    // changed since (for example, another device republished it as a new
    // library), so whatever this session computed against the old one can no
    // longer answer for the new one.
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_other', pullKey: 'sl_other', publishedAt: null, version: '2.0.0' });
    expect(publish.publishState()).toMatchObject({
      libraryId: 'lib_other', proposal: null, proposalStatus: 'idle', chosenBump: null,
    });
  });

  it('the same publish identity landing again leaves the held proposal alone', async () => {
    await settleAProposal();
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    expect(publish.publishState()).toMatchObject({ proposalStatus: 'idle', chosenBump: 'major' });
    expect(publish.publishState().proposal).not.toBeNull();
  });

  it('publish, then invalidate, then reopen runs a dry run instead of reusing the stale proposal', async () => {
    await settleAProposal();
    publish.invalidatePublishProposal();
    expect(publish.publishState().proposal).toBeNull();

    publish.onPublishOpen();
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun', proposalStatus: 'loading' });
    expect(sent.at(-1)).toEqual({ type: 'requestPublishSources' });
  });

  it('a dry run invalidated while its sources are still collecting is discarded, and a fresh one is requested', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);

    // Something changes the file (a doc rebuild, say) while this collect is
    // still in flight: the sources it is about to gather answer for the file
    // as it stood before the change.
    publish.invalidatePublishProposal();

    const fetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);

    // The stale reply never even reaches the point of diffing against the
    // proxy: the dry-run POST itself was never made.
    expect(fetcher).not.toHaveBeenCalled();
    // A fresh collect was requested instead, and the screen keeps showing
    // "Checking...", not a proposal computed from the discarded sources.
    expect(sent).toEqual([{ type: 'requestPublishSources' }, { type: 'requestPublishSources' }]);
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun', proposalStatus: 'loading' });
  });

  it('a dry run invalidated while its own proxy call is in flight is discarded, and a fresh one is requested', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    expect(sent).toEqual([{ type: 'requestPublishSources' }]);

    // A fetcher that does not resolve until this test says so, so the
    // invalidation below lands between the sources reply (already being
    // processed) and the dry-run POST resolving, not before either.
    let resolveFetch: (value: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as unknown as typeof fetch;
    const call = publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Something changes the file while this dry run's own proxy call is
    // still in flight.
    publish.invalidatePublishProposal();
    resolveFetch(jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    }));
    await call;

    // The stale answer never lands: fetcher was only ever called once (for
    // the discarded attempt), not answered from.
    expect(fetcher).toHaveBeenCalledTimes(1);
    // A fresh collect was requested instead of trusting it.
    expect(sent).toEqual([{ type: 'requestPublishSources' }, { type: 'requestPublishSources' }]);
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun', proposalStatus: 'loading' });
  });

  it('a publish invalidated while its own upload is in flight keeps the result but drops the stale proposal', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: null, pullKey: null, publishedAt: null, version: null });
    publish.onPublishClick(AUTH);

    let resolveFetch: (value: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as unknown as typeof fetch;
    const call = publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState().status).toBe('uploading');

    // A doc changes elsewhere while this publish's own upload is in flight.
    publish.invalidatePublishProposal();
    resolveFetch(jsonResponse(201, {
      libraryId: LIB, pullKey: KEY, publishedAt: '2026-09-01T00:00:01.000Z', version: '1.0.0',
    }));
    await call;

    const finalState = publish.publishState();
    // The publish result itself stands: it is the proxy's real answer to the
    // bundle that was actually sent, whatever changed afterward.
    expect(finalState).toMatchObject({ status: 'done', libraryId: LIB, pullKey: KEY, version: '1.0.0' });
    expect(sent).toContainEqual({ type: 'setPublishInfo', libraryId: LIB, pullKey: KEY });
    // But "nothing changed since 1.0.0" would be a guess about a file that
    // changed after the bundle for this publish was built, so there is no
    // proposal left to show as if it still applied.
    expect(finalState.proposal).toBeNull();
  });

  it('a publish refused below the minimum while invalidated in flight keeps the refusal but proposes nothing', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onBumpChoice('patch');
    publish.onPublishClick(AUTH);

    let resolveFetch: (value: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as unknown as typeof fetch;
    const call = publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState().status).toBe('uploading');

    // A doc changes elsewhere while this publish's own upload is in flight.
    publish.invalidatePublishProposal();
    resolveFetch(jsonResponse(400, { error: 'bump_below_minimum', minimumBump: 'minor', proposedVersion: '1.5.0' }));
    await call;

    const finalState = publish.publishState();
    // The refusal itself is the proxy's real answer to what was sent.
    expect(finalState).toMatchObject({
      status: 'error', message: 'These edits need at least a minor version change.', chosenBump: null,
    });
    // But its floor and "Next version 1.5.0" describe a bundle that no longer
    // matches the file, so neither is shown as if it still applied.
    expect(finalState.proposal).toBeNull();
    expect(publish.nextVersionFor(finalState)).toBeNull();
  });

  it('a dry run marks its proposal as a check; a publish marks its proposal as the publish itself', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const dryRunFetcher = vi.fn(async () => jsonResponse(200, {
      currentVersion: '1.4.2', unchanged: false, minimumBump: 'minor', proposedVersion: '1.5.0',
      counts: { major: 0, minor: 1, patch: 0 }, changes: [], changesTruncated: false,
    })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, dryRunFetcher);
    expect(publish.publishState().proposalSource).toBe('check');

    publish.onPublishClick(AUTH);
    const publishFetcher = vi.fn(async () => jsonResponse(200, {
      libraryId: LIB, publishedAt: '2026-09-01T00:00:02.000Z', version: '1.5.0',
    })) as unknown as typeof fetch;
    await publish.onPublishSources(
      sourcesMsg({ publishInfo: { libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' } }),
      AUTH,
      publishFetcher,
    );
    expect(publish.publishState()).toMatchObject({ proposalSource: 'publish', proposal: { unchanged: true } });
  });

  it('onPublishOpen without a library id proposes 1.0.0 locally and calls nothing', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: null, pullKey: null, publishedAt: null, version: null });
    publish.onPublishOpen();
    expect(sent).toEqual([]);
    expect(publish.publishState().proposal).toEqual(publish.firstPublishProposal());
    expect(publish.publishState().initialVersion).toBe('1.0.0');
  });

  it('onPublishOpen before the publish identity is known proposes nothing and asks for it again', () => {
    publish.onPublishOpen();
    // requestPublishInfo is idempotent, so asking again here is how a lost or
    // late first reply gets another chance, rather than leaving the pane
    // waiting forever.
    expect(sent).toEqual([{ type: 'requestPublishInfo' }]);
    expect(publish.publishState()).toMatchObject({ infoKnown: false, proposal: null, proposalStatus: 'idle' });
    expect(repaintCount).toBe(1);
  });

  it('onPublishOpen does not ask for the identity again once it is already known', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: null, pullKey: null, publishedAt: null, version: null });
    publish.onPublishOpen();
    expect(sent).not.toContainEqual({ type: 'requestPublishInfo' });
  });

  it('onPublishClick does nothing before the publish identity is known', () => {
    publish.onPublishClick(AUTH);
    expect(sent).toEqual([]);
    expect(publish.publishState()).toMatchObject({ status: 'idle', infoKnown: false });
  });

  it('a publishInfo reply marks the identity known even while a publish is in flight', () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.0.0' });
    publish.onPublishClick(AUTH);
    publish.onPublishInfo({ type: 'publishInfo', libraryId: 'lib_other', pullKey: 'sl_other', publishedAt: null, version: '2.0.0' });
    // In flight, so the newly arrived identity is not seeded over the one the
    // publish already started from (publishSources carries the truth once the
    // collect completes), but the screen may now stop showing the neutral pill.
    expect(publish.publishState()).toMatchObject({ infoKnown: true, libraryId: LIB, status: 'collecting' });
  });

  it('a publishInfo reply that lands during a download started before the identity keeps the identity', async () => {
    // Download needs no identity, so it can start before publishInfo lands.
    publish.onDownloadSkillClick('yaml');
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: '2026-09-01T00:00:00.000Z', version: '1.4.2' });
    expect(publish.publishState()).toMatchObject({
      infoKnown: true, libraryId: LIB, pullKey: KEY, version: '1.4.2', status: 'collecting',
    });
    // The download's own reply carries the same identity; it must not undo it.
    await publish.onPublishSources(
      sourcesMsg({ publishInfo: { libraryId: LIB, pullKey: KEY, publishedAt: '2026-09-01T00:00:00.000Z', version: '1.4.2' } }),
      AUTH,
      vi.fn() as unknown as typeof fetch,
    );
    expect(publish.publishState()).toMatchObject({
      infoKnown: true, libraryId: LIB, pullKey: KEY, version: '1.4.2', status: 'idle',
    });
    expect(publishHeaderMarkup(publish.publishState())).toContain('Published');
    expect(publishHeaderMarkup(publish.publishState())).not.toContain('Not published');
    // Known now, so opening Publish stops asking for the identity again.
    publish.onPublishOpen();
    expect(sent).not.toContainEqual({ type: 'requestPublishInfo' });
  });

  it('a publishInfo reply that lands after a failed download keeps the identity', () => {
    publish.onDownloadSkillClick('yaml');
    publish.onPublishSourcesError('Section read failed');
    expect(publish.publishState()).toMatchObject({ status: 'error', infoKnown: false });
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    expect(publish.publishState()).toMatchObject({ infoKnown: true, libraryId: LIB, pullKey: KEY, version: '1.4.2' });
  });

  it('a download reply that arrives before any publishInfo takes the identity it carries', async () => {
    publish.onDownloadSkillClick('yaml');
    await publish.onPublishSources(
      sourcesMsg({ publishInfo: { libraryId: LIB, pullKey: KEY, publishedAt: '2026-09-01T00:00:00.000Z', version: '1.4.2' } }),
      AUTH,
      vi.fn() as unknown as typeof fetch,
    );
    expect(publish.publishState()).toMatchObject({
      infoKnown: true, libraryId: LIB, pullKey: KEY, lastPublishedAt: '2026-09-01T00:00:00.000Z', version: '1.4.2',
    });
    expect(sent.some((m) => m.type === 'setPublishInfo')).toBe(false);
  });

  it('a dry run whose bundle cannot be built fails the check instead of wedging in collecting', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const fetcher = vi.fn() as unknown as typeof fetch;
    await publish.onPublishSources(
      sourcesMsg({ components: [{ docId: 'doc-broken', name: 'Broken', node: null as never, prose: null }] }),
      AUTH,
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(publish.publishState()).toMatchObject({ status: 'idle', proposalStatus: 'failed', proposal: null, message: null });
    // Not wedged: Check again starts a fresh dry run.
    publish.onPublishRecheck();
    expect(publish.publishState()).toMatchObject({ status: 'collecting', intent: 'dryRun' });
  });

  it('a publish whose bundle cannot be built ends in an honest error instead of wedging in uploading', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn() as unknown as typeof fetch;
    await publish.onPublishSources(
      sourcesMsg({ components: [{ docId: 'doc-broken', name: 'Broken', node: null as never, prose: null }] }),
      AUTH,
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    const state = publish.publishState();
    expect(state.status).toBe('error');
    expect(state.message).toMatch(
      /^Couldn’t build the library from this file’s docs\. Nothing was published\. Try again, or reopen the plugin if it keeps happening\. \(.+\)$/,
    );
    expect(state.message).not.toContain('—');
    expect(sent.some((m) => m.type === 'stampPublished' || m.type === 'setPublishInfo')).toBe(false);
    // Not wedged: a fresh click is accepted.
    publish.onPublishClick(AUTH);
    expect(publish.publishState().status).toBe('collecting');
  });

  it('a failed dry run leaves publishing possible and says the minimum will apply', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishOpen();
    const fetcher = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState()).toMatchObject({ status: 'idle', proposalStatus: 'failed', proposal: null });
    expect(publish.publishState().message).toBeNull();
  });

  it('effectiveBump ignores a choice below the minimum', () => {
    publish.onBumpChoice('major');
    expect(publish.effectiveBump({ ...publish.publishState(), proposal: { ...publish.firstPublishProposal(), currentVersion: '1.0.0', minimumBump: 'minor', proposedVersion: '1.1.0' } })).toBe('major');
    publish.onBumpChoice('patch');
    expect(publish.effectiveBump({ ...publish.publishState(), proposal: { ...publish.firstPublishProposal(), currentVersion: '1.0.0', minimumBump: 'minor', proposedVersion: '1.1.0' } })).toBeNull();
  });

  it('publishes with the chosen bump and note, then stamps every doc with both hashes', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onBumpChoice('major');
    publish.onNoteInput('  Card is new API.  ');
    publish.onPublishClick(AUTH);
    let body: Record<string, unknown> = {};
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-12T00:00:00.000Z', version: '2.0.0', bump: 'major', minimumBump: 'minor' });
    }) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg({ foundation: FOUNDATION }), AUTH, fetcher);
    expect(body.bump).toBe('major');
    expect(body.note).toBe('Card is new API.');
    expect(body.dryRun).toBeUndefined();
    const stamp = sent.find((m) => m.type === 'stampPublished') as Extract<UiToMain, { type: 'stampPublished' }>;
    expect(stamp).toMatchObject({ libraryId: LIB, version: '2.0.0', publishedAt: '2026-09-12T00:00:00.000Z', foundation: FOUNDATION });
    expect(stamp.components).toHaveLength(1);
    expect(stamp.components[0].sourceNodeId).toBe('1:100');
    expect(stamp.components[0].hashes.visible).toMatch(/^[0-9a-f]{64}$/);
    expect(stamp.components[0].hashes.hidden).toMatch(/^[0-9a-f]{64}$/);
    expect(publish.publishState()).toMatchObject({ status: 'done', version: '2.0.0', chosenBump: null, note: '' });
    expect(notified.at(-1)).toBe('Published 2.0.0. Developers get this version on their next pull.');
  });

  it('sends initialVersion only on a first publish, and only when it is a semver', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: null, pullKey: null, publishedAt: null, version: null });
    publish.onInitialVersionInput('2.1.0');
    publish.onPublishClick(AUTH);
    let body: Record<string, unknown> = {};
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(201, { libraryId: LIB, pullKey: 'sl_new', publishedAt: '2026-09-12T00:00:00.000Z', version: '2.1.0', bump: 'initial', minimumBump: null });
    }) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(body.initialVersion).toBe('2.1.0');
    expect(sent.map((m) => m.type)).toEqual(['requestPublishSources', 'setPublishInfo', 'stampPublished']);
    expect(publish.publishState().version).toBe('2.1.0');
    expect(notified.at(-1)).toBe('Published 2.1.0. Anyone with the pull key can pull this version.');
  });

  it('refuses to publish an invalid first version without calling the proxy', async () => {
    publish.onInitialVersionInput('2.0');
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn() as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(publish.publishState()).toMatchObject({ status: 'error', message: 'The first version needs three numbers, like 1.0.0.' });
  });

  it('bump_below_minimum re-renders with the server minimum and a plain message', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onBumpChoice('patch');
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(400, { error: 'bump_below_minimum', minimumBump: 'minor', proposedVersion: '1.5.0' })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(publish.publishState()).toMatchObject({
      status: 'error', message: 'These edits need at least a minor version change.', chosenBump: null,
      proposal: expect.objectContaining({ minimumBump: 'minor', proposedVersion: '1.5.0' }),
    });
    expect(sent.some((m) => m.type === 'stampPublished')).toBe(false);
  });

  it('an unchanged publish stamps nothing new and keeps the version', async () => {
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY, publishedAt: null, version: '1.4.2' });
    publish.onPublishClick(AUTH);
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', unchanged: true, version: '1.4.2' })) as unknown as typeof fetch;
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher);
    expect(sent.map((m) => m.type)).toEqual(['requestPublishSources', 'setPublishedAt']);
    expect(publish.publishState().version).toBe('1.4.2');
  });

  describe('download intent', () => {
    beforeEach(() => {
      vi.mocked(downloadBytes).mockClear();
    });

    it('collects without contacting the proxy', () => {
      publish.onDownloadSkillClick('yaml');
      expect(sent).toEqual([{ type: 'requestPublishSources' }]);
      expect(publish.publishState().status).toBe('collecting');
    });

    it('never uploads, and leaves the library identity and publish record untouched', async () => {
      const fetcher = vi.fn();
      publish.onDownloadSkillClick('yaml');
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
      // The browser can still refuse the file, so the toast claims only a start.
      expect(notified).toEqual(['Snapshot download started.']);
      // "A snapshot is not a publish" means these two durable writes to the
      // file never fire on the download path, not just that the state object
      // looks right in memory.
      expect(sent.some((m) => m.type === 'setPublishInfo')).toBe(false);
      expect(sent.some((m) => m.type === 'setPublishedAt')).toBe(false);
    });

    it('tells a download user honestly when components could not be read, never claiming a publish', async () => {
      publish.onDownloadSkillClick('yaml');
      await publish.onPublishSources(
        { ...sourcesMsg(), skipped: [{ name: 'Button', reason: 'gone' }] }, AUTH,
      );
      const state = publish.publishState();
      expect(state.status).toBe('error');
      expect(state.message).toBe(
        'Nothing was downloaded. 1 component couldn’t be read: Button. Fix or remove those docs, then download again.',
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
        'Nothing was published. 1 component couldn’t be read: Button. Fix or remove those docs, then publish again.',
      );
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('recovers to an honest error when the download itself throws, instead of wedging in collecting', async () => {
      vi.mocked(downloadBytes).mockImplementationOnce(() => {
        throw new Error('Blob is not defined');
      });
      publish.onDownloadSkillClick('yaml');
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn());
      const state = publish.publishState();
      expect(state.status).toBe('error');
      expect(state.message).toBe(
        'Couldn’t create the download. Nothing was saved. Try again, or reopen the plugin if it keeps happening.',
      );
      expect(state.message).not.toContain('—');
      // Not wedged: a fresh click is accepted rather than guard-blocked on
      // a status that never left 'collecting'.
      publish.onDownloadSkillClick('yaml');
      expect(publish.publishState().status).toBe('collecting');
    });

    it('runs the publish path, not the download branch, for a publish click that follows a completed download', async () => {
      // This is the regression the shared `intent` flag exists to prevent: if
      // onPublishClick ever stopped setting intent back to 'publish', a
      // publish click right after a download would silently re-run the
      // download branch and never call the fetcher.
      publish.onDownloadSkillClick('yaml');
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

    it('writes the zip in the format the download was started with', async () => {
      publish.onDownloadSkillClick('md');
      expect(publish.publishState().downloadFormat).toBe('md');
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn() as unknown as typeof fetch);
      const paths = Object.keys(unzipSync(vi.mocked(downloadBytes).mock.calls[0][0]));
      expect(paths).toContain('spec-layer/components/button.md');
      expect(paths.some((path) => path.endsWith('.yaml'))).toBe(false);
    });

    it('keeps writing YAML for a YAML download', async () => {
      publish.onDownloadSkillClick('yaml');
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn() as unknown as typeof fetch);
      const paths = Object.keys(unzipSync(vi.mocked(downloadBytes).mock.calls[0][0]));
      expect(paths).toContain('spec-layer/components/button.yaml');
      expect(paths.filter((path) => path.endsWith('.md'))).toEqual(['spec-layer/SKILL.md']);
    });

    it('the format stashed at the download click wins over a second click made mid-collect', async () => {
      publish.onDownloadSkillClick('md');
      publish.onDownloadSkillClick('yaml');
      await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn() as unknown as typeof fetch);
      const paths = Object.keys(unzipSync(vi.mocked(downloadBytes).mock.calls[0][0]));
      expect(paths).toContain('spec-layer/components/button.md');
      expect(paths.some((path) => path.endsWith('.yaml'))).toBe(false);
    });
  });
});

describe('agentSetupMessage', () => {
  const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
  const KEY = 'sl_' + 'b'.repeat(48);

  it('carries the setup command with --yes, the skill install, and the tools command', () => {
    const message = agentSetupMessage(LIB, KEY, 'yaml');
    expect(message).toContain(`npx --yes spec-layer setup --id ${LIB} --key ${KEY}`);
    expect(message).toContain('npx --yes spec-layer skill --install');
    expect(message).toContain('npx --yes spec-layer tools');
    expect(message).toContain('Never print, commit, or copy the pull key');
  });

  /**
   * An agent reads this text, so file and folder names and the inline tools
   * command sit in backticks to read as paths and code. The commands on their
   * own lines are unchanged, since a developer may copy those verbatim.
   */
  it('marks the file names and the inline command as code', () => {
    const message = agentSetupMessage(LIB, KEY, 'yaml');
    expect(message).toContain(
      'It writes `speclayer.json`, stores the pull key in a gitignored `speclayer.local.json`, '
      + 'and pulls the published library into `.speclayer/`.',
    );
    expect(message).toContain('`npx --yes spec-layer tools` lists every command');
    expect(message).toContain('into the file you read project instructions from.');
    expect(message).toContain(`\n   npx --yes spec-layer setup --id ${LIB} --key ${KEY}\n`);
    expect(message).toContain('\n   npx --yes spec-layer skill --install\n');
  });

  it('is plain text a person can read back: numbered steps, no em dash, no markup', () => {
    const message = agentSetupMessage(LIB, KEY, 'yaml');
    expect(message.split('\n').filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    expect(message).not.toContain('—');
    expect(message).not.toMatch(/<[a-z]/);
  });
});

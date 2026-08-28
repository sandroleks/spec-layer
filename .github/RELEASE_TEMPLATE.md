# Spec Layer vX.Y.Z

## Highlights

- <User-visible change, in the plugin's voice: plain, specific, no em dashes.>

## Getting Started

Install from the [Figma Community listing](https://www.figma.com/community/plugin/1652104411578396548).

To run this release from source, with Node.js 22 or newer:

```bash
npm ci
npm run build:plugin
```

Then in Figma desktop choose **Plugins → Development → Import plugin from manifest** and select `packages/plugin/manifest.json`.

## Security Model

Deterministic sections run entirely inside the plugin and send nothing. AI writing routes through the Spec Layer proxy, which holds the Anthropic credential; no user API key is involved. Component requests include a derived summary and, when it fits the limits, a rendered image. The proxy validates raw license keys with Lemon Squeezy but uses SHA-256 digests for its own cache keys, quota identities, and logs. Keep credentials and private design-system data out of Git.

## Verification

The release candidate must pass:

```text
npm ci
npm run check:ci
git diff --check
```

Plus the current manual Figma pass in `packages/plugin/TESTING.md`: load the
built manifest and confirm component docs, Foundation docs, Library, and Copy
for AI behavior on a synthetic or publishable file.

If the release publishes or relies on Foundation v5 artifacts, also verify the
custom domain, DNS, HTTP 200 response, exact `$id`, and committed-file parity
for `https://spec-layer.com/schemas/foundation-context/v5.json`. A failure in
any of those checks blocks the release; a `*.pages.dev` preview is not enough.

## Known Limitations

- Workspace packages are not published to npm.
- The Worker's in-isolate license limiter is only a best-effort first line of
  defense. Resolve the Cloudflare WAF rate-rule TODO for `/v1/license/*` in
  `packages/proxy/README.md` before treating the production proxy as fully
  release-ready.
- Before publishing, verify that `packages/plugin/src/ui/proxy.ts` and the
  manifest's `networkAccess` both use `https://api.spec-layer.com`, then rebuild
  and rerun the plugin smoke test.

## Full Changelog

See [CHANGELOG.md](https://github.com/sandroleks/spec-layer/blob/main/CHANGELOG.md).

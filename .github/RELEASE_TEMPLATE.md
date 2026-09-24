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

Deterministic sections run entirely inside the plugin and send nothing. AI writing routes through the Spec Layer proxy, which holds the Anthropic credential; no user API key is involved. Component requests include a derived summary and, when it fits the limits, a rendered image; Foundation requests send token names and resolved values without an image. Publishing a library stores its bundle on the proxy for the `spec-layer` CLI, behind a pull key the proxy keeps only as a SHA-256 digest. The proxy validates raw license keys with Lemon Squeezy but uses SHA-256 digests for its own cache keys, quota identities, and logs. Keep credentials and private design-system data out of Git.

## Verification

The release candidate must pass:

```text
npm ci
npm run check:ci
git diff --check
```

Plus the current manual Figma pass in `packages/plugin/TESTING.md`, recorded
in the release notes rather than assumed: load the
built manifest and confirm component docs, Foundation docs, Library, and Copy
for AI behavior on a synthetic or publishable file.

Also run `npm run check:site-live`. It fetches
`https://spec-layer.com/schemas/foundation-context/v5.json` and
`component-context/v5.json` from the custom domain and compares them byte for
byte with the committed schemas. A failure blocks the release; a `*.pages.dev`
preview is not enough.

## Known Limitations

- Only the `spec-layer` CLI is published to npm; the other workspace packages
  are private. A release that needs a newer CLI names the minimum version, and
  that version must be `latest` on npm before the listing update goes out.
- Verify the active Cloudflare rule `Protect license endpoints` still applies
  per IP to `starts_with(http.request.uri.path, "/v1/license/")`, blocks after
  more than 5 requests in 10 seconds, and has a 10-second mitigation timeout.
- Before publishing, verify that `packages/plugin/src/ui/proxy.ts` and the
  manifest's `networkAccess` both use `https://api.spec-layer.com`, then rebuild
  and rerun the plugin smoke test.

## Full Changelog

See [CHANGELOG.md](https://github.com/sandroleks/spec-layer/blob/main/CHANGELOG.md).

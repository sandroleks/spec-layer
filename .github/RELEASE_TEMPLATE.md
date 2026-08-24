# Spec Layer vX.Y.Z

## Highlights

- <User-visible change, in the plugin's voice: plain, specific, no em dashes.>

## Getting Started

Install from the [Figma Community listing](https://www.figma.com/community/plugin/1652104411578396548).

To run this release from source, with Node.js 20.9 or newer:

```bash
npm ci
npm run build:plugin
```

Then in Figma desktop choose **Plugins → Development → Import plugin from manifest** and select `packages/plugin/manifest.json`.

## Security Model

Deterministic sections run entirely inside the plugin and send nothing. AI prose routes through the Spec Layer proxy, which holds the Anthropic credential; no user API key is involved. License keys are stored hashed server-side, never in the clear and never in a URL. Keep credentials and private design-system data out of Git.

## Verification

The release candidate must pass:

```text
npm ci
npm run check:ci
git diff --check
```

Plus the manual Figma pass for anything the suite cannot reach: load the built manifest and confirm the release's changes on a real file.

## Known Limitations

- Workspace packages are not published to npm.
- Builds from source point at the staging proxy. Swap the host in `packages/plugin/src/ui/proxy.ts` and the manifest's `networkAccess` before a public release.

## Full Changelog

See [CHANGELOG.md](https://github.com/SamsonHD/spec-layer/blob/main/CHANGELOG.md).

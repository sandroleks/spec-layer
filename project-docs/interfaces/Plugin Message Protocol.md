---
title: Plugin Message Protocol
tags:
  - interface
  - figma
  - messages
status: living
updated: 2026-07-27
source: packages/plugin/src/messages.ts
---

# Plugin message protocol

The Figma main thread and iframe communicate with `postMessage`. `MainToUi` and `UiToMain` are discriminated unions in `packages/plugin/src/messages.ts`.

## Main thread to UI

| Type | Purpose |
|---|---|
| `selection` | Current serialized component, Figma file key, and key source |
| `licenseKey` | Stored license key and activation instance |
| `userInfo` | Figma user ID for free identity |
| `aiEnabled` | Stored AI preference |
| `brandTheme` | Current frame theme |
| `fontList` | Compatible font families |
| `logoCaptured`, `logoCleared`, `logoError` | Logo capture lifecycle |
| `componentImage`, `componentImageError` | Base64 PNG for AI vision |
| `docFrameDone`, `docFrameError` | Component frame result |
| `library` | Generated-doc registry entries |
| `docDetached`, `docRemoved` | Library mutations |
| `driftSource`, `driftError` | Fresh source for component drift checks |
| `docSource`, `docSourceError` | Fresh source/config for update or download |
| `foundation`, `foundationError` | Serialized whole-file foundation dump |
| `foundationProgress` | Bulk foundation build progress |
| `foundationDone`, `foundationFrameError` | Foundation frame result |

## UI to main thread

| Type | Purpose |
|---|---|
| `requestSelection` | Serialize the current component selection |
| `notify` | Show a Figma notification |
| `openBrowser` | Open an external URL |
| `setLicenseKey` | Persist/remove key and instance ID |
| `setAiEnabled` | Persist AI preference |
| `setBrandTheme` | Persist frame theme |
| `requestFonts` | List supported font families |
| `captureLogo`, `clearLogo` | Manage stored logo |
| `requestComponentImage` | Export a selected node as PNG |
| `renderDocFrame` | Materialize/replace a component doc |
| `requestLibrary` | Refresh generated-doc registry |
| `focusNode` | Focus a source or doc node |
| `detachDoc` | Remove link metadata but keep frame |
| `removeDoc` | Delete generated doc and registry entry |
| `requestDrift` | Re-extract a component source |
| `requestDocSource` | Fetch source for `update` or `download` |
| `requestFoundation` | Serialize all local foundations |
| `renderFoundation` | Build selected foundation units |
| `updateFoundationDoc` | Rebuild one foundation doc |

## Core payloads

### `renderDocFrame`

Carries:

- `DocFrameModel`
- source node ID
- deterministic content hash
- `DocConfig`

### `LibraryEntry`

Carries:

- doc and source identity;
- `kind` (`component` or `foundation`);
- labels and page name;
- source existence;
- self-edit state;
- stored content hash;
- current foundation content hash when already computed.

Component drift is resolved lazily per row. Foundation drift can be computed from one shared whole-file extraction.

### Foundation descriptions

`renderFoundation` may include `groupDescriptions` keyed by:

```text
<collectionId>|<folder>
```

The composite key prevents two collections with the same folder label from colliding.

## Concurrency considerations

- Selection uses a sequence guard against out-of-order async serialization.
- `foundationDone.docId` distinguishes a single-row update from a concurrent bulk build.
- UI code uses request tokens to prevent late async responses from overwriting newer state.

## Trust note

Types improve internal correctness but do not validate runtime messages by themselves. Both runtimes are bundled from the same codebase, so the protocol assumes a trusted plugin bundle.


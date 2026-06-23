# Standalone Figma Plugin — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorming)
**Scope:** Throwaway prototype on branch `plugin-standalone`. No changes to `main`. No changes to `apps/web`.

## Goal

Make the Figma plugin useful on its own, without the docs web app. Today the plugin is a one-way exporter (extract → download / send-to-docs). After this work it can:

1. Use AI directly inside the plugin (bring-your-own Anthropic key).
2. Generate a nicely formatted **guidelines frame** on the Figma canvas — a supporting frame placed next to the original component, containing text sections and real token tables.
3. Still optionally sync to the docs web app (unchanged "Send to docs").
4. Let the user pick which sections to include; AI fills the AI-backed sections and sees the actual component image (vision).
5. Keep the plugin flow simple and unambiguous.

## Decisions (locked)

| Topic | Decision |
|---|---|
| AI access | Bring-your-own Anthropic key, stored in `clientStorage`; plugin calls `api.anthropic.com` directly. Reuses `draftProse`. |
| AI scope | One-shot generation of AI sections. No per-section regenerate, no chat. User edits text manually after. |
| Doc frame contents | Text sections + real token tables. No embedded component image (component lives in its own frame). |
| Doc frame build | Approach A — build from the structured `IntermediateSpec` + `ProseDrafts`. No markdown→Figma parsing. Token tables = simple flat tables grouped Color / Typography / Measurements. |
| Extraction | Implicit — auto-run on selection / first action. No visible Extract button. |
| Prose formatting in frame | Minimal-rich: real bullets, bold lead-ins (bold text ranges), `###` as small subheadings. |
| Re-run "Create doc frame" | Frame named `<Component>: Guidelines`; if one exists, replace its contents in place. |
| Vision image | Export the resolved component/component-set as PNG (~2x), downscaled to a max dimension to cap base64 size. |
| Model | `claude-haiku-4-5` (cheap, vision-capable) — already used by `draftProse`. |
| Polish | Throwaway prototype. Unit-test the pure functions only. |

## Architecture

All new code is in `packages/plugin`, plus one backward-compatible tweak in `@spec-layer/extractor`.

### Main thread (`src/main.ts`)
Two new message handlers:
- `requestComponentImage` → `node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })`, downscaled to a max dimension; returns base64 + media type to the UI for the AI vision call.
- `renderDocFrame` → receives a `DocFrameModel` from the UI and builds the frame on canvas (font loading, auto-layout, token tables), placed to the right of the selected component. Replaces an existing `<Component>: Guidelines` frame if present.

### New main-thread module `src/docFrame.ts`
Pure-ish frame builder. Input: `DocFrameModel` (title + ordered sections; each section is prose text, a bullet list, or a token table). Creates the Figma nodes (auto-layout frames, text nodes with bold ranges, table rows). Keeps `main.ts` thin. This is the main new chunk of Figma-write code and the only part not unit-tested (touches the Figma API).

Font note: bold lead-ins use `setRangeFontName` with a bold face, which requires loading **both** `Inter Regular` and `Inter Bold` (and `Inter Medium` for headings) via `figma.loadFontAsync` before writing any text.

### UI thread
- New `src/ui/ai.ts` — wraps `draftProse`: pulls the API key from state, requests the component PNG from main, calls Anthropic, returns `ProseDrafts`. Cache backed by an in-memory `Map` so repeated clicks in a session don't re-bill.
- New `src/ui/docModel.ts` — pure: `(spec, prose, selectedSections) → DocFrameModel`. Decides which sections appear and shapes them (deterministic sections from the spec, AI sections from prose, placeholders when prose is absent). Unit-testable without Figma.
- `src/ui/actions.ts` — new `runGenerate` (AI fill) and `runCreateDocFrame` (post model to main). Both auto-extract first if needed.

### Extractor change (backward compatible for the web app)
`draftProse`'s `DraftOptions` currently accepts `imageUrl` (url image source). Add an alternative `imageBase64` + `imageMediaType` for the plugin (which produces base64, not a URL). The content block branches: base64 → `{ type: 'image', source: { type: 'base64', media_type, data } }`; url → existing. Web app keeps using `imageUrl` unchanged.

**Required cache-key fix:** `proseCacheKey` keys the vision marker on `Boolean(opts.imageUrl)` (client.ts:25-27, 54). A base64 vision run would be mis-keyed as text-only and could be served (or collide with) a text-only draft. Update the marker to `Boolean(opts.imageUrl || opts.imageBase64)`.

### Message protocol (`src/messages.ts`)

New `UiToMain`:
- `{ type: 'requestComponentImage', nodeId: string }`
- `{ type: 'renderDocFrame', model: DocFrameModel }`

New `MainToUi`:
- `{ type: 'componentImage', base64: string, mediaType: 'image/png' }` and `{ type: 'componentImageError', message: string }`
- `{ type: 'docFrameDone' }` and `{ type: 'docFrameError', message: string }`

`DocFrameModel` is defined in `docModel.ts` and imported by both `messages.ts` and `docFrame.ts`.

### Node identity (which node to export / where to place the frame)
`main.ts` does not currently retain the selected node — `postSelection` serializes and discards it. To support `requestComponentImage` and frame placement:
- Extend the existing `selection` `MainToUi` message to carry the resolved component's `nodeId`. The UI stores it in state.
- `requestComponentImage` and `renderDocFrame` pass that `nodeId`; main re-resolves it via `figma.getNodeByIdAsync(nodeId)` (selection may have changed). Frame placement reads the node's `x/y/width` to position the guidelines frame to its right.

### Image export details (`requestComponentImage`)
- `node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })` returns a `Uint8Array`.
- Encode to base64 on the main thread with `figma.base64Encode` (Figma main thread has no `btoa`/`Buffer`).
- Cap the long edge at **1568px** and keep base64 under ~5MB to stay within Anthropic vision limits — if the 2x export exceeds it, fall back to a lower `SCALE` value. State the cap explicitly in code.

## Data flow

```
Select component
  → (implicit) extract → IntermediateSpec
  → [Generate with AI] → request PNG from main → draftProse(spec, {imageBase64}) → ProseDrafts
  → assemble DocFrameModel (spec + prose + selected sections)
  → [Create doc frame] → post model to main → build/replace frame on canvas
  (Download .md / Send to docs remain, optional)
```

## UI

Restructure the **Selected** tab into one top-to-bottom flow:

```
Selected component: ● Button (component set)

Sections to include:
  [✓] Definition      (AI)
  [✓] Anatomy
  [✓] Configuration
  [✓] Variants
  [✓] States
  [✓] Tokens used
  [✓] Accessibility   (AI)
  [✓] Do's & Don'ts   (AI)
  [ ] Related atoms

[ Generate with AI ]   ← fills the 3 AI sections (needs key)
[ Create doc frame ]   ← builds the frame on canvas (primary action)

▸ Also: Download .md · Send to docs   (collapsed, optional)
```

- One checklist drives both AI generation and the frame.
- "Generate with AI" needed only if an AI section is checked. No key → inline hint pointing to Settings. Skipping it → AI sections render as `_To be written._`; frame still builds.
- "Create doc frame" is the new primary action. Download / Send-to-docs collapse into an "Also" area.
- **Settings** tab gains an **Anthropic API key** field (password input, `clientStorage`) beside the existing Docs URL / file-key fields.
- **All** tab (bulk ZIP export) is untouched.

**Restructure is real DOM, not just CSS.** The current UI gates the whole review area (textarea, download, send) on `state.currentSpec !== null`, which only `runExtract` sets (render.ts:33-44; `runDownload`/`runSendToDocs` early-return on `!state.currentSpec`). So this work adds: new `Refs` entries in `dom.ts` (the section checklist, Generate/Create buttons, API-key field), new `UiState` fields (selected sections, generated prose, component nodeId, api key), and implicit auto-extract that populates `state.currentSpec` before any action so the legacy Download/Send paths keep working.

**Sections intentionally dropped from the on-canvas frame:** `## Code` (a manual placeholder) and `## Extraction gaps` (a diagnostic) are emitted by `renderSpec` but are deliberately omitted from the guidelines frame's checklist. The frame is built from the structured spec (Approach A), so these are a decision, not an oversight. They still appear in Download / Send-to-docs output.

## Manifest & security

- Add `https://api.anthropic.com` to `networkAccess.allowedDomains` and `devAllowedDomains`, with updated reasoning.
- API key stored in `clientStorage` like the docs endpoint; never logged; password-type input.
- Note: BYO-key-in-`clientStorage` is acceptable for a dev/prototype plugin. A published plugin would need a different secret-handling model.

## Error handling

- Invalid key / API errors (e.g. `Claude API error 401`) surface as a friendly inline banner, not a crash.
- A section with no data renders as "None." / placeholder rather than an empty block.
- One component export/render failure shows a banner; it does not corrupt the canvas.

## Testing

Unit tests (pure functions only, run under existing vitest):
- `docModel.ts` — section selection, ordering, placeholder behavior, token-table grouping.
- The selection→sections mapping helper.

`docFrame.ts` (Figma-write) is verified manually in Figma, consistent with throwaway scope. Existing plugin tests stay green; `draftProse` change keeps its current tests passing.

## Out of scope (throwaway)

Per-section regenerate; chat assistant; embedding the component image in the frame; faithful pivot token tables (use simple flat tables); multi-component frame generation; theming the frame to the user's own design tokens; exhaustive frame-builder tests.

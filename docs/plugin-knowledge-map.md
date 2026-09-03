# Plugin knowledge map

Updated: 2026-08-28

This is the current orientation guide for the Figma plugin and its supporting
packages. Historical design decisions remain in `docs/superpowers/`; current
runtime truth belongs in production source, `ARCHITECTURE.md`, and this map.

## Product boundary

Spec Layer turns selected components and file-level Foundations into connected
documentation Sections on the Figma canvas. **Copy for AI** puts context on the
clipboard: a YAML brief from a component, and a Design Tokens Format Module
2025.10 resolver document (JSON) from a scoped Foundation row in Library or the
complete file-wide token vocabulary from Foundations. Markdown and ZIP output
have been retired.

Structural extraction is deterministic and local. AI writing is optional. The
plugin sends a derived component summary and, when small enough, a rendered
image through the Spec Layer proxy. The plugin never receives an Anthropic key.

## Packages

| Area | Ownership |
|---|---|
| `packages/plugin` | Figma API boundary, iframe UI, connected-document Library, canvas renderers |
| `packages/extractor` | Pure serialized-node extraction, Foundation planning, YAML briefs, hashes, AI prompts/parsers. Bindings carry Figma's own identity (id, kind, `remote`) end to end; `resolution.ts` turns an unresolvable one into a stated status rather than an empty map. |
| `packages/proxy` | Anthropic credential, request validation, quota authority, license validation |

The extractor must remain free of Figma globals. `packages/plugin/src/serialize.ts`
and `serializeFoundation.ts` convert live Figma data into plain inputs that can
be fixture-tested.

## Plugin runtime

Two contexts communicate through the union types in
`packages/plugin/src/messages.ts`.

### Main thread

`packages/plugin/src/main.ts` owns all Figma API calls. It:

- resolves the selected component or component set;
- serializes component and Foundation data;
- renders or updates connected documentation Sections;
- maintains document link metadata;
- captures a logo or bounded component PNG;
- persists AI, theme, logo, and license settings in `clientStorage`.

Component image export is capped by dimensions and encoded size. An oversized
or failed image immediately falls back to text-only AI writing.

### UI iframe

`packages/plugin/src/ui/ui-vnext.ts` is the default production entry point. It
mounts a shared shell and owns five workflows:

1. Generate component docs.
2. Generate Foundation docs.
3. Library.
4. Settings.
5. License.

The Library has a second screen behind it: Publish for developers, reached from
the Library footer's `Publish` action and rendered by `screens/publish.ts`. It
is deliberately not a sixth rail destination, so `PluginView` stays five
entries and `sidebar.ts` keeps its exhaustive icon map. `ui-vnext.ts` tracks
which of the two is showing in a Library-local `libraryPane` flag, which means
the rail stays on Library while publishing.

The command palette searches workflows and connected Library documents.
`actions.ts` owns reusable operations; `viewModel/` derives display state;
`screens/` renders workflow markup; `shell/` owns persistent navigation and
header behavior.

The previous tabbed UI and its adapters (`ui.ts`, `dom.ts`, `render.ts`, and
`ui/state.ts`) have been deleted; there is no legacy runtime or build fallback.

## Connected-document model

Generated Sections carry `DocLinkData`. Component links address a source node;
Foundation links address a collection/group scope. The Library compares stored
content hashes with fresh extraction to distinguish:

- checking;
- in sync;
- update available;
- manually edited;
- source missing.

Updates replace the linked Section in place, but the doc has two lanes.
Generated content (tables, matrices, anatomy structure, chrome) is rebuilt
from the live source. Editorial content (the writing sections) is tagged with
pluginData at render time in `docFrame.ts` and read back by `canvasProse.ts`
on Update, and rendered again unchanged; Update never calls the AI. `selfHash`
covers the generated lane only, so "manually edited" means an edit Update
would replace. Source drift uses deterministic content hashes and excludes
AI prose. Copy for AI and Publish read the same canvas text, with the stored
`DOC_PROSE_KEY` blob filling any section the doc does not render.

## Canvas rendering

`docFrame.ts` renders component documentation. `foundationFrame.ts` renders
Foundation documents. Shared frame primitives and theme behavior live in
`frameKit.ts` and `brandHeader.ts`.

Component content is assembled by `ui/docModel.ts`. Section inclusion,
variant selection, anatomy mode, measurement lenses, and generated prose are
values passed into the renderer; renderers must not read UI DOM state.

Foundation rendering consumes `unitContent(spec, scope)`. Keep the invariant:
fields in that projection are both rendered and hashed. A field that affects
canvas output must not sit outside the projection.

## AI writing and trust boundary

`packages/extractor/src/prose/` owns both client request construction and
response parsing. Component cache keys use the prompt version, content hash,
vision marker, and requested-key signature. Foundation group descriptions use
a separate `:groups:` namespace.

The proxy accepts only shipped component or Foundation request shapes. It
restricts the model, exact system prompts and few-shot, output sizes, message
structure, image encoding, and total request size. Durable Objects serialize
quota operations per hashed identity; raw license keys and prompt contents are
not logged.

AI is best effort. Proxy, image, or parsing failures must never prevent
deterministic document creation.

## Design-system ownership

`packages/plugin/src/ui/design-system/` is the only editable source for vNext
tokens, primitives, and patterns. The similarly named files under
`docs/plugin-ui-vnext/design-system/` are compatibility imports/re-exports for
older plans and must not contain copied implementations.

The build embeds CSS in this order:

1. `tokens.css`
2. `components.css`
3. `patterns.css`

Both themes consume semantic `--sl-*` roles. Avoid page-specific color
overrides when a semantic role can express the state.

## Build and verification

- `npm run build:plugin` builds the plugin. One UI, one bundle: the old UI and
  its `UI_LEGACY` flag are gone.
- `npm run check` runs lint, type checking, tests, the plugin build, sandbox
  validation, and a Wrangler proxy deployment dry-run.
- `npm run check:ci` uses coverage in place of the ordinary test pass and adds
  the full dependency audit, including development tooling.
- `npm run audit` runs that full audit directly.

The manual release gate is `packages/plugin/TESTING.md`.

## Invariants

1. No Figma globals in the extractor.
2. Do not change the YAML brief or hash projections casually. `specContentHash`
   projects `TokenRule.name` back onto the old `token` key on purpose: the
   projection is what keeps a field rename from drifting every committed
   document. `nodeEffects`, `rawValues` and `figmaFileName` are excluded from it
   for the same reason.
3. UI presentation reads derived state, not DOM-owned business state.
4. AI failure never blocks deterministic output.
5. One production design-system source.
6. Never log raw license keys or customer prompt/image content.
7. Manifest and proxy URL move from staging to production together.

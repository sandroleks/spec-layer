# CLAUDE.md

Orientation for agents working in this repository. Read this first, then the
document it points you at for the area you are touching.

## What this is

Spec Layer is a **Figma plugin** that turns components, variables, and styles
into design-system documentation: connected canvas Sections, and compact YAML
context on the clipboard for an AI coding agent ("Copy for AI"). It ships as a
published Community plugin with a free tier and a $7.99/mo Pro tier.

Extraction, rendering, drift detection, and Copy for AI are **deterministic**.
Only optional AI prose uses a model. That split is the product's core claim, so
do not blur it.

There is no web app and no Markdown export. Both were deleted in August 2026.
The plugin, the extractor, the proxy, and the static landing site are the whole
product boundary.

## Layout

```text
packages/plugin/       Figma serializer, canvas renderers, iframe UI (vanilla DOM)
packages/extractor/    pure extraction, v5 context export, YAML, hashes, prompts
packages/proxy/        Cloudflare Worker: Anthropic credential, quotas, licensing
apps/landing/          static marketing site, policies, published JSON schemas
docs/                  current specs, plans, reviews, writing guides
project-docs/          ARCHIVED historical vault, not a source of truth
```

npm workspaces, Node >= 22, TypeScript, Vitest, esbuild. No framework.

## Commands

```bash
npm run check          # the full local gate: lint, typecheck, NUL scan, tests, plugin build, sandbox scan, proxy dry run
npm test               # vitest run (96 files, ~1720 tests, ~4s)
npm run typecheck
npm run lint
npm run build:plugin
```

CI runs `npm run check:ci`, which adds coverage thresholds and a full
dependency audit. Never verify CI or a gate through a pipe that swallows the
exit code; read the status directly.

## Where current truth lives

| Question | Document |
|---|---|
| How the system fits together | `ARCHITECTURE.md` |
| Orientation for the plugin runtime | `docs/plugin-knowledge-map.md` |
| Foundation Context v5 contract | `docs/specs/foundation-context-v5.md` |
| Component Context v5 contract | `docs/specs/component-context-v5.md` |
| What v5 has and has not been graded on | `docs/specs/foundation-v5-status.md` |
| Manual Figma test matrix and release gate | `packages/plugin/TESTING.md` |
| Product plans and priorities | `docs/feature-backlog-2026-07.md` |
| Executed plans, decision history | `docs/superpowers/plans/`, `docs/superpowers/specs/` |
| Plugin UI copy rules | `docs/plugin-voice-and-copy.md` |
| AI prose voice | `docs/prose-style-guide.md` |

`project-docs/` describes retired surfaces. See its `ARCHIVE-NOTICE.md` before
trusting anything in it.

## Invariants

These are load-bearing. Breaking one is a correctness bug, not a style choice.

**Never fabricate.** No invented value, unit, mode, id, publication state, or
completeness claim. Unknown is `null`, absent, or a stated diagnostic. This
applies to extraction output, exported artifacts, and UI copy alike.

**The extractor is Figma-free.** `packages/extractor` must not touch Figma
globals. `packages/plugin/src/serialize.ts` and `serializeFoundation.ts` are the
audit boundary that turns live Figma data into plain JSON.

**The main thread has no browser globals.** Figma's plugin sandbox lacks them,
but Node tests pass anyway, so the failure only shows up in Figma.
`npm run check:sandbox` scans `dist/main.js` for this. Trust the scan, not the
test suite.

**Three hashes answer three questions.** `specContentHash` (component canvas
drift), `foundationContentHash` (Foundation canvas drift), `semanticContentHash`
(exported v5 artifact identity). Keep them separate. Do not let v5 identity
fields leak into a canvas hash, or every existing document falsely reports an
update.

**Rendered implies hashed, and hashed implies rendered.** A foundation unit's
hash covers exactly what its frame draws, in both directions. AI-written group
descriptions are the one deliberate exception, covered by `selfHash` instead.

**`EXTRACTOR_VERSION` is a rebuild request.** Bump it only when extraction
output can change for unchanged source. A spurious bump asks every user to
regenerate every document. It is currently `'2'`.

**Do not use `localeCompare` under `src/v5`.** Use `compareCodeUnits`. Locale
ordering makes hashes machine-dependent.

**Keep the extractor and landing schemas byte-identical.**
`packages/extractor/src/v5/schema/*.json` and `apps/landing/schemas/**` must
match, and the published URL must serve the committed bytes before a release.

**Keep the AI profile downstream.** `v5/aiContext.ts` projects a validated
artifact for prompt size. It never participates in a hash and never justifies
weakening the canonical schema.

**NUL bytes.** Some separator idioms emit raw `0x00` that lint, tests, and
`git diff` all hide. `npm run check:nul` guards `packages/`, but not `docs/`.
This has bitten the repo three times.

**No em dashes in plugin UI copy.** Ever. See `docs/plugin-voice-and-copy.md`
for the full voice rules; sentence case, second person, no hype words, honest
about limits.

**Fixtures must be synthetic or explicitly publishable.** No customer files, no
private Figma URLs, no proprietary component exports, no credentials. A real
design-system artifact needs explicit approval covering ids, names,
descriptions, and diagnostics before it can be committed.

## Where things stand (2026-09-01)

`main` is clean and green: 1718 tests passing, 9 todo.

Shipped and merged:

- Component documentation, Foundation documentation, Library with drift
  detection and in-place rebuild, frame theming, licensing, AI writing.
- **Foundation Context v5** phases 1 to 3. Copy for AI builds a validated
  schema `5.0.0` artifact directly from `FoundationSpec`, preserving stable
  ids, source scopes, RGBA precision, complete alias chains, external
  references, and composite typography/effect styles, then projects a compact
  `profile: ai` clipboard form.
- **Component Context v5** (phase 4 adoption). A component copy joins Foundation
  v5 by stable Figma id and embeds only its own validated dependency closure,
  with repeated bindings grouped under ordered `paths`.
- Production proxy at `api.spec-layer.com`, landing site, freemium flow.

Open, in rough priority order:

1. **The manual Figma matrix in `packages/plugin/TESTING.md` has never been run
   against a development build** for the v5 work. This is the standing release
   blocker. Unit tests cannot reach it.
2. Real design-system grading for v5 criteria 3, 10, and 11 (synthetic golden
   passes; a reviewed real artifact does not exist in-repo). Criterion 9
   (style lifecycle) is ungradable from the current Plugin API.
3. Remaining phase 4 work: command tooling (validate, normalize, diff) outside
   the Figma sandbox, reusing the canonical validator and hash rather than
   writing a second interpretation of v5.
4. Community listing update and version alignment for the 5.0.0 plugin release.

Explicitly not doing: remote MCP or agentic vision enrichment, new Markdown
sections, a hosted composition layer. Those were considered and rejected; the
bet is deterministic extraction depth.

## Working conventions

- Single-line conventional commits, lowercase, scoped:
  `feat(v5): group repeated component bindings`, `fix(proxy): ...`,
  `docs: ...`, `chore(plugin): ...`.
- A pre-commit hook (`.githooks/pre-commit`, wired via `core.hooksPath`) rejects
  known secret patterns.
- Update `CHANGELOG.md` alongside behavior changes, and the relevant `docs/spec`
  or status document alongside contract changes. Recent commits do all three in
  one change; match that.
- Dead code hides behind its own tests here. Judge whether plugin code is live
  by reachability from `main.ts` and `ui/ui-vnext.ts`, not by whether tests
  reference it.

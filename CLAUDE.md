# CLAUDE.md

Orientation for agents working in this repository. Read this first, then the
document it points you at for the area you are touching.

## What this is

Spec Layer is a **Figma plugin** that turns components, variables, and styles
into design-system documentation: connected canvas Sections, and context on the
clipboard for an AI coding agent ("Copy for AI"). A component copies as a
compact YAML brief; a Foundation copies as a DTCG resolver document (JSON). A
Pro user can publish a library and a developer pulls it into a repository with
the `spec-layer` CLI. It ships as a published Community plugin with a free tier
and a $7.99/mo Pro tier.

Extraction, rendering, drift detection, and Copy for AI are **deterministic**.
Only optional AI prose uses a model. That split is the product's core claim, so
do not blur it.

There is no web app and no Markdown export; both were deleted in August 2026.
`apps/landing` was deleted in September 2026. The plugin, the extractor, the
proxy, the CLI, the shared brand package, and the static site at
`spec-layer.com` are the whole product boundary.

## Layout

```text
packages/plugin/       Figma serializer, canvas renderers, iframe UI (vanilla DOM)
packages/extractor/    pure extraction, v5 context export, YAML, hashes, prompts
packages/proxy/        Cloudflare Worker: Anthropic credential, quotas, licensing
packages/cli/          spec-layer CLI: setup, init, pull, status, list, show, tools, skill; delivery plus pure platform projections, no extraction
packages/brand/        @spec-layer/brand: shared tokens, identity assets, contrast gate
apps/website/          static site generator: marketing, docs, policies, published JSON schemas
docs/                  current specs, plans, reviews, brand system, writing guides
project-docs/          ARCHIVED historical vault, not a source of truth
```

npm workspaces cover `packages/*` only; `apps/website` sits outside the
workspace and runs its own scripts with `--prefix apps/website`. Node >= 22,
TypeScript, Vitest, esbuild. No framework.

## Commands

```bash
npm run check                        # full local gate
npm test                             # vitest run (133 files, 2499 tests, 9 todo, ~15s)
npm run typecheck
npm run lint
npm run build:plugin                 # runs the brand build first, so a contrast failure stops it
npm run build:cli
npm run check --prefix apps/website  # website build plus its own checks
npm run check:site-live              # live spec-layer.com schemas against the committed files
```

`npm run check` is lint, typecheck, NUL scan, tests, plugin build, CLI build,
CLI bundle smoke test, sandbox scan, proxy deploy dry run.

CI (`.github/workflows/ci.yml`) runs `npm run check:ci`, which adds coverage
thresholds and a full dependency audit, then both website build modes. Its job
id is `verify`, which is the required status check on `main`; do not rename it.
CodeQL runs weekly and per pull request and is deliberately advisory, not a
merge gate. Never verify CI or a gate through a pipe that swallows the exit
code; read the status directly.

## Where current truth lives

| Question | Document |
|---|---|
| How the system fits together | `ARCHITECTURE.md` |
| Orientation for the plugin runtime | `docs/plugin-knowledge-map.md` |
| What shipped, in detail | `CHANGELOG.md` |
| Foundation Context v5 contract | `docs/specs/foundation-context-v5.md` |
| Component Context v5 contract | `docs/specs/component-context-v5.md` |
| What v5 has and has not been graded on | `docs/specs/foundation-v5-status.md` |
| Manual Figma test matrix and release gate | `packages/plugin/TESTING.md` |
| Shared brand and UI design system | `packages/brand/README.md`, `docs/brand/system-v1/README.md` |
| Reviews and their evidence | `docs/reviews/` |
| Executed plans, decision history | `docs/superpowers/plans/`, `docs/superpowers/specs/` |
| Plugin UI copy rules | `docs/plugin-voice-and-copy.md` |
| AI prose voice | `docs/prose-style-guide.md` |

`docs/feature-backlog-2026-07.md` is a July snapshot. Its tier 0 and tier 1
items are largely shipped; treat the status section below as current priority,
not that file.

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
update. A fourth, bundle-level hash sits outside those three:
`libraryBundleContentHash` (`packages/extractor/src/libraryBundleHash.ts`)
answers "did this publish change what developers pull", by hashing the bundle
with each artifact's per-export envelope (`export.id`, `export.generated_at`)
removed. It never feeds a canvas hash or an artifact identity, and the proxy
keeps the raw byte hash separately for the pull `ETag`.

**Rendered implies hashed, and hashed implies rendered.** A foundation unit's
hash covers exactly what its frame draws, in both directions. AI-written group
descriptions are the one deliberate exception, covered by `selfHash` instead.

**The diff input is the hash input.** A Library row's change list is computed
from the baseline the drift hash was taken over, so a list can never disagree
with its badge. `diffKeyed` in `packages/extractor/src/diff.ts` is the
shared core, and the piece a future `spec-layer diff` reuses.

**`EXTRACTOR_VERSION` is a rebuild request.** Bump it only when extraction
output can change for unchanged source. A spurious bump asks every user to
regenerate every document. It is currently `'2'`, and the only sanctioned bump
to `'3'` belongs to the Component Frame Quality plan below.

**Do not use `localeCompare` under `src/v5`.** Use `compareCodeUnits` from
`v5/diagnostics.ts`. Locale ordering makes hashes machine-dependent.
`packages/extractor/src/hash.ts` still sorts with `localeCompare`; that is a
known defect, and fixing it moves every canvas hash, so it is deliberately
held for the next `EXTRACTOR_VERSION` bump rather than fixed in passing.

**Keep the extractor and website schemas byte-identical.**
`packages/extractor/src/v5/schema/*.json` and
`apps/website/public/schemas/**` must match, and the published URL must serve
the committed bytes before a release. `npm run check:site-live` checks the
live site against the committed files.

**Keep the AI profile downstream.** `v5/aiContext.ts` projects a validated
artifact for prompt size. It never participates in a hash and never justifies
weakening the canonical schema. It now feeds only the Foundation dependency
slice a Component Context v5 copy embeds.

**DTCG is a projection.** `v5/dtcg.ts` reads a validated artifact and never
feeds a hash. What the format cannot express is omitted and written to the
report. Never a plausible default, never a fake reference.

**Shared brand values are generated, never copied.** `packages/brand/src` is
the one source for shared color, type, shape, and motion. Consumers call
`buildBrand()` and import the generated CSS; the plugin owns its own layout and
density in its adapter. The contrast gate runs inside `npm run build:plugin`, so
a failing pair stops the build. Customer-generated documentation keeps its own
themes and must never pick up the product palette.

**NUL bytes.** Some separator idioms emit raw `0x00` that lint, tests, and
`git diff` all hide. `npm run check:nul` covers git-tracked text under
`packages/`, `scripts/`, `apps/`, and `docs/`, plus the root documents. This has
bitten the repo three times.

**No em dashes in plugin UI copy.** Ever. See `docs/plugin-voice-and-copy.md`
for the full voice rules; sentence case, second person, no hype words, honest
about limits.

**Fixtures must be synthetic or explicitly publishable.** No customer files, no
private Figma URLs, no proprietary component exports, no credentials. A real
design-system artifact needs explicit approval covering ids, names,
descriptions, and diagnostics before it can be committed.

## Where things stand (2026-09-09)

`main` is clean, green, and fully pushed: 133 test files, 2499 tests passing,
9 todo.

Shipped and merged. `CHANGELOG.md` is the detailed log; this is the shape of it:

- **Documentation surfaces.** Component documentation, Foundation
  documentation, frame theming, licensing, AI writing. Library tracks every
  generated Section with drift detection, in-place rebuild, hand-edit
  preservation, and per-item change lists that name what moved, including
  component token changes compared per variant. Quick search lists documents
  and opens them in Library.
- **Foundation Context v5 and Component Context v5**, schema `5.1.0`. Copy for
  AI builds a validated artifact directly from the source model, preserving
  stable ids, source scopes, RGBA precision, complete alias chains, external
  references, composite typography and effect styles, and optional
  `code_syntax`. A component copy joins Foundation v5 by stable Figma id and
  embeds only its own dependency closure, with repeated bindings grouped under
  ordered `paths`.
- **DTCG Foundation export.** `v5/dtcg.ts` projects a validated Foundation
  artifact into a Design Tokens Format Module 2025.10 resolver document. It is
  the Foundation clipboard, the published bundle's `foundation.ai`, and what
  `spec-layer pull` writes into `tokens/`, replacing Spec Layer's own YAML
  everywhere except the component dependency slice. Diagnostic severity is
  calibrated against real sources: `UNIT_METADATA_UNAVAILABLE` is a warning,
  not an error, because a real 5.0.0 library reported 70 errors before that
  recalibration and 64 of them were that one code.
- **Delivery.** Production proxy at `api.spec-layer.com`, freemium flow, and
  library publish. A free plan publishes one library and 10 updates a month;
  the Publish screen states the allowance, links the CLI docs, and records the
  last publish date. **CLI `0.5.0` is published on npm** (2026-09-06) and its
  published bundle is byte-identical to a build of `main`. `spec-layer tools`
  is the command catalogue with network, key, writes, and exit codes per
  command; `spec-layer skill --install` writes a coding-agent guide built from
  that catalogue, the last pull, and a root-only reading of the repository's
  stack (`detect.ts`), into each detected agent host's instruction file.
  `setup` names it as the next step, and the Publish screen's **Copy for an AI
  agent** copies the setup command followed by it. **CLI `0.6.0` is
  published** (2026-09-09). **CLI `0.7.0` is on `main` and unpublished**: the
  web output is a `tokens/` directory with `index.css`, briefs live in
  `component-specs/`, manifest paths are cwd-relative.
- **2026-09-05 review quick wins.** Memoized resolver lookups, bulk variable
  reads, foundation dump posted once per read, in-panel confirmation dialogs,
  no non-component toast, Copy for AI on the component screen and per
  Foundations row, minified bundles, compact DTCG clipboard with a kilobyte
  size notice. Design in
  `docs/superpowers/specs/2026-09-05-review-quick-wins-design.md`.
- **Shared design system.** `packages/brand` is the single token source, with a
  contrast gate. Phases 1 to 4 are complete: the plugin and the website both
  consume it, and the released artwork and captures are integrated. Phase 5,
  native Figma verification and release, is planned.
- **Website.** `apps/website` is live at `spec-layer.com` and serves the
  committed schemas; `npm run check:site-live` passes. The 2026-09-08 SEO pass
  is deployed: HTTP www routing fixed, sitemap submitted, WebP gallery variants
  generated, the brand and site stylesheets flattened into one delivered file,
  and robots ownership consolidated at the edge. Evidence and the measured
  limits are in `docs/reviews/2026-09-08-seo-audit/` and
  `docs/reviews/2026-09-08-seo-fixes/`.
- **Repository hardening** (2026-09-08). `main` requires a squash-merged pull
  request passing `verify`, with linear history and up-to-date branches; a tag
  ruleset protects `v*`. `CODEOWNERS` had pointed at a non-collaborator, so
  code-owner review had never applied, and `SECURITY.md` told reporters to use
  private vulnerability reporting while it was disabled; both are fixed. CodeQL
  added. The GitHub-side settings are applied by API and are not version
  controlled.

Open, in rough priority order:

1. **The manual Figma matrix in `packages/plugin/TESTING.md` has never been run
   against a development build.** This is the standing release blocker; unit
   tests cannot reach it. `docs/reviews/2026-09-05-matrix-run.md` is the
   recording template and is still blank, including the three questions the
   2026-09-05 review could not answer: whether `window.confirm` shows a dialog
   in the plugin iframe, how often the non-component toast fires, and the real
   size and paste behaviour of the DTCG clipboard.
2. **Plugin republish and listing.** The plugin has not republished at schema
   `5.1.0`, so a pulled sidecar still carries no `code_syntax`. A live
   `spec-layer pull` of a real 5.0.0 library on 2026-09-03 wrote a complete
   `tokens/` directory of 15 files that Style Dictionary 5.5.2 built into 271
   CSS variables with references resolved, which is the evidence that delivery
   works end to end. The Community listing update and version alignment for the
   5.0.0 plugin release ride along with the republish, as does publishing CLI
   `0.7.0`.
3. **Component Frame Quality Round 1**, planned and not started. Plan:
   `docs/superpowers/plans/2026-09-07-component-frame-quality.md`; design:
   `docs/superpowers/specs/2026-09-06-component-frame-quality-design.md`. It
   replaces the Configuration section with a Properties table, trims the
   Anatomy legend, fixes the radius gap check and the anatomy wrapper descent,
   and is the change that bumps `EXTRACTOR_VERSION` to `'3'` and makes
   `hash.ts` locale-safe.
4. **Patterns and nested components**, design only:
   `docs/superpowers/specs/2026-09-06-patterns-and-nested-components-design.md`.
5. **Real design-system grading** for v5 criteria 3, 10, and 11. The synthetic
   golden passes; a reviewed real artifact does not exist in-repo, and cannot be
   committed without explicit approval. Criterion 9 (style lifecycle) is
   ungradable from the current Plugin API.
6. **v5 command tooling**: `validate`, `normalize`, and `diff` in
   `packages/cli`, outside the Figma sandbox, reusing the canonical validator,
   hash, and `diffKeyed` rather than writing a second interpretation of v5.
7. **Design system phase 5**: cross-surface checks, native Figma verification,
   release notes, rollback.
8. **A per-IP monthly publish ceiling is deferred.** Free publishing budgets a
   library and 10 updates per self-asserted Figma identity, so a client that
   lies about `X-Figma-User` can shop for fresh buckets and the per-IP rate
   limiter is the only ceiling. See the accepted risks in
   `packages/proxy/README.md`.

Explicitly not doing: remote MCP or agentic vision enrichment, new Markdown
sections, a hosted composition layer. Those were considered and rejected; the
bet is deterministic extraction depth.

## Working conventions

- `main` is protected. Work on a branch and merge a squash pull request that
  passes `verify`; do not push to `main`.
- Conventional commit subject: one line, lowercase, scoped, for example
  `feat(v5): group repeated component bindings`, `fix(proxy): ...`,
  `docs: ...`, `chore(plugin): ...`. Add a body when the change needs
  explaining. Commits carry a `Co-Authored-By` trailer.
- A pre-commit hook (`.githooks/pre-commit`, wired via `core.hooksPath`) rejects
  known secret patterns.
- Update `CHANGELOG.md` alongside behavior changes, and the relevant
  `docs/specs` or status document alongside contract changes. Recent commits do
  all three in one change; match that.
- Dependabot raises grouped npm updates weekly and GitHub Actions updates
  monthly.
- Dead code hides behind its own tests here. Judge whether plugin code is live
  by reachability from `main.ts` and `ui/ui-vnext.ts`, not by whether tests
  reference it.

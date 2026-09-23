# CLAUDE.md

Orientation for agents working in this repository. Read this first, then the
document it points you at for the area you are touching.

## What this is

Spec Layer is a **Figma plugin** that turns components, variables, and styles
into design-system documentation: connected canvas Sections, and context on the
clipboard for an AI coding agent ("Copy for AI"). A component copies as a
compact YAML brief or, when Settings is set to Markdown, a readable Markdown
page; a Foundation copies as a DTCG resolver document (JSON). A Pro user can
publish a library and a developer pulls it into a repository with
the `spec-layer` CLI. It ships as a published Community plugin with a free tier
and a $7.99/mo Pro tier.

Extraction, rendering, drift detection, and Copy for AI are **deterministic**.
Only optional AI prose uses a model. That split is the product's core claim, so
do not blur it.

There is no web app. The 1.x Markdown specification and its format package
were deleted in 2026 and are not coming back; Markdown exists today only as a
projection of the Component Context v5 artifact (`v5/markdown.ts`), beside
YAML and DTCG, and never as a contract of its own. The plugin, the extractor,
the proxy, the CLI, the shared brand package, and the site at
`spec-layer.com` are the whole product boundary.

## Layout

```text
packages/plugin/       Figma serializer, canvas renderers, iframe UI (vanilla DOM)
packages/extractor/    pure extraction, v5 context export, YAML, hashes, prompts
packages/proxy/        Cloudflare Worker: Anthropic credential, quotas, licensing
packages/cli/          spec-layer CLI: setup, init, pull, status, list, show, tools, skill; delivery plus pure platform projections, no extraction
packages/brand/        @spec-layer/brand: shared tokens, identity assets, contrast gate
```

npm workspaces cover `packages/*`, which is now the whole tree. Node >= 22,
TypeScript, Vitest, esbuild. No framework.

The marketing site (`apps/website`), the prose tree (`docs/`), the archived
vault (`project-docs/`), and the capture library (`screenshots/`) were removed
from this repository in September 2026 and are maintained privately. This is
the open-source repository: it carries the shipping code, its tests, and the
published JSON Schemas, and nothing that is not meant to be public. Do not
re-add those trees here, and do not write a new pointer to a file this
repository does not contain. Source comments still cite the design documents a
rule came from; those are provenance for the maintainers, left as they were
written, and are not an invitation to add more.

## Commands

```bash
npm run check                        # full local gate
npm test                             # vitest run
npm run typecheck
npm run lint
npm run build:plugin                 # runs the brand build first, so a contrast failure stops it
npm run build:cli
npm run check:site-live              # live spec-layer.com schemas against the committed files
```

`npm run check` is lint, typecheck, NUL scan, tests, plugin build, CLI build,
CLI bundle smoke test, sandbox scan, proxy deploy dry run.

CI (`.github/workflows/ci.yml`) runs `npm run check:ci`, which adds coverage
thresholds and a full dependency audit. Its job id is `verify`, which is the
required status check on `main`; do not rename it.
CodeQL runs weekly and per pull request and is deliberately advisory, not a
merge gate. Never verify CI or a gate through a pipe that swallows the exit
code; read the status directly.

## Where current truth lives

These all live in this repository:

| Question | Document |
|---|---|
| How the system fits together | `ARCHITECTURE.md` |
| What shipped, in detail | `CHANGELOG.md` |
| Foundation Context v5 contract | `packages/extractor/src/v5/schema/foundation-5.1.0.json` |
| Component Context v5 contract | `packages/extractor/src/v5/schema/component-5.2.0.json` |
| Manual Figma test matrix and release gate | `packages/plugin/TESTING.md` |
| Shared brand and UI design system | `packages/brand/README.md` |
| Proxy behaviour and accepted risks | `packages/proxy/README.md` |

The schemas above are the enforceable v5 contract. The prose that explains
them, along with the plugin knowledge map, the review evidence, the executed
plans, and the voice and copy guides, is in the private repository. When you
need a rule from one of those and it is not here, ask rather than
reconstructing it from memory.

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
regenerate every document. It is `'3'` on `main` since #66 (97bfed1,
2026-09-18); `v5.1.0` shipped `'2'`, so the next plugin cut is the one that
asks existing documents to rebuild. Any further extraction change needs `'4'`.

**Do not use `localeCompare` under `src/v5`.** Use `compareCodeUnits` from
`v5/diagnostics.ts`. Locale ordering makes hashes machine-dependent.
`packages/extractor/src/hash.ts` has sorted by code unit since #66, the same
commit that moved `EXTRACTOR_VERSION` to `'3'`.

**The published schema URL must serve the committed bytes.**
`packages/extractor/src/v5/schema/*.json` is the only copy of the schemas now,
and `spec-layer.com/schemas/**` must serve exactly those bytes before a
release. `npm run check:site-live` checks the live site against them. The site
is deployed from the private repository, so a schema change here is not live
until that side is redeployed; the check is what proves it.

**Keep the AI profile downstream.** `v5/aiContext.ts` projects a validated
artifact for prompt size. It never participates in a hash and never justifies
weakening the canonical schema. It now feeds only the Foundation dependency
slice a Component Context v5 copy embeds.

**DTCG is a projection.** `v5/dtcg.ts` reads a validated artifact and never
feeds a hash. What the format cannot express is omitted and written to the
report. Never a plausible default, never a fake reference.

**Markdown is a projection.** `v5/markdown.ts` reads a validated artifact and
never feeds a hash. It drops the per-row machine fields the YAML carries
(`source_id`, `collection_id`, `issue_counts`) and keeps the same `spec_layer`
and `source` envelope, so a page can still be matched to the artifact it came
from. It marks AI prose as AI written and never invents a value. Nothing
parses it back, and it has no version of its own.

**Shared brand values are generated, never copied.** `packages/brand/src` is
the one source for shared color, type, shape, and motion. Consumers call
`buildBrand()` and import the generated CSS; the plugin owns its own layout and
density in its adapter. The contrast gate runs inside `npm run build:plugin`, so
a failing pair stops the build. Customer-generated documentation keeps its own
themes and must never pick up the product palette.

**NUL bytes.** Some separator idioms emit raw `0x00` that lint, tests, and
`git diff` all hide. `npm run check:nul` covers git-tracked text under
`packages/` and `scripts/`, plus the root documents. This has bitten the repo
three times, every time in a plan document; those now live privately and are
scanned there.

**No em dashes in plugin UI copy.** Ever. Sentence case, second person, no hype
words, honest about limits, and never a claim the extractor cannot back. The
full voice guide is in the private repository.

**Fixtures must be synthetic or explicitly publishable.** No customer files, no
private Figma URLs, no proprietary component exports, no credentials. A real
design-system artifact needs explicit approval covering ids, names,
descriptions, and diagnostics before it can be committed.

## Where things stand (2026-09-23)

`npm run check` passes at `5985255` and `npm audit` reports no
vulnerabilities. Suite size lives in the test output, not here.

Both surfaces are tagged. `v5.1.0` is an annotated tag (0b84a9c, 2026-09-16)
on 28a55c9 (`chore(release): cut 5.1.0 (#57)`, 2026-09-10), and the GitHub
Release "Spec Layer v5.1.0" was published 2026-09-16. `spec-layer@0.10.0` is
`latest` on npm (published 2026-09-23). The plugin version source is
`packages/plugin/package.json` (5.1.0); `manifest.json` carries no version
field. Whether the Figma Community listing serves 5.1.0 cannot be verified
from this repository. Everything merged after the tag, #59 through #80,
sits under `[Unreleased]` in `CHANGELOG.md`, including `EXTRACTOR_VERSION`
`'3'`.

**`CHANGELOG.md` is the record of what shipped and why.** This section restated
it once and went stale for its trouble. Keep it to what is not yet in the
changelog.

Open, in rough priority order:

1. **The manual Figma matrix in `packages/plugin/TESTING.md` has no recorded
   run.** 5.0.0 shipped without one, so never cite a passing matrix as
   evidence; unit tests cannot reach what it covers. Two questions the
   2026-09-05 review could not answer are still open: how often the
   non-component toast fires, and the real size and paste behaviour of the
   DTCG clipboard. The third, whether `window.confirm` shows a dialog in the
   plugin iframe, is closed: 8eebf78 (2026-09-05) replaced it with the
   in-shell `confirmDialog`, no `confirm(`, `alert(` or `prompt(` call site
   remains under `packages/plugin/src/ui`, and `TESTING.md` step 10 already
   exercises the in-shell dialog.
2. **Component Frame Quality Round 1**, planned; the plan and design are in
   the private repository. #66 (97bfed1, 2026-09-18) landed four of its items
   with `EXTRACTOR_VERSION` `'3'`: `hash.ts` sorts by code unit, the radius
   gap check honours every per-corner binding, the Properties table replaces
   the Configuration section, and the Anatomy legend is trimmed. Only the
   single-wrapper anatomy descent remains, and it takes `'4'` if it changes
   extraction output.
3. **Patterns and nested components**, design only, in the private repository.
4. **Real design-system grading** for v5 criteria 3, 10, and 11. The synthetic
   golden passes; a reviewed real artifact does not exist in-repo, and cannot be
   committed without explicit approval. Criterion 9 (style lifecycle) is
   ungradable from the current Plugin API.
5. **v5 command tooling**: `validate`, `normalize`, and `diff` in
   `packages/cli`, outside the Figma sandbox, reusing the canonical validator,
   hash, and `diffKeyed` rather than writing a second interpretation of v5.
6. **Design system phase 5.** Phases 1 to 4 are done: `packages/brand` is the
   single token source with a contrast gate, and both the plugin and the site
   consume it. Phase 5 is cross-surface checks, native Figma verification,
   release notes, and rollback.
7. **A per-IP monthly publish ceiling is deferred.** Free publishing budgets 1
   library and 10 publishes a month (the first publish counts) per
   self-asserted Figma identity, so a client that
   lies about `X-Figma-User` can shop for fresh buckets and the per-IP rate
   limiter is the only ceiling. See the accepted risks in
   `packages/proxy/README.md`.

Explicitly not doing: remote MCP or agentic vision enrichment, a Markdown
contract, a parser for the Markdown projection, or sections that exist only
in Markdown; and a hosted composition layer. Those were considered and
rejected; the bet is deterministic extraction depth.

## Working conventions

- `main` is protected. Work on a branch and merge a squash pull request that
  passes `verify`; do not push to `main`. Linear history and up-to-date
  branches are required, and a ruleset protects `v*` tags. Those GitHub-side
  settings are applied by API and are not version controlled, so they are not
  visible in this repository.
- Conventional commit subject: one line, lowercase, scoped, for example
  `feat(v5): group repeated component bindings`, `fix(proxy): ...`,
  `docs: ...`, `chore(plugin): ...`. Add a body when the change needs
  explaining. Commits carry a `Co-Authored-By` trailer.
- A pre-commit hook (`.githooks/pre-commit`) rejects known secret patterns,
  including this product's own `sl_` pull keys. `npm ci` runs `prepare`,
  which points `core.hooksPath` at it; `scripts/pre-commit.test.ts` pins
  the shapes.
- Update `CHANGELOG.md` alongside behavior changes and the JSON Schema
  alongside contract changes, in the same commit. `CHANGELOG.md` is the only
  place shipped work is described; do not mirror it into this file.
- Dependabot raises grouped npm updates weekly and GitHub Actions updates
  monthly.
- Dead code hides behind its own tests here. Judge whether plugin code is live
  by reachability from `main.ts` and `ui/ui-vnext.ts`, not by whether tests
  reference it.

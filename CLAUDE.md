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

There is no web app and no Markdown export. Both were built, deleted in 2026,
and are not coming back. The plugin, the extractor, the proxy, the CLI, the
shared brand package, and the site at `spec-layer.com` are the whole product
boundary.

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
npm test                             # vitest run (133 files, 2507 tests, 9 todo, ~17s)
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
| Component Context v5 contract | `packages/extractor/src/v5/schema/component-5.1.0.json` |
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
regenerate every document. It is currently `'2'`, and the only sanctioned bump
to `'3'` belongs to the Component Frame Quality plan below.

**Do not use `localeCompare` under `src/v5`.** Use `compareCodeUnits` from
`v5/diagnostics.ts`. Locale ordering makes hashes machine-dependent.
`packages/extractor/src/hash.ts` still sorts with `localeCompare`; that is a
known defect, and fixing it moves every canvas hash, so it is deliberately
held for the next `EXTRACTOR_VERSION` bump rather than fixed in passing.

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

## Where things stand (2026-09-09)

`main` is clean, green, and fully pushed: 133 test files, 2507 tests passing,
9 todo.

5.0.0 is shipped on all three surfaces: the Figma Community listing, the
GitHub release on tag `v5.0.0`, and `spec-layer@0.7.0` on npm. The listing
serves schema `5.1.0`, so a pulled sidecar now carries `code_syntax`.

**`CHANGELOG.md` is the record of what shipped and why.** This section restated
it once and went stale for its trouble. Keep it to what is not yet in the
changelog.

Open, in rough priority order:

1. **The manual Figma matrix in `packages/plugin/TESTING.md` has no recorded
   run.** 5.0.0 shipped without one, so never cite a passing matrix as
   evidence; unit tests cannot reach what it covers. Three questions the
   2026-09-05 review could not answer are still open: whether `window.confirm`
   shows a dialog in the plugin iframe, how often the non-component toast
   fires, and the real size and paste behaviour of the DTCG clipboard.
2. **Component Frame Quality Round 1**, planned and not started; the plan and
   design are in the private repository. It replaces the Configuration section
   with a Properties table, trims the Anatomy legend, fixes the radius gap
   check and the anatomy wrapper descent, and is the change that bumps
   `EXTRACTOR_VERSION` to `'3'` and makes `hash.ts` locale-safe.
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
7. **A per-IP monthly publish ceiling is deferred.** Free publishing budgets a
   library and 10 updates per self-asserted Figma identity, so a client that
   lies about `X-Figma-User` can shop for fresh buckets and the per-IP rate
   limiter is the only ceiling. See the accepted risks in
   `packages/proxy/README.md`.

Explicitly not doing: remote MCP or agentic vision enrichment, new Markdown
sections, a hosted composition layer. Those were considered and rejected; the
bet is deterministic extraction depth.

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
- A pre-commit hook (`.githooks/pre-commit`, wired via `core.hooksPath`) rejects
  known secret patterns.
- Update `CHANGELOG.md` alongside behavior changes and the JSON Schema
  alongside contract changes, in the same commit. `CHANGELOG.md` is the only
  place shipped work is described; do not mirror it into this file.
- Dependabot raises grouped npm updates weekly and GitHub Actions updates
  monthly.
- Dead code hides behind its own tests here. Judge whether plugin code is live
  by reachability from `main.ts` and `ui/ui-vnext.ts`, not by whether tests
  reference it.

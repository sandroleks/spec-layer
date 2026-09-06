# Website review and documentation plan

**Date:** 2026-09-06
**Status:** Review complete. Plan proposed, decisions pending (section 8).
**Reads with:** `apps/landing/README.md`, `docs/reviews/2026-09-05-major-review.md`
(findings M1, M3, M7), `docs/strategy/2026-09-02-design-conformance-pivot.md`,
`docs/plugin-voice-and-copy.md`.

---

## 1. Summary

The landing site at `spec-layer.com` still describes the product as it was in
July 2026: a Figma plugin that draws spec frames and drafts prose with AI. The
page has one screen of features, a pricing block, four FAQ entries, and four
policy pages. Nothing on it mentions Foundation Context v5, Component Context
v5, the DTCG export, the published JSON schemas, Publish and pull, the
`spec-layer` CLI, or drift detection by content hash. The README at the repo
root is more current than the website.

There is no documentation section at all. A designer who installs the plugin
has the Community listing and the plugin's own copy. A developer who is handed
a `spec-layer setup` command has the CLI README on GitHub and nothing else.

The deployment is also behind the repository. The custom domain serves the
committed `index.html`, but the two v5 schema URLs the plugin writes into every
artifact do not serve the committed schemas: the component schema URL returns
the landing page's HTML, and the foundation schema URL returns an older
revision. Section 3 has the evidence. This is a release blocker under the
landing README's own rule and predates any website rebuild.

This document records what is live today, what is wrong or stale, what the
rebuilt site needs, and the decisions that must be made before copy hardens.
It does not change any file under `apps/landing/`.

## 2. What is live today

### 2.1 Pages and structure

| URL | Content | Last change | State |
|---|---|---|---|
| `/` (`index.html`) | Hero, gallery of three screenshots, six features, pricing, FAQ, footer | 2026-08-28 | Stale copy, see 2.3 |
| `/terms.html` | Terms of Service | 2026-08-28 | Current for the sold product; needs Publish and pull and CLI wording |
| `/privacy.html` | Privacy Policy | 2026-08-28 | Current for AI writing; silent on published library bundles and pull keys |
| `/security.html` | Responsible disclosure | 2026-08-28 | Current; scope should name the library store |
| `/refund.html` | 30-day refund | 2026-07-22 | Current |
| `/schemas/foundation-context/v5.json` | Foundation Context v5 schema | committed 2026-09-03 | Live copy is older than committed, see 3.2 |
| `/schemas/component-context/v5.json` | Component Context v5 schema | committed 2026-09-03 | Live URL serves HTML, see 3.2 |

One static folder, no build step, inline CSS, two vendored scripts
(`lenis.min.js`, `motion.js`). Deployed with `wrangler pages deploy` to the
`speclayer-landing` Pages project; `spec-layer.com` is attached as the custom
domain. There is no `_headers`, `_redirects`, or `404.html`, so unknown paths
fall back to `index.html` with HTTP 200 (`/docs` does this today). A docs site
will need a real 404 or every broken link will look like a page.

### 2.2 Assets

Referenced by `index.html`: `logo.svg`, `gallery-component-docs.png`,
`gallery-foundations.png`, `gallery-library-updates.png`, `lenis.min.js`,
`motion.js`.

Committed but referenced by nothing: `1.png`, `2.png`, `3.png`, `4.png`,
`demo.mp4` (4.4 MB), `demo-poster.jpg`. About 5.8 MB of dead weight uploaded
on every deploy. Delete or move to release assets.

The three gallery images are marketing composites (a plugin panel over a
generated frame with a headline). They show the plugin's vNext shell and are
visually current, but the headlines are the documentation pitch ("Build
design-system docs in seconds", "Turn tokens into documentation", "Keep your
docs from going stale"). None shows Copy for AI, the DTCG clipboard, the
Publish screen, or a terminal running `spec-layer pull`.

### 2.3 Copy audit of `index.html`

Read against the repo on 2026-09-06.

| Element | Says | Problem |
|---|---|---|
| `<title>`, descriptor | "Auto Documentation & Specs" | Review finding M7: the product is a context and contract exporter with docs as one output. The Community listing update is the moment to rename; the site should not rename first and disagree with the listing. |
| Tagline | "Turns your components into spec and guideline frames ... AI-written usage docs in one click." | Leads with AI prose, which the strategy notes and the review both call a commodity. Says nothing about determinism or the artifact. |
| Features grid | Measurements, States matrix, Anatomy, Tokens and theming, Usage docs drafted by AI, Library | Missing: Foundations tab, Copy for AI, DTCG export, Publish and pull, CLI, published schemas, drift by content hash. Five of six cells describe the component canvas frame. |
| Free plan | "Every spec feature, free forever", "On-canvas documentation and Copy for AI", "10 AI generations a month, 20 in your first month" | Accurate as far as it goes. |
| Pro plan | "No fixed monthly AI cap", "Priority support" | Omits the one Pro-only capability that matters: publishing up to 10 libraries for `spec-layer pull`. The README states it; the site does not. Finding M1. |
| FAQ, license | "open License, paste the key" | Correct for the current UI. |
| FAQ, generation | Idempotency cache, failed calls do not count, deterministic features free | Accurate. Good copy to keep. |
| Support and refund email | `oleksandr.kurchev@gmail.com` | Consistent across all five pages. Cloudflare rewrites it to an obfuscated link on the custom domain, which is the only difference between live and committed HTML. |
| Footer | Figma, Manage subscription, four policies, Support | No link to documentation, the CLI on npm, the GitHub repository, or the schemas. |
| Meta | No Open Graph or Twitter card tags, no canonical URL, no sitemap | Shared links render without a preview image. |

Voice: the copy already follows `docs/plugin-voice-and-copy.md` (sentence
case, no em dashes, no hype words). Keep that.

### 2.4 Policy pages against current behaviour

- **Terms** describes "a Figma plugin that turns components into specification
  and guideline frames" and a Pro tier that "removes the fixed monthly AI cap".
  It does not mention publishing a library, storing a bundle on the proxy, pull
  keys, or the CLI as a distributed piece of software under the same terms.
- **Privacy** is accurate for AI writing and license validation. It does not
  disclose that a published library bundle (component and token facts, names,
  descriptions) is stored on Cloudflare KV under the license identity until
  overwritten, or that pull keys are stored as SHA-256 digests. That is stored
  design-system content and needs a paragraph and a retention statement.
- **Security** scope covers "the Figma plugin and the backend it talks to" and
  should name the library store and the CLI explicitly.
- **Refund** is fine.

## 3. Deployment findings

Checked 2026-09-06 with `curl` against both hosts.

### 3.1 The page

| Check | Result |
|---|---|
| `speclayer-landing.pages.dev` `index.html` vs committed | byte-identical |
| `spec-layer.com` `index.html` vs committed | identical apart from Cloudflare email obfuscation markup |
| `spec-layer.com/docs` | HTTP 200, serves `index.html` (no 404 configured) |

### 3.2 The schemas (release blocker)

| URL | Result |
|---|---|
| `spec-layer.com/schemas/foundation-context/v5.json` | HTTP 200, `application/json`, `$id` correct, but the body differs from the committed file: no `code_syntax`, no `5.1.0` constant. This is the pre-2026-09-03 schema. |
| `spec-layer.com/schemas/component-context/v5.json` | HTTP 200, `text/html`. The body is the landing page. The file is absent from the current deployment, and the fallback to `index.html` masks the missing file as a success. |
| Same two URLs on `speclayer-landing.pages.dev` | Same results, so this is the deployment, not the custom domain. |
| `apps/landing/schemas/**` vs `packages/extractor/src/v5/schema/*.json` | byte-identical, so the repository is right and the deploy is stale. |

Every Component Context v5 artifact the plugin copies today carries a
`$schema` URL that resolves to HTML. The landing README already states that
"any DNS, HTTP status, `$id`, or live-versus-committed parity failure is a
release blocker". The fix is one `wrangler pages deploy` of the current
`apps/landing/`, then the three-step verification in the README. It should
happen before, and independently of, any redesign. A `404.html` should ship
with it so this class of failure returns 404 next time.

### 3.3 Versions the site must agree with

| Thing | Version | Where |
|---|---|---|
| Plugin (`packages/plugin/package.json`) | 5.0.0 | Not yet republished to the Community; the listing update is open item 5 in `CLAUDE.md` |
| CLI on npm (`spec-layer`) | 0.4.0, published 2026-09-05 | `dist-tags.latest`, matches the repo |
| Schemas | 5.1.0 | Committed, not live |

The website can describe CLI 0.4.0 today. It must not describe `code_syntax`
in pulled sidecars as available until the plugin republishes with 5.1.0.

## 4. Working practice while another agent owns `library-semantic-diff`

Do not switch branches in the shared checkout and do not commit there. The
other session has that working directory. Use a git worktree: a second
checkout of the same repository in its own directory, on its own branch,
sharing the same `.git`. Both sessions then commit independently, and neither
can see the other's uncommitted files.

This review was written that way:

```text
.claude/worktrees/website-rebuild   branch worktree-website-rebuild, based on origin/main (19a2825)
```

`.claude/` is gitignored, so the worktree directory cannot leak into a commit.
Rules that keep the two streams apart:

- Website work touches `apps/landing/**`, `docs/**`, and `CHANGELOG.md` only.
  The semantic-diff branch touches `packages/**`. Overlap is limited to
  `CHANGELOG.md` and `CLAUDE.md`, which merge cleanly when each side adds its
  own lines.
- Rebase the website branch on `main` after the other branch merges, not the
  other way round.
- Open a pull request from the worktree branch rather than merging locally, so
  CI runs `npm run check:ci` on the merge result.
- When the worktree is done, remove it with `git worktree remove` (or let the
  session's exit prompt do it). The branch survives removal.

## 5. What the site has to describe: the product as shipped on 2026-09-06

Inventoried from `main.ts`, `ui-vnext.ts`, the CLI, the proxy, and the v5
specs. Everything here is reachable in the current build. Version facts:
plugin `5.0.0` (not yet republished), CLI `0.4.0` (on npm), schemas `5.1.0`
(committed, not yet served).

### 5.1 Designer surface (the plugin)

Five rail destinations: **Generate component docs**, **Generate foundation
docs**, **Library**, **Settings**, **License**, plus a Cmd/Ctrl+K search and a
**Publish for developers** sub-screen under Library.

| Flow | Precondition | Produces | Tier |
|---|---|---|---|
| Create component docs | A component or component set selected | A Section named `<Name>: Documentation` beside the source, replaced in place on re-run. Sections chosen from Usage, Specifications, Accessibility groups. | Free; AI-labelled sections spend one AI use when the switch is on |
| Create foundation docs | Collections or Text styles ticked | One `Foundations: <title>` Section per unit; large collections split by top-level group; modes capped at four columns | Free; group descriptions spend one AI use when the selection has colour variables |
| Library | Connected docs exist in the file | Statuses In sync, Update available, Rebuild needed, Manually edited, Source missing, Check unavailable; Update rebuilds generated sections and keeps hand-written text; Detach; Remove | Free |
| Copy for AI, component | Component selected, or a Library row | Component Context v5 `ai` profile as YAML, with the token dependency slice embedded | Free |
| Copy for AI, foundation | Foundations read | A compact DTCG resolver document (Format Module 2025.10) with a `com.spec-layer` extension carrying the content hash and a report of what DTCG cannot express | Free |
| Publish for developers | Pro license, at least one connected component doc | Bundle stored on the proxy; first publish returns the only copy of the pull key; a setup command to hand to developers; Rotate key | Pro |
| Settings | none | Four presets plus custom colours, fonts, and a logo on every generated frame | Free |
| License | none | Paste a key, Activate, Remove key; free meter "N of M free uses left" | n/a |

Quotas and licensing, from the proxy constants: 20 AI uses in the first 30
days, then 10 per calendar month; Pro has no fixed cap and a fair-use review
flag at 1000 a month; 10 requests a minute for everyone; a use counts only on
a successful response and an identical retry within 24 hours is served from
cache. Licensing is a key, not an account.

Things the UI already says it cannot do, which the docs should repeat rather
than hide: itemised drift detail ("A detailed comparison isn't available"),
more than four mode columns, more than four row values in a states or
variants matrix, fonts Figma does not list, clipboard writes the sandbox
blocks (a manual copy modal exists for that), a publish with any unreadable
source (nothing partial is published).

Two things exist in code but must not be documented: the contrast matrix
(hard-disabled) and the Reconnect menu item (never shown).

### 5.2 Developer surface (the CLI and proxy)

Six commands: `setup`, `init`, `pull`, `status`, `list`, `show`. The setup
command the plugin hands over is:

```bash
npx spec-layer setup --id <libraryId> --key <pullKey>
```

It writes `speclayer.json` (committed), stores the key in
`speclayer.local.json` at mode 0600 after confirming git ignores it, and pulls.
Pull writes, by default under `.speclayer/`: `bundle.json`, `manifest.json`,
a `tokens/` directory (one DTCG file per collection and mode, style files, a
`resolver.json`, a `spec-layer.meta.json` sidecar, a `report.json`), and one
YAML per component under `ai/components/`. Exit codes 0, 1, and 2 (`status`
behind). Pulling needs a key only; publishing needs Pro.

The DTCG output has a committed Style Dictionary 5.5.2 gate and one recorded
live run (271 CSS variables from a real library on 2026-09-03). Booleans,
strings, `%`/`em`/`deg` dimensions, unresolved library aliases, and px line
heights are omitted from the token tree and written to the report, never
approximated.

Proxy routes the docs may name: `POST /v1/prose`, `GET /v1/quota`,
`POST /v1/license/activate`, `POST /v1/license/deactivate`,
`POST /v1/libraries`, `GET /v1/libraries/:id`,
`POST /v1/libraries/:id/rotate`. Stored data: license verdict cache (30-day
TTL), hashed identities, quota counters, AI responses for 24 hours, and
published bundles with no expiry. Prompts, images, prose, raw license keys,
and raw pull keys are never stored or logged.

### 5.3 The proof material (what "prove our approach" can rest on)

- **The deterministic split.** Extraction, rendering, drift, Copy for AI, and
  DTCG use no model. Only optional prose does. Stated in `CLAUDE.md`, the
  README, and the September review.
- **Never fabricate.** Enforced in colour parsing (reject, do not pad), units
  (from scopes or `null`), alias resolution (record every hop, report cycles),
  DTCG (omit and report), the publish screen (no command box until both halves
  are known), and dozens of named tests. The adversarial review of 2026-09-05
  found "no fabricated values anywhere".
- **Three hashes, three questions.** `specContentHash` and
  `foundationContentHash` drive the canvas badges and cover exactly what a
  frame draws. `semanticContentHash` identifies an exported artifact and
  covers `completeness`, `collections`, `tokens`, `styles` only. One honest
  limit: the two canvas hashes still sort with `localeCompare` and are
  locale-dependent by deliberate choice until the next `EXTRACTOR_VERSION`.
- **Published schemas.** Foundation and Component Context 5.1.0, byte-identical
  between extractor and landing, each validated by a two-level validator (shape,
  then referential replay of the alias policy).
- **24 diagnostic codes** with a stated severity policy: error means a value is
  missing, wrong, or would be fabricated; warning means present but a decision
  is needed; info means metadata is absent and nothing depends on it. The spec
  table lists 20; the code lists 24; publish the code's list.
- **Grading status, stated honestly.** Criteria 6, 7a, 8, 12 graded on a
  publishable synthetic fixture. Criteria 3, 10, 11 pass a synthetic golden
  only. Criteria 1, 2, 4, 5, 7b passed a manual review of an uncommitted real
  artifact. Criterion 9 cannot be graded from the Plugin API.
- **Publishable examples**, all synthetic and labelled so in-repo:
  `synthetic-foundation-direct-v5.yaml` (a full Foundation artifact),
  `button-component-ai-v5.yaml` (a component copy for an agent), and the
  `synthetic-foundation-dtcg/` directory including `report.json`, which is the
  single best exhibit of omit-and-report. The Material-3-shaped `button.json`
  fixtures carry no provenance note and should be labelled hand-authored if
  shown.

### 5.4 Claims the site must not make

1. That `spec-layer check`, conformance testing, or `validate`/`normalize`/
   `diff` exist. The first is a deferred proposal; the others are unbuilt.
2. That a real design system has been graded in-repo.
3. That the plugin build is verified; the manual Figma matrix has not run.
4. That `code_syntax` appears in pulled sidecars today; it needs the plugin
   republish.
5. That hashing is fully deterministic without the canvas-hash qualification.
6. A test count. Three in-repo numbers disagree; re-measure before quoting.
7. That the schema URLs are live and current, until section 3.2 is fixed.

## 6. The documentation site

### 6.1 Audiences and jobs

| Audience | Arrives from | Needs |
|---|---|---|
| Designer evaluating | Community listing, search | What it makes, what it costs, what it sends where, in five minutes |
| Designer using | The plugin's world icon and Contact support button (both land on `/`) | Task pages per screen, honest limits, license help |
| Developer handed a setup command | A chat message with `npx spec-layer setup …` | What the command does to their repo, what pull writes, how to feed Style Dictionary, how to give the YAML to a coding agent, key security |
| Design system engineer evaluating the approach | README, npm, a colleague | The contracts, the hashes, the no-fabrication evidence, the schemas, what is graded and what is not |
| Compliance reviewer | Procurement | Privacy, data stored, retention, sub-processors, security disclosure |

### 6.2 Proposed information architecture

Slugs under `/docs/`. Each page names the in-repo source it lifts from so
the writing is transcription plus editing, not invention.

**Start**
- `docs/` Overview: the three outputs (canvas, clipboard, repository), the
  deterministic split, one diagram. Source: `README.md`, `ARCHITECTURE.md`
  data-flow block.
- `docs/quickstart-designer` Install, select a component, Create docs, read
  the frame. Source: `TESTING.md` rows, screen labels from section 5.1.
- `docs/quickstart-developer` Run the setup command, read what appeared.
  Source: `packages/cli/README.md` lines 11 to 29.

**Designer guide** (one page per screen, task-ordered)
- `docs/component-docs` Sections and groups, measurement lenses, the variants
  picker, what the Section contains, replace-in-place behaviour.
- `docs/foundation-docs` Collections and text styles, group splitting, the
  four-mode cap, aliases into libraries shown without values.
- `docs/library` The six statuses, Refresh, Update, the two-lane model for
  hand edits, Detach vs Remove, Rebuild needed.
- `docs/copy-for-ai` What lands on the clipboard for a component and for a
  foundation, size notice, how to paste it into an agent conversation.
- `docs/ai-writing` Exactly what is sent (summary plus a rendered PNG),
  quota, fallback to placeholders, the foundation group-description call.
- `docs/theming` Presets, custom colours and fonts, logo capture and limits.
- `docs/publish` Pro requirement, what a bundle contains, the pull key
  appears once, rotation, second-device behaviour, the "gone" case.
- `docs/license` Buy, paste, Activate; device slots; expired and unreachable
  states; Remove key. Source: `screens/license.ts` messages.
- `docs/limits` The honest list from section 5.1 in one place.

**Developer guide**
- `docs/cli` Commands, flags, selection semantics, exit codes, `SPEC_LAYER_KEY`
  and `SPEC_LAYER_API`. Source: `packages/cli/README.md`, `cli.ts` USAGE.
- `docs/pull-output` The `.speclayer/` tree, `manifest.json`, freshness and
  `If-None-Match`, partial pulls.
- `docs/tokens` DTCG files, `resolver.json`, `values: standard | legacy`,
  units overrides, `report.json`, Style Dictionary and Tokens Studio notes.
  Source: `packages/cli/README.md` 206 to 228, the 2026-09-03 DTCG design.
- `docs/component-context` Reading the component YAML, bindings and `when`,
  the dependency slice, how a coding agent should use it. Source:
  `docs/specs/component-context-v5.md`, `button-component-ai-v5.yaml`.
- `docs/pull-key-security` Where the key lives, the gitignore gate and its
  refusals, rotation. Source: CLI README 124 to 167, stored-key design.
- `docs/ci` Running `pull` and `status` in CI with `SPEC_LAYER_KEY`, exit 2.

**How it works** (the proof)
- `docs/deterministic` The split, and the never-fabricate rule with the
  evidence list from section 5.3.
- `docs/drift` Three hashes, what each covers, rendered implies hashed, the
  `selfHash` exception, the canvas-hash locale caveat.
- `docs/foundation-context-v5` Artifact shape, ids and modes, value union,
  alias chains, completeness, validators. Source: `docs/specs/foundation-context-v5.md`.
- `docs/component-context-v5` Shape, join by `(kind, source_id)`, six
  resolution statuses, closure algorithm.
- `docs/diagnostics` The 24 codes, severities, policy, strict mode.
- `docs/dtcg-projection` What maps, what is omitted, sidecar, report codes.
- `docs/schemas` The two permanent URLs, version history, parity rule.
- `docs/status` What is graded and how, what is open. Source:
  `docs/specs/foundation-v5-status.md`. This page is what keeps the site honest
  and it should be dated.

**Reference and support**
- `docs/api` Proxy routes, auth model, rate limits, stored data. Source:
  `packages/proxy/README.md`.
- `docs/changelog` Requires cutting `CHANGELOG.md` into versions first; it
  has everything since 1.0.0 under Unreleased.
- `support` Contact, license problems, refunds, disclosure. This is the
  page the plugin's Contact support button should open.
- The four policy pages, updated per section 2.4.

About 30 pages. Roughly half are transcription from the CLI README, proxy
README, specs, and status document; the designer guide is the part that has
to be written fresh, from the screen inventory.

### 6.3 Screenshots and examples

New captures needed: the component screen with Copy for AI in the footer,
Foundations with a row copy button, Library with an expanded row and the
Update dialog, the Publish screen after a first publish, License with the
meter, Settings custom theme, and a terminal running `setup` then `pull`.
Capture after the manual matrix run so the screenshots show a verified
build. Example files: the three synthetic artifacts in 5.3, rendered with
syntax highlighting and downloadable, plus a Style Dictionary config snippet
that builds the `tokens/` directory.

## 7. Landing page rewrite

Structure, not copy. Copy follows `docs/plugin-voice-and-copy.md`.

1. **Hero.** The claim is the deterministic split and the three outputs.
   Working line: "Design system facts from Figma, for your team and for the
   coding agent that builds it. Extraction is deterministic; only optional
   prose uses AI." Buttons: Open in Figma, Read the docs. A third quiet link
   for developers: the setup command.
2. **Three outputs**, replacing the six frame features: canvas
   documentation that knows when it is stale; Copy for AI (component YAML,
   DTCG tokens); Publish and pull into the repository. Each with one
   screenshot and a link into the docs.
3. **How it stays true.** Four short proofs: no fabrication, content hashes,
   published schemas, omit-and-report. Link to `docs/deterministic`.
4. **For developers.** A terminal block: `npx spec-layer setup`, then
   `style-dictionary build`. One sentence on Style Dictionary and Tokens Studio
   compatibility, with the `legacy` values note.
5. **Pricing.** Same two cards. Pro adds "Publish up to 10 libraries for the
   CLI" as the first bullet. Keep the fair-use paragraph and the generation
   definition; they are good.
6. **FAQ.** Keep the four. Add: what is sent to the AI and when; what is
   stored when I publish and for how long; does it work without AI (yes,
   entirely); does it work with Style Dictionary and Tokens Studio; is the
   Figma file key stored (no, the plugin cannot read it).
7. **Footer.** Add Docs, npm, GitHub, Schemas, Support. Keep the policies.
8. **Head.** Open Graph and Twitter card tags with a real image, canonical
   URL, `sitemap.xml`, `robots.txt`, and a `404.html`.
9. **Assets.** Delete the six unreferenced files. Re-shoot the three gallery
   composites so at least one shows the clipboard or the terminal.

The descriptor "Auto Documentation & Specs" and the manifest name stay until
the Community listing changes, then both move together (review finding M7).

## 8. Decisions needed before copy hardens

1. **Which product does the site sell.** The conformance pivot
   (`docs/strategy/2026-09-02-design-conformance-pivot.md`) would make the
   plugin free, retire Pro, and sell a CI check to teams. It is a proposal
   with the decision deferred, and the review lists deciding it as item 18.
   The docs site is unaffected either way, since it documents shipped
   behaviour. The landing pricing block and the hero are affected. Recommended:
   build the docs now against shipped behaviour, write the landing around the
   three outputs so the pivot changes one section, and do not mention
   `spec-layer check`.
2. **Name and descriptor.** Rename with the Community listing or not at all.
3. **Documentation stack.** Section 9.
4. **Support routing.** The plugin's Contact support button and the world icon
   both open `/`. Point them at `/support` in the next plugin release, and give
   `/` a visible Docs link in the meantime.
5. **Support email.** All five pages use a personal Gmail address. The design
   spec used a domain address. Pick one; a domain address is the usual
   choice for a paid product.
6. **Real examples.** Showing a real artifact needs the approval described in
   `foundation-v5-status.md` (ids, names, descriptions, diagnostics). Until
   then the synthetic fixtures carry the examples.
7. **Privacy policy scope.** The published policy says the proxy does not
   persist token values; published bundles are persisted permanently. This is
   a correction to a live legal page and should ship with the schema redeploy,
   not wait for the redesign.

## 9. Delivery approach

Three ways to add thirty pages to a folder of hand-written HTML.

**A. Keep hand-writing HTML.** No tooling, matches the current README. Thirty
pages of duplicated nav, no search, no sidebar state, and every shared change
touches every file. Rejected for anything past five pages.

**B. A static site generator for `/docs`, landing untouched.** Astro Starlight
or VitePress in a new `apps/docs` workspace, Markdown sources, built in CI,
output copied next to the landing files before `wrangler pages deploy`.
Sidebar, search, dark mode, and code highlighting come free. Cost: one
toolchain dependency in a repo that deliberately dropped Next and React in
August, and one more build in `npm run check`. Markdown pages can be
single-sourced: a build step copies `packages/cli/README.md` and the two v5
specs into the content directory so the docs cannot drift from the repo
documents. Recommended.

**C. Rebuild everything in the generator.** The landing becomes an Astro page.
Cleaner long-term, but it rewrites working marketing HTML and its motion
scripts for no user-visible gain, and it couples the landing redeploy to the
docs build. Defer; revisit once the docs exist.

Whichever option, three gates join the release checklist: the live schema
URLs return the committed bytes; every `/docs/` link in the plugin and README
resolves with 200; `404.html` returns 404 for a missing path. The NUL-byte scan
should widen to `apps/` once Markdown lives there.

## 10. Sequence

1. **Now, one deploy.** Redeploy `apps/landing/` as committed, add
   `404.html`, verify both schema URLs per the landing README, update the
   privacy policy for published bundles, delete the unreferenced assets.
   Independent of the redesign and of the other agent's branch.
2. **Docs scaffold.** Choose the stack (section 9), scaffold `apps/docs`,
   wire the build and deploy, publish the Overview, both quickstarts, the CLI
   page, and the Tokens page from existing README text. This gets developers a
   URL within days.
3. **Designer guide.** Nine pages from the screen inventory. Screenshots
   after the manual Figma matrix run, which is also the standing release
   blocker for the plugin.
4. **How it works.** Eight pages from the specs, status document, and
   diagnostics source, plus the example files.
5. **Landing rewrite.** After decision 1 and the listing rename, with the
   new screenshots.
6. **Plugin follow-ups** on a plugin branch: Contact support and the world
   icon point at `/support` and `/docs`; the License screen links the docs.

## Appendix A. Repository text that disagrees with the shipped product

Found while inventorying; each should be fixed before it is lifted into
docs. None is under `apps/landing/`.

| Where | Says | Reality |
|---|---|---|
| `packages/plugin/TESTING.md` | Section named `<Name>: Guidelines`; a Settings Reset control | `<Name>: Documentation`; no Reset exists |
| `docs/plugin-voice-and-copy.md` | Component footer secondary is `Download`; "Upgrade for $8/mo" | `Copy for AI`; button says "Upgrade to Pro", price is $7.99 |
| `ARCHITECTURE.md` CLI section | Five commands; the key is never written to disk; old `SPEC_LAYER_KEY=… pull` setup | Six commands; `setup` stores the key at mode 0600; `npx spec-layer setup --id … --key …` |
| `README.md` | `show foundation` prints AI YAML | Prints the DTCG document |
| `packages/cli/package.json` | repository points at `SamsonHD/spec-layer` | The remote is `sandroleks/spec-layer` |
| `CLAUDE.md` open item 2 | npm publish of CLI 0.4.0 pending | Registry shows 0.4.0 as latest, 2026-09-05 |
| `CLAUDE.md` layout table | Omits `packages/cli/` | The CLI is a fourth workspace |
| `docs/specs/foundation-context-v5.md` section 14.1 | 20 diagnostic codes | `diagnostics.ts` defines 24 |
| `packages/proxy/README.md` | No `deactivate` route | `POST /v1/license/deactivate` is implemented |
| `CHANGELOG.md` | Last cut version is 1.0.0 | Plugin is 5.0.0; everything since is Unreleased |
| Test counts | 1720, 2136, and 2098 in three places | Re-measure |

# Design conformance: from documentation to a gate

**Date:** 2026-09-02
**Status:** Proposal, decision deferred. Not committed direction. Supersedes the open question at the end of `2026-06-22-positioning-and-pivot.md` with a concrete answer and a change list.
**Reads with:** `ARCHITECTURE.md`, `docs/specs/component-context-v5.md`, `docs/specs/foundation-v5-status.md`, `packages/cli/README.md`.

---

## 1. One paragraph

Spec Layer today sells documentation to designers: canvas frames, AI prose, and a Pro tier at $7.99 a month that gates prose and publishing. The asset the code has actually become is a machine-checkable contract: a validated v5 artifact that states, for every component, every variant and state, every part, every property, and the exact token bound to it, with the resolved value per mode. Read as a spec, that artifact is documentation. Read as assertions, it is a test suite. This proposal turns it into one. The Figma plugin becomes free and publishes the contract. A paid CLI command, `spec-layer check`, runs in CI, renders the implementation, and fails the pull request when code disagrees with the design system, naming the part, the property, and the token. The buyer changes from an individual designer to a design system or frontend platform team, which is where tooling budget lives.

## 2. Why the current model does not get paid

Pro gates two things, and both are the wrong things.

**AI prose.** Every coding agent writes usage prose from the YAML for free. The June positioning note already concluded the prose is not the asset. Charging for it competes with a commodity.

**Publishing.** Publishing is what puts the contract in a repository, which is what creates the engineering-side demand for everything else. Every designer stopped at the Pro wall is an engineering team that never runs `spec-layer pull`. Gating the on-ramp starves the funnel.

**The buyer.** A designer paying from their own card, at a price point too small to be a team decision and too large to be an impulse for a plugin. Designers rarely hold tooling budget. Design system teams do, and they expense line items in the tens to low hundreds per month without a procurement conversation.

Look at who gets paid along this pipeline. Chromatic is paid because it fails a pull request when a component changes unintentionally. Tokens Studio is paid because tokens reach code without hand copying. Figma Dev Mode is paid per seat for inspect and Code Connect. Nobody is paid for "does the implementation match what the design system says," because nobody else can compute it. Figma does not run your code. Chromatic does not read Figma semantics. Tokens Studio stops at tokens. Spec Layer already computes the design half and has a delivery pipe into the repo. The code half is the missing signature on the contract.

## 3. The concept: design conformance testing

### 3.1 What it is

A conformance check takes two inputs and produces a report:

1. **The contract.** The Component Context v5 artifact for one component, pulled into the repo by the CLI. It already enumerates variants, states, anatomy paths, default-variant layout, every property binding with the condition it applies under, and a dependency slice that resolves each bound token to a concrete value per mode.
2. **The implementation.** The same component rendered by the team's own code, one render per variant and state, with computed styles read from the DOM.

The report says, for each assertion, whether the implementation matches the contract:

```text
Button / Style=Filled / State=Hovered
  Container  fill           expected md.sys.color.primary-hover   #5b438f   got #5b438f   ok
  Container  border-radius  expected md.sys.shape.corner.full     999px     got 8px       FAIL
  Container  padding        expected 10 24 10 24                             got 10 16     FAIL
Button / Style=Outlined / State=Enabled
  Container  border         expected md.sys.color.outline         #79747e   unmapped (no code_syntax on token)
  label      fill           expected md.sys.color.primary         #6750a4   got #6750a4   ok

2 failed, 3 passed, 1 unmapped. Exit 2.
```

Nothing in this uses a model. It is the same deterministic extraction the plugin already performs, consumed as expectations instead of read as prose. That keeps the product's core claim intact and extends it to the code side.

### 3.2 What it is not

- **Not pixel diffing.** Chromatic answers "did it change since yesterday." Conformance answers "does it match the design system," which catches a component that was wrong on day one and has never changed.
- **Not design-to-code generation.** Nothing is generated. The team's code is rendered and measured.
- **Not a hosted portal, remote MCP, or vision enrichment.** Those were rejected on 2026-06-10 and the reasoning holds. The check runs in the team's CI against files in the team's repo.
- **Not inference.** The check never guesses which DOM element is which Figma part, and never guesses which code identifier a token compiles to. Both come from declared sources, and anything undeclared is reported as unmapped. This is the never-fabricate invariant applied to the code side.

### 3.3 Why 2026 makes this sharper

Coding agents now write most new component code. An agent given the v5 YAML has context. An agent given `spec-layer check --component Button` has an oracle: a verifiable pass or fail it can iterate against until it converges. Agents are dramatically better with an oracle than with a description. Nobody sells a machine oracle for "this UI is on system." That is the sentence for the landing page: the design system becomes a test suite that agents run until it passes.

## 4. What the code already provides

Every column of the assertion table has a source in the repo today. The gaps are listed in section 6.

| Assertion needs | Already provided by |
|---|---|
| The set of renders to perform | `api.variants`, `api.states`, `api.booleans` in Component Context v5; `statesMatrix.ts` decides which axis is state-like |
| Which part is being measured | `anatomy[].path`, exact and stable |
| Which property and under what condition | `references.bindings[]` with `path`, `property`, `when` |
| The expected token | `bindings[].source_id` joined to `references.used` on `(kind, source_id)` |
| The expected concrete value per mode | The embedded Foundation dependency slice, alias chains already resolved, values keyed by mode |
| Layout expectations | `layout.items[].values`, currently radius and gap only |
| Where Figma itself is off-system | `unbound[]`, the hardcoded values list, already the Figma-side half of the symmetric check |
| The delivery path into the repo | plugin publish, proxy blob store, `spec-layer pull` writing `bundle.json` with the canonical artifacts |
| Freshness and exit-code conventions | `spec-layer status` and its exit 2 |
| Identity to bill against | proxy license validation and hashed identities |

None of these were built for testing. All of them are what testing needs.

## 5. Product shape

**Free.** The Figma plugin in full: component docs, Foundation docs, Library, drift badges, Copy for AI, and publishing a library. The free AI generation allowance stays as it is. This is the distribution channel and it needs no wall in front of it.

**Paid.** `spec-layer check` in CI, licensed per repository or per team rather than per designer. A GitHub Action wraps it. Pricing belongs in the range design system tooling already occupies and is a decision to make with the first three customers, not in this document. Two candidate shapes: a flat team price per month, or a per-repository price with a small-team floor.

**Buyer.** The person who owns the design system's implementation: a design system engineer, a frontend platform lead, or the one engineer on a product team who keeps getting the "this does not look like Figma" message.

**The plugin's Pro tier.** Retire it as a paid product. Individual heavy AI use can stay under the existing fair-use policy on the free tier, or move under the team license. Existing subscribers are grandfathered or migrated to the team license at no charge for a period. Lemon Squeezy handles the product change; the proxy already keys everything on license identity, so a team product is a new Lemon Squeezy product and a tier name, not a new licensing system.

**The canvas frames.** They stay. They are the free on-ramp designers install for, and they stop receiving feature investment beyond fixes.

## 6. Changes required

Ordered by package. Each item names the invariant it has to respect.

### 6.1 Extractor

**Carry `code_syntax` into Foundation Context v5 tokens.** Figma variables expose a per-platform code syntax. The plugin reads it at `main.ts`, `foundation.ts` keeps it, the v4 brief emits it, and v5 drops it: no reference exists under `src/v5` or in either published schema. Add an optional `code_syntax` object keyed by platform (`WEB`, `ANDROID`, `iOS`) to the `token` definition. It belongs inside the semantic payload because it changes what an implementer should write. This moves `semanticContentHash` for every artifact and is a schema minor bump to `5.1.0`. It does not touch `specContentHash` or `foundationContentHash`, and `EXTRACTOR_VERSION` stays `'2'` because canvas output is unchanged. Update both schema copies byte-identically and the direct golden.

**Promote layout facts to structured values.** `LayoutValues` carries only `radius` and `gap`. Padding is in the summary string. Add `padding` as four numbers, plus `width`, `height`, and sizing mode where Figma states them. These already render on canvas via the measure section, so this is a projection change, not new extraction. Confirm whether they enter the canvas hash projection today before deciding whether the change is hash-neutral; if they do not, adding them to `layout.items[].values` moves only the v5 semantic hash.

**Add a `conformance` projection.** A pure function from a validated Component Context v5 artifact to an ordered list of assertions: `{ render: {variant, state, booleans}, path, property, expected: { token_id, token_name, code_syntax, value_by_mode }, layout?: {...} }`. It lives beside `aiContext.ts`, is downstream of validation, never participates in a hash, and never weakens the canonical schema. It uses `compareCodeUnits` for every ordering.

**Optional: a DTCG projection.** The W3C Design Tokens Community Group format is what Style Dictionary and Tokens Studio consume. The Foundation artifact is a superset of it, so this is a second projection and a natural first adapter for the token-level check. Not required for phase 1.

### 6.2 Library bundle

Bump `LIBRARY_BUNDLE_VERSION` to `1.1.0` and add `conformance` beside `ai` on each component entry, computed at publish time by the plugin through the extractor projection. This preserves the transport invariant: the plugin derives, the proxy stores verbatim, the CLI reads. The CLI never re-derives v5 output, and the comparison logic that consumes assertions is not derivation. The 1.0.0 reader continues to parse 1.1.0 bundles, since the major is unchanged.

### 6.3 Proxy

**Publishing no longer requires Pro.** `proCaller` in `libraries.ts` becomes an authenticated-caller check that accepts either a license identity or the hashed Figma-user identity the free quota path already uses. Ownership records and `LIBRARY_LIMIT` continue to key on whichever identity published. A free identity gets a lower library cap and a lower `MAX_BUNDLE_BYTES` to blunt abuse.

**Add a check entitlement.** `spec-layer check` verifies a team license before running. The existing `checkLicense` path and KV verdict cache already answer "is this key active," and a `team` tier is a new tier name in the license record. The CLI reads the key from `SPEC_LAYER_LICENSE`, an environment variable, since CI is where it runs. Nothing about the team's code or report is uploaded in phase 1.

**Later: a report blob.** `POST /v1/libraries/:libraryId/report`, authenticated by the same team license, storing the latest check report beside the bundle. The proxy stays a blind store. This is what feeds the Figma badge in section 7, phase 4.

### 6.4 CLI

**New command: `check`.** Inputs, in order of phases:

- Phase 1, tokens only, no DOM. Adapters read the repo's declared token layer: DTCG JSON files and CSS files containing custom properties. Matching is exact string equality between a token's `code_syntax.WEB` and the identifier in code. Reports: token in Figma with no code identifier, code identifier with no Figma token, value differs for a mode, and a token whose Figma-side `unbound` hardcoded value shadows a bound token.
- Phase 3, component level. A Storybook adapter drives Playwright: one render per assertion `render` tuple, mapping variant and state to story args or to a mapping file, applying hover and focus through real interaction, and reading `getComputedStyle` on the element each anatomy path maps to.

**Mapping file: `speclayer.map.json`.** Declares, per component, how anatomy paths map to DOM selectors and how Figma modes map to the code's theme switch, for example a `data-theme` attribute or a class on the root. Also declares the root font size for `rem` comparison. A component with no mapping is reported as unmapped, never guessed. Teams already maintaining Code Connect files can generate a first mapping from them, and that generator is a phase 3 convenience, not a dependency.

**Outputs.** Human text by default, `--json` for machines, `--github` for workflow annotations and a PR comment body. Exit codes: 0 all assertions pass, 1 usage or infrastructure error, 2 one or more assertions failed. Unmapped assertions do not fail the run unless `--strict` is set, so a team can adopt incrementally.

**Selection.** `--component NAME`, repeatable, and `--mode NAME`, both reusing the slug matching and `include` block that `pull` already has.

**The `diff` command.** Already planned in the v5 status document. It becomes part of this work rather than separate tooling: a semantic diff of two artifacts by content hash is what the PR comment prints when the design side moved.

### 6.5 GitHub Action

A composite action `spec-layer/check` that runs `pull`, then `check --github`, and posts or updates one PR comment. Pin the CLI version in the action. This is the thing a team installs, and it is under a day of work once `check` exists.

### 6.6 Plugin

- Remove the Pro requirement from the Library publish flow and update its copy. The copied setup command is unchanged.
- Retire the license screen's Pro purchase path, or repoint it at the team license. Follow `docs/plugin-voice-and-copy.md`; no em dashes.
- Later, phase 4: a fifth Library badge, **Code behind**, read from the report blob. It sits beside In sync, Update available, Manually edited, and Source missing, and links to the failing assertions.

### 6.7 Landing site and licensing

- Rewrite the hero and pricing. The descriptor "Auto Documentation & Specs" goes. The claim becomes the gate: the design system as a test your CI and your coding agent run.
- A team product in Lemon Squeezy. Migration copy for existing Pro subscribers.
- Publish the 5.1.0 schemas and keep the extractor and landing copies byte-identical.

### 6.8 Documentation and gates

- `ARCHITECTURE.md`: a `check` section under the CLI, the bundle 1.1.0 field, the proxy identity change.
- `CLAUDE.md` invariants: add "The check never infers a mapping. Undeclared is unmapped." beside never-fabricate.
- `docs/specs/foundation-context-v5.md` and `component-context-v5.md`: `code_syntax`, structured layout values, the `conformance` projection, schema `5.1.0`.
- `CHANGELOG.md` alongside every behaviour change, per convention.
- `packages/plugin/TESTING.md`: publish rows no longer need Pro.

## 7. Sequence and validation gates

Each phase has a gate that decides whether the next one starts. The expensive part, the DOM adapter, comes after the market answer, not before.

**Phase 0. Ship 5.0.0.** The manual Figma matrix in `TESTING.md` has never been run against a development build. Nothing here matters until it has. This is the cheapest item in the document and the standing blocker.

**Phase 1. Token-level check.** `code_syntax` into v5, the `conformance` projection, bundle 1.1.0, `check` with the DTCG and CSS adapters, the Action. Roughly two weeks. Gate: the check runs green against a synthetic repo and reports a planted drift with the right token name.

**Phase 2. Willingness to pay.** Take phase 1 to three design system teams that publish from Figma and keep tokens in code. Ask them to run it in CI for a month and pay for it. Gate: at least one pays, or one states in writing what would make them pay. If none do, stop. The cost was two weeks and `code_syntax` in v5 was worth shipping anyway.

**Phase 3. Component-level check.** The Storybook and Playwright adapter, the mapping file, hover and focus, mode switching, `rem` handling. Gate: the three teams' real Button and Text field pass or fail for reasons they agree with.

**Phase 4. Close the loop into Figma.** Report blob on the proxy, the Code behind badge in Library. The designer who caused the drift sees it without leaving Figma. This was the highest-leverage item in the June note and it is still unbuilt.

**Phase 5. Adjacent projections.** DTCG export, `diff` in the PR comment, a Code Connect to mapping-file generator.

## 8. Risks and honest limits

**Anatomy to DOM mapping.** This is where every design-to-code product dies. The mitigation is refusing to infer: declared mappings only, unmapped reported as unmapped, and `--strict` as the team's choice. The token-level check needs no mapping at all, which is why it goes first.

**Which mode is the code rendering.** A multi-mode collection has several correct values. The mapping file declares how a mode name maps to the code's theme switch, and the check renders once per declared mode. An undeclared mode is not checked and is listed.

**Units.** Figma states `px`. Code may state `rem`, `em`, or percentages. The mapping file declares the root size, `px` and `rem` compare after conversion, and anything else is reported as not comparable rather than coerced.

**Typography and effects.** A text style becomes several CSS properties and a shorthand. Effects become `box-shadow` lists with ordering. Phase 3 covers fills, borders, radius, padding, and gap first. Typography and effects follow once the simple properties are trusted.

**Interaction states.** Hover, focus, and pressed need real interaction in Playwright, and some component libraries render state through props rather than pseudo-classes. The mapping file allows a state to be declared as either an interaction or an arg.

**The deterministic claim.** Parsing a codebase is where heuristics creep in. The rule is that every input to the check is a declared file or a declared selector, every match is exact, and every miss is reported. If that rule ever bends for convenience, the code side erodes the promise the Figma side keeps.

**Web first.** `code_syntax` carries Android and iOS identifiers and the token-level check can compare them against Compose and Swift token files with adapters. Component-level rendering on those platforms is out of scope for this proposal.

**One maintainer.** The sequence above is designed so that the first two phases are small and each later phase is optional. The largest risk is starting phase 3 before phase 2 has answered.

## 9. Open decisions

1. Pricing shape: flat team, or per repository with a floor. Decide with the first customers.
2. Whether `padding`, `width`, and `height` already enter the canvas hash projection, which decides whether promoting them is hash-neutral for existing documents.
3. Whether free publishing carries a lower library cap and bundle size, and what the numbers are.
4. What happens to current Pro subscribers: grandfather, migrate, or refund.
5. Whether the Action lives in this monorepo or its own repository, since GitHub resolves actions by repository.

## 10. What this stops

- Feature investment in canvas frames beyond fixes.
- Any further work on AI prose beyond keeping it running.
- The Pro tier as a designer-facing product.
- Considering remote MCP, vision enrichment, or a hosted portal. The conclusion from June stands, and this proposal is the alternative it implied.

## 11. The one-line version

Spec Layer knows when Figma drifts from its documentation. It should know when code drifts from Figma. Same hash machinery, second signature, and the buyer who pays for gates.

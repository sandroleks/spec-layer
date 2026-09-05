# Comment Archaeology Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove plan references, self-references, dated notes, stale instructions, and "used to" bug histories from source comments, keeping every invariant explanation.

**Architecture:** Comment-only edits across `packages/*/src`, applied by hand one comment at a time from the list below. A scratch script proves the diff touches nothing but comment lines before the single commit.

**Tech Stack:** TypeScript sources, `git diff`, `npm run check`.

## Global Constraints

- Comment-only: no code, string literals, tests, docs, or generated output change.
- No regex rewriting. Each edit is a hand-written replacement of the comment named.
- Rule 3 (strict): a "used to" history survives only as one sentence, only where deleting it would tempt a reader to reintroduce a bug the code does not make obvious. Hash projection stability, the Figma sandbox realm, `figma.mixed`, NUL separators, removed-node access, and quota billing on cache-key changes qualify. UI copy, layout, label and layout-position stories do not.
- Dates survive only as compatibility contracts. `keyHash` "before September 2026" stays.
- Ordinary English "used to" ("used to pick out") is untouched.
- Out of scope: string literals in `ui/publish.ts`, `ui/harness.ts`; the spec pointer in `v5/dtcg.ts:3`; `viewModel/library.ts:266` ("known so far this pass" is a check pass, not a change).
- One commit: `chore: prune comment archaeology`. No `CHANGELOG.md` entry.

---

### Task 1: Comment-only diff guard

**Files:**
- Create: `/private/tmp/claude-501/-Users-sandrolek-Documents-Projects-Design-System-Docs/b360f192-5a43-4a2c-93fd-4d6b7be0afd9/scratchpad/comment-only-diff.sh` (scratch, not committed)

**Interfaces:**
- Produces: a script that exits 1 and prints any changed line in `git diff -U0 -- packages` that is not a comment line or blank.

- [ ] **Step 1: Write the script**

```bash
#!/bin/sh
# Fails if any added/removed line in the working-tree diff under packages/ is
# not a comment line (//, /*, *, */) or blank.
git diff -U0 -- packages | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | sed -E 's/^[+-]//' \
  | grep -vE '^\s*(//|/\*|\*|\*/)' | grep -vE '^\s*$' && { echo 'NON-COMMENT CHANGE ABOVE'; exit 1; }
echo 'comment-only diff: ok'
```

- [ ] **Step 2: Prove it fails on a code change**

Run: append `const x = 1;` to `packages/extractor/src/version.ts`, run the script, expect `NON-COMMENT CHANGE ABOVE` and exit 1, then `git checkout packages/extractor/src/version.ts`.

- [ ] **Step 3: Prove it passes on a clean tree**

Run the script with no changes. Expected: `comment-only diff: ok`.

---

### Task 2: Extractor comments

**Files:**
- Modify: `packages/extractor/src/hash.ts:62-66`, `:79-83`
- Modify: `packages/extractor/src/tokens.ts:168-169`, `:225-227`, `:270-273`, `:283-286`, `:356-359`, `:576-580`
- Modify: `packages/extractor/src/brief.ts:445-446`, `:583-589`
- Modify: `packages/extractor/src/foundation.ts:1023-1030`
- Modify: `packages/extractor/src/layout.ts:45-49`
- Modify: `packages/extractor/src/prose/client.ts:30-38`, `:50-61`
- Modify: `packages/extractor/src/v5/normalize.ts:409-411`, `:426-432`, `:540-542`, `:548-549`, `:913-916`
- Test: `npm test` (unchanged suite)

- [ ] **Step 1: hash.ts, drop the two task numbers**

Replace `(Task 8 moved the measured number out of the old prose `issue` string and into its own field)` with `(the measured number is its own field, not text inside `issue`)`. Replace `(Task 11 gives validate.ts the structured numbers so it never has to regex-parse that sentence)` with `(validate.ts reads the structured `values`, never the sentence)`.

- [ ] **Step 2: tokens.ts, six comments**

Line 169: end the sentence at `name.` and delete `— vocabulary drift between the two is the defect this task removes`.

Lines 225-227: replace the three-line comment with
```
    // The ref travels through with its identity intact; only the PROPERTY is
    // renamed. Rebuilding `{ property, token }` here would flatten the binding
    // back to a string one stage after it was resolved.
```

Lines 270-273: replace with
```
 * `${kind}|${id}`, not the name. A name is a display string and two different
 * Figma resources can share one; a variable and an effect style both called
 * "Elevation/1" must stay two rules.
```

Lines 283-286: replace with
```
 * A plain word rather than a control-character prefix, and safe because a real
 * refKey ALWAYS contains a `|` and this never does. A control character here is
 * exactly the class of invisible source `npm run check:nul` exists to catch.
```

Lines 356-359: delete the paragraph beginning `This REPLACES `identityByName`` through `Delete that map and its two uses.` and the blank ` *` line before it, closing the docblock after `overwriting is a no-op.`.

Lines 576-580: replace `which is why the old version needed an unspellable NUL to be correct. Field by field, that question does not arise.` with `and only an unspellable separator such as NUL makes that correct. Field by field, the question does not arise.`

- [ ] **Step 3: brief.ts, two comments**

Lines 445-446: replace with
```
  // Variables only. A style name has no entry in any collection, so a lookup
  // for one would come back empty and must not be emitted as `{}`.
```

Lines 583-589: replace the paragraph from `naming `text`/`instanceSwap` explicitly:` to `the same way.` with
```
 * naming `text`/`instanceSwap` explicitly. Naming them would silently drop any
 * fifth `PropKind` from the brief; defining the group by exclusion surfaces it
 * here instead.
```

- [ ] **Step 4: foundation.ts, part numbers**

Lines 1023-1030: replace `It has to be inside unitContent's return or the footer note it drives is rendered but not hashed, which is how adding a group to a large collection used to leave surviving frames with stale part numbers and no "Update available" to say so.` with `It has to be inside unitContent's return, or the footer note it drives is rendered but not hashed, and adding a group to a large collection would renumber surviving frames with no "Update available" to say so.`

- [ ] **Step 5: layout.ts**

Lines 47-49: replace `Hand-rolling a second walk is what the old version did, and a second vocabulary would make validate.ts's join match nothing and kill the geometry rule silently in production instead of fixing it.` with `A second walk would be a second path vocabulary, and validate.ts's join would then match nothing and drop the geometry rule silently.`

- [ ] **Step 6: prose/client.ts, two paragraphs**

Lines 30-38: replace the paragraph starting `DELIBERATELY NOT bumped on 2026-08-21` with
```
 * Not bumped when proseInputHash changed from a deny-list over IntermediateSpec
 * to a hash of the rendered prompt. This constant means "the produced voice
 * changed"; a key derivation change is not that. Such a change voids every
 * existing key and regenerates each draft once, which is the price of a key
 * that never again moves for a reason the model cannot see.
```

Lines 50-61: replace the paragraph starting `It was previously a DENY-list over IntermediateSpec` with
```
 * The shape matters because `draftProse` sends this key to the proxy, which
 * reserves quota against it: a known key returns the stored body free, while
 * an unknown key calls Anthropic and commits a metered generation. Any field in
 * the hash that does not reach the prompt is a billed regeneration for
 * byte-identical prose. A deny-list over IntermediateSpec cannot hold that
 * line, since every new field is billable by default: the file name, the file
 * key, node ids, variant instances, gaps, and path identities all leaked in
 * that way.
```

- [ ] **Step 7: normalize.ts, five decision references**

Line 411: delete ` Decision 4 / Task 3.`

Lines 428-429: replace `Decision 2: `type: number` plus UNIT_METADATA_UNAVAILABLE,` with `The rule: `type: number` plus UNIT_METADATA_UNAVAILABLE,`

Line 540: replace `// Decision 3, step 1: match on` with `// Match on`.

Line 548: replace `// Decision 3, step 3: two or more matches` with `// Two or more matches`.

Lines 913-916: replace `// Decision 8 / the review finding on Task 8: `diagnostics` is sorted here,` with `// `diagnostics` is sorted here,`.

- [ ] **Step 8: Run the guard and the extractor tests**

Run: the Task 1 script, then `npx vitest run packages/extractor`. Expected: `comment-only diff: ok`, all tests pass.

---

### Task 3: Plugin main-thread comments

**Files:**
- Modify: `packages/plugin/src/main.ts:36`, `:190-201`, `:339-350`, `:495-496`, `:509-512`, `:877-882`, `:939-941`, `:1360-1363`
- Modify: `packages/plugin/src/serialize.ts:149-150`, `:158-160`, `:195-199`
- Modify: `packages/plugin/src/foundationFrame.ts:194-200`, `:213-215`
- Modify: `packages/plugin/src/frameKit.ts:42`

- [ ] **Step 1: main.ts**

Line 36: `// User-captured logo (base64 PNG), used by Task 14 to stamp the frame.` becomes `// User-captured logo (base64 PNG), stamped into the frame header.`

Lines 199-201: replace `so a user who suspects staleness has an existing, discoverable way to clear it without this task inventing a second refresh affordance.` with `so a user who suspects staleness has one discoverable way to clear it.`

Lines 339-342: replace `Prefers the new 'brandTheme' key; falls back to a one-time migration from the 1.x two-color 'brandColors' storage. The old key is left in place (harmless, keeps rollback safe).` with `Reads 'brandTheme'; a 1.x install that only has the two-color 'brandColors' key is migrated once. The legacy key is left in place so a rollback still finds it.` Lines 349-350: `// Persist the migrated theme so this branch runs only once; the legacy` `// key stays untouched for rollback.` becomes `// Persist the migrated theme so the migration runs only once.`

Lines 495-496: replace `// Foundation docs have no sourceNodeId and can never match a component` `// lookup; Task 12 gives them their own resolution path.` with `// Foundation docs have no sourceNodeId and resolve by scope in` `// renderFoundation and updateFoundationDoc, never here.`

Lines 509-512: replace the four-line comment with
```
        // A foundation-linked section sharing this name is another doc, same as
        // a mismatched sourceNodeId below: it must not be adopted.
```

Lines 877-882: replace the six-line comment with
```
          // The source's page, and only that: a locator is worth showing only
          // when it says something the row title does not. Falls back to the
          // name when the source node is gone and there is no page to point at.
```

Lines 939-941: replace `(Finding 2: frames are appended one at a time and are never rolled back).` with `(frames are appended one at a time and are never rolled back).`

Lines 1360-1363: replace the four-line comment with
```
        // Foundation docs have no sourceNodeId to rebuild from here; their
        // rebuild path is updateFoundationDoc. Bail with the same "no longer
        // linked" message rather than reading a field that does not exist.
```

- [ ] **Step 2: serialize.ts**

Lines 149-150: replace `// Deduped on the resolved ID, not on the name: two ids resolving to one` `// name are two bindings, which is exactly what this change stops losing.` with `// Deduped on the resolved ID, not on the name: two ids resolving to one` `// name are two bindings.`

Lines 158-160: replace `Those are two different questions` `// and this task stops answering the second by guessing at the first.` with `Those are two different questions,` `// and the second is never answered by guessing from the first.`

Line 197: replace `Mixed reads as "no paint` `// this pass can speak for"` with `Mixed reads as "no paint` `// this read can speak for"`.

- [ ] **Step 3: foundationFrame.ts**

Lines 194-200: replace `or the note is rendered without being covered: the part numbers used to arrive as arguments, which put them outside the hash, counted the whole batch rather than the split collection, and let a single-doc Update silently drop the line altogether.` with `or the note is rendered without being covered. Part numbers passed as arguments would sit outside the hash and disagree between a batch render and a single-doc Update.`

Lines 213-215: replace the three-line comment with
```
// A stacked "name over value" pair fits a shorter column than a one-line cell,
// so four mode columns stay narrower than the description column would suggest.
```

- [ ] **Step 4: frameKit.ts**

Line 42: `// Mutable so the theme can swap families (Task 14). Reset to Inter per build.` becomes `// Mutable so the theme can swap families. Reset to Inter per build.`

- [ ] **Step 5: Run the guard and the plugin tests**

Run: the Task 1 script, then `npx vitest run packages/plugin`. Expected: `comment-only diff: ok`, all tests pass.

---

### Task 4: Plugin UI comments

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:49-52`
- Modify: `packages/plugin/src/ui/foundationState.ts:277-286`
- Modify: `packages/plugin/src/ui/screens/foundations.ts:160-174`
- Modify: `packages/plugin/src/ui/screens/library.ts:382-391`
- Modify: `packages/plugin/src/ui/screens/license.ts:134-138`
- Modify: `packages/plugin/src/ui/screens/publish.ts:9-14`, `:29-34`, `:52-60`
- Modify: `packages/plugin/src/ui/screens/settings.ts:141-147`
- Modify: `packages/plugin/src/ui/shell/shell.ts:62-65`
- Modify: `packages/plugin/src/ui/shell/sidebar.ts:46-53`
- Modify: `packages/plugin/src/ui/theme.ts:7-9`
- Modify: `packages/plugin/src/ui/viewModel/library.ts:252-263`

- [ ] **Step 1: actions.ts**

Lines 49-52: replace `and the most recent generated prose drafts used to fill AI sections.` with `and the most recent generated prose drafts that fill AI sections.`

- [ ] **Step 2: foundationState.ts**

Lines 277-286: replace the docblock with
```
/**
 * The create button's label. See docs/plugin-voice-and-copy.md ("Footer
 * actions") for why this names the action rather than counting frames:
 * collectionMeta and textStyleMeta already append "+ N frames" to any row
 * that splits, and a frame is the wrong noun for what the user came for.
 */
```

- [ ] **Step 3: screens/foundations.ts**

Lines 160-174: replace the docblock body from `It used to be the label for every` through `pointed at the wrong remedy, which is "Refresh sources" beside it.` with
```
   * "Nothing to build" has other causes that are not the user's to fix: the
   * list is still loading, the file has no variables or text styles, or the
   * read failed and the remedy is "Refresh sources" beside it.
```
Keep the sentences before and after it.

- [ ] **Step 4: screens/library.ts**

Lines 382-391: replace the paragraph from `Label only. The glyph is fixed at` through `See the icon contract in design-system/components.css.` with
```
   * Label only. The glyph is fixed at `fileCheck` and does not vary with
   * state: one slot must not show an action, then a warning, then a status.
   * Circular arrows mean "re-reads, writes nothing" and belong to "Refresh
   * library" beside it; failed checks are already visible per row as "Check
   * unavailable". See the icon contract in design-system/components.css.
```

- [ ] **Step 5: screens/license.ts**

Lines 134-138: replace the five-line comment with
```
  // Says it once. Pro has no monthly cap, but PRO_SOFT_THRESHOLD and the
  // per-minute rate limit still apply, so "unlimited" is the word voice rule 6
  // tells us not to use here.
```

- [ ] **Step 6: screens/publish.ts, three docblocks**

Lines 9-14: delete the paragraph beginning `This used to be a section appended after the Library's document list` and ending `the header carries the way back.`, and the blank ` *` line before it.

Lines 29-34: replace the docblock with
```
/**
 * Two groups, because this screen holds two different concerns: what leaving
 * this file means, and the key a developer needs. "Anyone with the key can
 * pull it" has to sit next to the key it is about.
 */
```

Lines 52-60: replace the docblock with
```
/**
 * Shown instead of the publish action on a free plan.
 *
 * Publishing is a Pro action the proxy already enforces (`proCaller` in
 * packages/proxy/src/libraries.ts answers 401 to every other tier). Stating the
 * plan up front saves a free plan a collection pass over every component in
 * the file that would end in that refusal.
 */
```

- [ ] **Step 7: screens/settings.ts**

Lines 141-147: replace the paragraph from `It used to be an inert `<i>`` through `(see the CSS, which strips its default chrome).` with
```
 * A native `type="color"` input is the whole feature, with the OS picker and no
 * custom eyedropper or wheel to maintain, and it keeps the field looking like a
 * swatch (see the CSS, which strips its default chrome).
```

- [ ] **Step 8: shell/shell.ts**

Lines 62-65: replace the four-line comment with
```
  // Pointer activation leaves Chromium buttons focused, which keeps the
  // adjacent tooltip open after the pointer leaves the rail. Release pointer
  // focus after activation; keyboard focus is untouched, so Tab users still
  // get the same tooltip and focus ring.
```

- [ ] **Step 9: shell/sidebar.ts**

Lines 46-53: replace the paragraph from `It used to print `counts.updates`` through `and a dot says it without changing shape.` with
```
 * A count is a number the UI only knows progressively: source checks resolve
 * one doc at a time, so a digit would climb as they land and vanish on every
 * refresh. "Something in the Library needs attention" is the whole message,
 * and a dot says it without changing shape.
```

- [ ] **Step 10: theme.ts**

Lines 7-9: replace `deriving from Figma every load is both the "automatic" behaviour we want and the thing that removes the async clientStorage round-trip that used to cause the flash.` with `deriving from Figma every load is the "automatic" behaviour we want, and an async clientStorage read here would reintroduce the flash.`

- [ ] **Step 11: viewModel/library.ts**

Lines 252-263: replace the paragraph from `The badge used to read `counts.updates` directly` through `then a number stepping 1, 2, 3.` with
```
 * `counts.updates` is not a fact until a check pass finishes:
 * `startLibraryDriftChecks` clears every result and marks each component row
 * `pending`, so reading it directly would drop the badge to zero on reload and
 * climb back one landed check at a time.
```

- [ ] **Step 12: Run the guard and the full gate**

Run: the Task 1 script, then `npm run check`. Expected: `comment-only diff: ok`, gate exit 0.

---

### Task 5: Final verification and commit

**Files:**
- Commit: every file modified in Tasks 2 to 4.

- [ ] **Step 1: Confirm no plan references remain**

Run: `grep -rEn --include='*.ts' 'Task [0-9]+|Finding [0-9]+|Decision [0-9]+|REPLACES' packages/*/src | grep -v /test/`. Expected: no output.

- [ ] **Step 2: Confirm no NUL bytes were introduced**

Run: `npm run check:nul`. Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add packages/extractor/src packages/plugin/src
git commit -m "chore: prune comment archaeology

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Only the files in Tasks 2 to 4 are staged. `docs/reviews/` and `docs/strategy/` stay untracked.

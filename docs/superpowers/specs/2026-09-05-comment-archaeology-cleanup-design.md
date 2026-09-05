# Comment archaeology cleanup

**Date:** 2026-09-05
**Status:** Approved design
**Source:** finding C2 in `docs/reviews/2026-09-05-major-review.md`

## Problem

6,832 of 30,117 source lines in the plugin and extractor are comments. Most
explain invariants and are worth keeping. A minority narrate the history of the
code instead of its rules: plan task numbers ("Task 12", "Finding 2",
"Decision 4 / Task 3"), self-references to the change that introduced the
comment ("this task stops...", "this branch adds..."), "used to" stories about
bugs that no longer exist, dates, and one instruction left behind for an
implementer ("Delete that map and its two uses") whose target is already gone.
A reader without the plan documents cannot resolve these references, and git
already holds the history.

Measured on `main` at `2bd37a3`, in `packages/*/src` excluding tests:

| Pattern | Hits |
|---|---|
| Plan references (`Task N`, `Finding N`, `Decision N`) | 10 |
| Self-references (`this task`, `this branch`, `this change`, `this pass`, `the previous task`, `an earlier version`) | 14 |
| `used to` histories | 26 (about 8 are ordinary English and stay) |
| Dates (`2026-MM-DD`) | 8 |
| Stale instructions | 1 |

## Scope

Comment-only edits in `packages/plugin/src`, `packages/extractor/src`,
`packages/proxy/src`, and `packages/cli/src`. No code, string literals, tests,
docs, or generated output change. Not in scope: single-member unions, unused
parameters, or any other finding from the review.

## Rules

Applied by hand, one comment at a time. No regex rewriting.

1. **Plan references go.** Replace with the fact the reference stood for, or
   delete when the surrounding code already states it. "Task 12 gives them
   their own resolution path" becomes "foundation docs resolve by scope in
   `updateFoundationDoc`".
2. **Self-references become present tense.** "This task stops answering the
   second by guessing at the first" becomes "the style itself decides what
   kind of thing it is."
3. **"Used to" histories keep the why and drop the story.** A history survives,
   as one sentence, only when deleting it would tempt a reader to reintroduce
   the bug and the code alone does not make the constraint obvious. That
   covers: hash projection stability (fields excluded from `specContentHash`
   and `foundationContentHash`), the Figma sandbox realm, `figma.mixed`
   symbols, NUL and control-character separators, property access on removed
   nodes, and quota billing on cache-key changes. It does not cover UI copy
   rewrites, layout tweaks, renamed labels, or moved sections, which are
   deleted or cut to their present-tense rule.
4. **Dates go unless they are a compatibility contract.** "Libraries published
   before September 2026 also carry a legacy `keyHash`" stays because that
   data exists in production. "DELIBERATELY NOT bumped on 2026-08-21" becomes
   the rule without the date.
5. **Stale instructions go.** The `identityByName` note in `tokens.ts` is
   deleted.
6. **Ordinary English survives.** "used to pick out", "used to divide",
   "used to resolve its position" are not histories.

## Verification

- `npm run check` passes.
- The diff touches only comment lines: every removed or added line in
  `git diff -U0` begins with whitespace followed by `//`, `/*`, `*`, or `*/`,
  or is a blank line left by a removed comment block. Checked with a script
  before committing.
- `grep -rEn 'Task [0-9]+|Finding [0-9]+|Decision [0-9]+' packages/*/src`
  returns nothing outside tests.

## Delivery

One commit: `chore: prune comment archaeology`. No `CHANGELOG.md` entry, since
behaviour does not change.

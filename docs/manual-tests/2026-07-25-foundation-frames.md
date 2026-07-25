# Foundation frames manual Figma pass

**Branch:** foundations-1.0
**Plan:** Task 10: Manual Figma pass for generation
**Status:** Checklist created. Testing deferred to human owner.

Record pass/fail and findings inline for each item below. If an item fails, note whether it was fixed during this pass or deferred to a later task.

## Setup

Build the plugin:

```bash
npm run build:plugin
```

Import the plugin into Figma desktop from `packages/plugin/manifest.json` using the development plugin menu. The plugin needs no local server and no account to run.

## Checklist

Foundation frame generation works end-to-end:

- [ ] **Two collections, one single-mode and one aliasing it.** A file with two collections (single-mode Primitives, two-mode Semantic aliasing it) generates both frames. Aliases show `→ target` with the resolved swatch.

- [ ] **Descriptions column appears when needed.** Descriptions appear for variables that have them. The Description column is absent entirely when no variable in the unit has one.

- [ ] **Text styles only.** A file with text styles and no variable collections generates a Text styles frame. Specimens render in their real fonts. The Foundations tab shows a note that no variable collections exist.

- [ ] **Neither variables nor text styles.** A file with neither variable collections nor text styles shows the message `This file has no local variable collections or text styles.` in the Foundations tab, and the create button stays disabled.

- [ ] **Large collection split by group.** A collection with more than 150 variables across at least two groups splits into one frame per group. Each footer reads `Part i of n, covering <group>.`

- [ ] **Six modes with mode checkboxes.** A collection with six modes renders four columns. Mode checkboxes appear. The footer reads `Modes not shown: …` naming exactly the two omitted modes.

- [ ] **Mode toggling swaps columns.** Unchecking a mode and checking a different one swaps the column and preserves collection order.

- [ ] **Unavailable font falls back to default.** A text style whose font is unavailable locally falls back to the theme's body font. The row shows the note `Font not available, showing the default font.` The note does not name a specific font, since the default varies by theme.

- [ ] **Alias into library collection.** An alias pointing into a library collection shows `→ name (library)` with no swatch and no fabricated value.

- [ ] **Generation progress updates on large files.** Generation progress updates rather than appearing frozen on a large file. Note the wall-clock time for the largest file tested.

- [ ] **Frames land to the right.** Generated frames land to the right of existing page content, not on top of it.

- [ ] **Theme customization applies.** Generated frames pick up a customized brand theme (header color, fonts, corner style) from Settings.

- [ ] **Empty string variable renders as (empty string).** A STRING variable whose value is an empty string renders the literal text `(empty string)` in its cell, not a blank cell. A blank cell would wrongly read as "this token has no value".

- [ ] **Checkbox toggle during generation keeps button disabled.** Toggling a checkbox in the Foundations tab while a generation is running leaves the "Create foundation frames" button disabled. The button does not re-enable mid-run.

- [ ] **Partial failure message names frames created.** If generation fails partway, the message says how many frames were created and that they remain on the canvas rather than reporting total failure. Expected wording: `Created N frames before hitting an error, and they are still on the canvas.`

## Findings

Record any failures and their outcomes below:

---

**Failure 1:** (description)
**Outcome:** Fixed during this pass / Deferred to (task/issue number)

---

**Failure 2:** (description)
**Outcome:** Fixed during this pass / Deferred to (task/issue number)

---

(Add more rows as needed.)

---

**Pass completed by:** (your name)
**Date:** 
**Largest file wall-clock time:** (note this from the Generation progress item)

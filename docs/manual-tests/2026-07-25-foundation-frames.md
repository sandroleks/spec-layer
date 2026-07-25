# Foundation frames manual Figma pass

**Branch:** foundations-1.0
**Plan:** Task 10: Manual Figma pass for generation
**Status:** Checklist created. Testing deferred to human owner.

Record pass/fail and findings inline for each item below. If an item fails, note whether it was fixed during this pass or deferred to a later task.

If you can't build the fixture an item needs, record it as blocked with the reason instead of leaving the checkbox unchecked. A blank checkbox doesn't say whether the check failed, was skipped, or couldn't be run, and that difference matters when someone reads this later to decide whether the feature is verified.

## Setup

Build the plugin:

```bash
npm run build:plugin
```

Import the plugin into Figma desktop from `packages/plugin/manifest.json` using the development plugin menu. The plugin needs no local server and no account to run.

## Checklist

Foundation frame generation works end-to-end:

- [ ] **Two collections, one single-mode and one aliasing it.** A file with two collections (single-mode Primitives, two-mode Semantic aliasing it) generates both frames. Aliases show `→ target` with the resolved swatch.
      Screenshot:

- [ ] **Descriptions column appears when needed.** Descriptions appear for variables that have them. The Description column is absent entirely when no variable in the unit has one.
      Screenshot:

- [ ] **Text styles only.** A file with text styles and no variable collections generates a Text styles frame. Specimens render in their real fonts. The Foundations tab shows a note that no variable collections exist.
      Screenshot:

- [ ] **Neither variables nor text styles.** A file with neither variable collections nor text styles shows the message `This file has no local variable collections or text styles.` in the Foundations tab, and the create button stays disabled.
      Screenshot:

- [ ] **Large collection split by group.** A collection with more than 150 variables across at least two groups splits into one frame per group. Each footer reads `Part i of n, covering <group>.`
      Setup: Hand-building 150+ variables isn't practical. Create them with a short script run through Figma's plugin console (Plugins > Development > Open console) or a throwaway plugin that loops `collection.addVariable(...)`, for example 80 variables named `color/1` through `color/80` and 80 named `space/1` through `space/80`. The part of the name before the first slash is the group, so this naming gives you two distinct top-level groups to split on. Duplicating an existing small group's variables repeatedly and renaming them to keep the two prefixes intact works too, if that's faster than scripting.
      Screenshot:

- [ ] **Six modes with mode checkboxes.** A collection with six modes renders four columns. Mode checkboxes appear. The footer reads `Modes not shown: …` naming exactly the two omitted modes.
      Setup: Multiple modes per collection are plan-gated. Free and Starter plans support only one mode per collection, so they can't build this fixture at all. Professional supports up to 4 modes per collection. Organization and Enterprise support more than 4, so one of those is what you need to reach 6. To add a mode, open the variables panel, select the collection, and click the + next to the mode row, then rename each mode. If your plan tops out at 4 modes, you can't build six. Instead, test the cap with the highest mode count above 4 your plan allows and adjust the expected omitted-mode count in the footer to match, or record this item as blocked with the reason (for example "plan caps modes at 4") instead of leaving the checkbox unchecked.
      Screenshot:

- [ ] **Mode toggling swaps columns.** Unchecking a mode and checking a different one swaps the column and preserves collection order.
      Screenshot:

- [ ] **Unavailable font falls back to default.** A text style whose font is unavailable locally falls back to the theme's body font. The row shows the note `Font not available, showing the default font.` The note does not name a specific font, since the default varies by theme.
      Setup: Create the text style using a font you have installed, then make that font unavailable, either by uninstalling it from your machine or by opening the file on a machine or account that never had it installed. Opening a file authored elsewhere that uses a font you don't have works the same way.
      Screenshot:

- [ ] **Alias into library collection.** An alias pointing into a library collection shows `→ name (library)` with no swatch and no fabricated value.
      Setup: This needs a published team library, and publishing a library is itself plan-gated (a free/Starter file can't publish a library for other files to consume). Publish a small collection from a second file (Assets panel > Libraries, or the file's Publish flow) on a plan that supports it, or point at an existing team library if one is already available to you. If neither is available, record this item as blocked with the reason instead of leaving the checkbox unchecked.
      Screenshot:

- [ ] **Generation progress updates on large files.** Generation progress updates rather than appearing frozen on a large file. Note the wall-clock time for the largest file tested.
      Screenshot:

- [ ] **Frames land to the right.** Generated frames land to the right of existing page content, not on top of it.
      Screenshot:

- [ ] **Theme customization applies.** Generated frames pick up a customized brand theme (header color, fonts, corner style) from Settings.
      Screenshot:

- [ ] **Empty string variable renders as (empty string).** A STRING variable whose value is an empty string renders the literal text `(empty string)` in its cell, not a blank cell. A blank cell would wrongly read as "this token has no value".
      Screenshot:

- [ ] **Checkbox toggle during generation keeps button disabled.** Toggling a checkbox in the Foundations tab while a generation is running leaves the "Create foundation frames" button disabled. The button does not re-enable mid-run.
      Setup: Use the large-collection fixture from the item above so the run lasts long enough to act during it. On a small file, generation finishes before you can click anything, and the check silently passes without actually testing anything.
      Screenshot:

- [ ] **Partial failure message names frames created.** If generation fails partway, the message says how many frames were created and that they remain on the canvas rather than reporting total failure. Expected wording: `Created N frames before hitting an error, and they are still on the canvas.`
      Setup: There's no reliable way to force a mid-run failure from the Figma UI. The failure paths this message covers are things like a Figma API error partway through building a Section, and none of those have a manual trigger you can pull on demand. This is covered by code review and by the shape of the error handler, not by this manual pass. Check this item only if a real failure happens to occur during the run, and record what you saw if it does. Otherwise leave it unchecked and note in Findings that it wasn't exercised, since inventing a procedure that doesn't actually force the failure would just create false confidence.
      Screenshot:

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

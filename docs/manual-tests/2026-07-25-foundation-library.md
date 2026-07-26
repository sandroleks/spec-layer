# Foundation docs in My Library manual Figma pass

**Branch:** foundations-1.0
**Plan:** Task 14: Update, Detach, Remove, and the final pass
**Status:** Checklist created. Testing deferred to human owner.

Run this together with `2026-07-25-foundation-frames.md` in one session. That checklist covers generating foundation frames; this one covers what happens to them afterwards in the My Library tab. Generate a set of frames first, then work through the items below against them.

Record pass/fail and findings inline for each item. If an item fails, note whether it was fixed during this pass or deferred.

If you can't build the fixture an item needs, record it as blocked with the reason instead of leaving the checkbox unchecked. A blank checkbox doesn't say whether the check failed, was skipped, or couldn't be run, and that difference matters when someone reads this later to decide whether the feature is verified.

## Setup

Build the plugin:

```bash
npm run build:plugin
```

Import the plugin into Figma desktop from `packages/plugin/manifest.json` using the development plugin menu.

For most items below you need a file with at least one variable collection holding a handful of variables, and a generated foundation frame for it. Keep the variables panel open in a second tab so you can edit variables and switch back to the plugin quickly.

## Checklist

### Listing and badges

- [ ] **Generated frames appear as rows.** A generated foundation set appears in My Library, one row per frame, each labelled `Foundations · <title>`.
      Screenshot:

- [ ] **Fresh frames read In sync.** Immediately after generation, every foundation row's badge reads In sync.
      Screenshot:

- [ ] **Adding a variable flips only its own collection.** Adding a variable to a documented collection flips that collection's row to Update available. Rows for other collections stay In sync.
      Setup: Needs at least two documented collections so you can see that the change is isolated to one. Generate frames for both first, then add a variable to only one of them.
      Screenshot:

- [ ] **Renaming a variable flips the row.** Renaming a variable in a documented collection flips its row to Update available.
      Screenshot:

- [ ] **Renaming the collection flips to Update available, not Source missing.** Renaming a documented collection itself flips the row to Update available. It must not read Source missing, because the collection still exists and only its rendered title changed.
      Screenshot:

- [ ] **Deleting the collection flips to Source missing.** Deleting a documented collection flips its row to Source missing, and Update reports that the doc could not be rebuilt. Expected wording: `This foundation doc could no longer be rebuilt. Its collection is gone from this file.`
      Screenshot:

- [ ] **Hand-editing flips to Manually edited.** Editing any text inside a generated foundation frame flips its row to Manually edited. Update warns before replacing those edits. Expected wording: `You edited this frame by hand. Updating replaces those edits.`
      Screenshot:

- [ ] **A failed drift check reads In sync, not Update available.** If the plugin cannot read the file's variables, rows read In sync rather than claiming Update available. Saying a doc is stale when the check never ran is worse than saying nothing.
      Setup: This is hard to force deliberately, since it needs the variables API to fail. Check it only if you happen to hit it. Otherwise leave it unchecked and note in Findings that it wasn't exercised, rather than inventing a procedure that doesn't actually trigger the path.
      Screenshot:

### Row actions

- [ ] **The overflow menu offers the right actions.** A foundation row's overflow menu offers Update, Detach, and Remove. It must NOT offer `Download .md`, because foundation markdown does not exist yet and is a later phase. It must NOT offer `Go to source`, because a foundation doc has no source node to jump to.
      Screenshot:

- [ ] **Update rebuilds in place.** Update rebuilds the frame at the same position, on the same page, as a single frame. The registry does not gain a duplicate row.
      Screenshot:

- [ ] **Update after a rename retargets by name.** After renaming a documented collection, Update rebuilds the frame with the new name in the header rather than failing.
      Screenshot:

- [ ] **Detach keeps the frame and drops the row.** Detach leaves the frame on the canvas and removes its row from My Library.
      Screenshot:

- [ ] **Remove deletes the frame and drops the row.** Remove deletes the frame from the canvas and removes its row from My Library.
      Screenshot:

### Regeneration and pages

- [ ] **Regenerating replaces rather than duplicates.** Regenerating from the Foundations tab replaces the existing frames in place rather than adding a second copy. The message reads `Updated N foundation frames.`
      Screenshot:

- [ ] **Cross-page regeneration updates in place and returns you home.** With an existing foundation frame on one page, switch to a different page and regenerate from the Foundations tab. The existing frame must be updated on its own page, not moved to the page you are viewing, and you must end up back on the page you started from.
      Setup: Generate a foundation set on page 1. Create page 2 and switch to it. Open the Foundations tab and regenerate with the same selection.
      Screenshot:

### Regression checks

- [ ] **Component docs still behave.** Component docs in the same file still show correct badges and still Update correctly. This is the regression check that widening the doc link type did no harm to the existing component flow.
      Setup: Generate a component doc from the Selected component tab in the same file, then edit its source component so it drifts, and confirm the badge and Update both still work.
      Screenshot:

- [ ] **Pre-branch docs still list and update.** A file whose docs were generated before this branch, meaning component docs written without the newer link format, still lists in My Library and still updates.
      Setup: This needs a file documented with an older build of the plugin. If you have one from earlier testing, use it. If not, record this item as blocked with the reason, since it can't be constructed from the current build.
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

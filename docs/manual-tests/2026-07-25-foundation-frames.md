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

The Foundations tab itself. These were verified in a browser against the built
`ui.html` with a scripted file, so what is left is confirming Figma's own
host: its theme variables, its panel width, and its timing.

- [ ] **Placeholder rows show while the file is read.** Opening the tab on a large file shows three shimmering placeholder rows, no header row, and a disabled button, then the real list replaces them without the panel jumping. On a small file this may be too fast to see; say so rather than ticking it blind.
      Screenshot:

- [ ] **The build loader matches a component build.** Creating frames shows the same sparkle-and-shimmer loader the Selected component tab uses, above the button. It cycles phases, then switches to `Creating frame N of M` once frames start landing, and disappears when the build ends.
      Screenshot:

- [ ] **The result is reported and stays put.** After a build the tab shows `Created N foundation frames.` and the message remains readable (it does not flash and vanish). Toggling a checkbox afterwards leaves it alone; starting another build clears it.
      Why this is here: the message used to be written and then erased by the repaint that immediately followed, so a successful build reported nothing at all.
      Screenshot:

- [ ] **Frame counts are honest.** The button reads `Create N frames` and matches the number of Sections that actually appear on the canvas. A collection past 150 variables shows `splits into N frames` on its row, and that N matches the parts it produces.
      Screenshot:

- [ ] **Mode pills.** On a collection with more than four modes, the modes render as pills, four checked. Unchecking one and checking another swaps them. Unchecking the collection greys every pill out.
      Screenshot:

- [ ] **Select all / Clear all.** The link clears every source, then restores them, and its label always describes what the next click will do. The button label and disabled state follow.
      Screenshot:

- [ ] **Both themes.** Switch the plugin's theme button and confirm the tab is legible in both: selected rows, mode pills, placeholder shimmer, and the result banner. Figma's own light/dark host counts as a third case worth a look.
      Screenshot:

Colour layout. Verified in a browser against a mock built from the same layout
constants, so what is left is Figma's own text metrics and wrapping:

- [ ] **Colours render as a swatch list, not a table.** A single-mode colour collection shows one large swatch per row, the token name and its description beside it, and hex, rgb and hsl right-aligned at the far edge. Compare it against a published token reference (the Salesforce Lightning surface-colour page is the shape this was built to match).
      Screenshot:

- [ ] **The colour values are correct.** Spot-check two or three swatches against Figma's own colour picker: the hex matches, and the rgb and hsl describe the same colour. `#032D60` should read `rgb(3, 45, 96)` and `hsl(212.9, 93.9%, 19.4%)`.
      Why this is here: hsl is derived by hand and is easy to get subtly wrong. Unit tests pin it against four known values, but a wrong colour in a doc is worse than a wrong layout.
      Screenshot:

- [ ] **Multi-mode colours.** A two- or three-mode colour collection names each mode once in a heading row, with one swatch per mode below it. No mode name repeats on every row, and the swatches line up in columns down the frame.
      Screenshot:

- [ ] **Aliased colours show their target.** A semantic token shows the primitive it points at plus the resolved hex, and does not show rgb/hsl. A colour aliased into a published library shows an empty outlined swatch, its target, and `library variable`, with no invented value.
      Setup: needs a published team library, same as the alias item below. Record as blocked if you cannot publish one.
      Screenshot:

- [ ] **Colours are grouped by folder.** A collection whose colours sit in several folders (`color/surface/...`, `color/text/...`) renders one block per folder, each titled with the folder path, rows of the same folder kept together even if the collection interleaves them. A collection whose colours all share one folder shows no group heading.
      Screenshot:

- [ ] **A mixed collection gets both blocks.** A collection holding colours and numbers together shows a **Colors** heading over the swatch list and an **Other values** heading over the table, each heading sitting against its own block rather than floating between them. The table has no Description column unless a non-colour row actually has a description.
      Screenshot:

- [ ] **Descriptions setting governs both layouts.** With descriptions off, no colour row shows its description either.
      Screenshot:

- [ ] **Existing docs report out of date, then update cleanly.** A foundation doc generated before this change reports **Update available** in My Library (the layout is part of the tracked content). Pressing Update rebuilds it in place with the new colour layout.
      Why this is here: this is the intended consequence of the layout depending on a variable's declared type. If an existing doc instead reads In sync and keeps the old look, drift detection is not covering the layout.
      Screenshot:

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
      Check the header band is actually painted in the theme's header color, not the default navy. The first version of these frames read the theme for its fonts and its table tint but never used its header color, because the frame had no header band to paint.
      Screenshot:

- [ ] **Foundation frames match component frames.** Put a generated foundation frame beside a generated component doc for the same file and confirm they read as the same kind of document: the same header band and header color, the same eyebrow and title treatment, the same card corner and shadow, the same width unless the foundation table needs more room.
      Why this is here: "follows the component style" is the requirement, and no unit test can judge it. Two frames that are each individually fine can still fail this.
      Screenshot:

- [ ] **Logo appears in the foundation header.** With a logo captured in Settings, generated foundation frames show it at the right of the header band, at the same size as on a component doc. Then clear the logo, regenerate, and confirm the eyebrow sits alone with no gap left behind.
      Screenshot:

- [ ] **Header title and count are right.** The header title matches the document (`Semantic`, or `Primitives · color` for a split part, or `Text styles`), and the line below it counts what the frame actually shows: `12 variables across 2 modes`, `1 variable across 1 mode`, `8 text styles`. Check a single-mode collection and a single-variable collection for the singular wording.
      Screenshot:

- [ ] **The widest table still fits the card.** Generate a frame for a four-mode collection with descriptions turned on, which is the widest table the plugin can produce. No column is cut off at the right edge, and the table's border is fully inside the card on both sides.
      Why this is here: the card clips its contents, so a card sized from the columns alone loses its right-hand column. Covered by unit tests, but only Figma is authoritative on layout.
      Screenshot:

- [ ] **Rows are full height and no text is clipped.** Every table row is tall enough for its text. No row shows a cropped or sliced line of type, and no cell's text overflows its row. Check the header row, variable rows, alias rows, and text-style specimen rows.
      Why this is here: the first build shipped every row pinned to one pixel tall, so all text rendered as a thin sliced band. The cause was an auto-layout axis mix-up (`resize()` fixes both axes, and only the width was released back to hugging). Unit tests now cover the sizing contract, but they run against a stub of Figma's resize behavior, so only Figma itself is authoritative. Look at this one properly rather than skimming it.
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

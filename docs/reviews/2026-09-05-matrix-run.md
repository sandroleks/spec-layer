# Manual Figma matrix run (2026-09-05 review)

**Build:** `main` at `<commit>` built with `npm run build:plugin`.
**Figma:** desktop app version `<version>`, macOS.
**Test file:** `<synthetic file name>`, `<n>` variables in `<n>` collections,
`<n>` text styles, `<n>` component sets.

Follow `packages/plugin/TESTING.md` in its pre-merge order and record each
section's result below. Then answer the three review questions.

## Section results

| TESTING.md section | Result | Notes |
|---|---|---|
| Generate component docs | | |
| Generate Foundation docs | | |
| Foundation Context v5 Copy matrix | | |
| Doc frame content | | |
| Library | | |
| AI-writing allowance (free plan) | | |
| License | | |
| Publish and pull | | |
| Settings, search, keyboard, and visuals | | |

## Three questions the review could not answer

### 1. Does `window.confirm` show a dialog in the plugin iframe?

Run Library row 10. For each of Detach, Remove, Update of a hand-edited doc,
and Update all with an edited row, record: dialog visible (yes/no), Cancel
honoured (yes/no), Accept honoured (yes/no).

| Action | Dialog visible | Cancel honoured | Accept honoured |
|---|---|---|---|
| Detach | | | |
| Remove | | | |
| Update, hand-edited | | | |
| Update all, edited rows | | | |

### 2. How often does the non-component toast fire in normal use?

With the plugin open, click through a normal editing minute: frames, text,
one of the plugin's own documentation Sections, then back to a component.
Count how many times `Select a component or component set` appears.

Count: `<n>` in `<n>` clicks. Did it obscure anything you were reading? `<yes/no>`

### 3. What is the real size and paste behaviour of the DTCG clipboard?

Run Generate Foundation docs row 4 on the largest real file available.

| Measure | Value |
|---|---|
| Variables in file | |
| Lines copied | |
| Bytes copied (paste into a file, check its size) | |
| Time from click to "Copied." toast | |
| Pasted cleanly into a plain text editor | |
| Pasted cleanly into a chat window (which one) | |
| Manual-copy modal appeared instead of a toast | |

## Regressions found

List anything that failed, with the TESTING.md row number and what happened.

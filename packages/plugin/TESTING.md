# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
```

Import `packages/plugin/manifest.json` through Figma desktop's development
plugin menu. The plugin needs no local server and no account to run.

`npm run build:plugin` builds the current vNext UI. There is one production UI
and one bundle; no legacy build flag or alternate UI artifact remains.

## Pre-merge pass

Before merging a branch that touched the plugin, walk these in order. Each one
covers something unit tests cannot reach, roughly highest risk first:

1. **Create component docs** on a component set with two variant axes.
2. **Generate Foundation docs** and exercise file-wide **Copy for AI**, which
   copies a DTCG resolver document.
3. **Doc frame content**, where most rendering regressions show up.
4. **Library**, including component and Foundation rows and scoped copies.
5. **Download skill**, which is a blob save the unit suite cannot reach.
6. **AI-writing allowance** and **License**, which need a real proxy round
   trip and cannot be faked locally.
7. **Settings**, global search, keyboard, and visual checks.

Two things worth knowing before you start:

- The manifest points at the production proxy. Activating a real license here
  affects the live service.
- Deploy order matters. The plugin sends `Bearer key:instanceId`; an older
  deployed proxy reads that whole string as the key and silently falls back to
  the free tier. If licensing behaves oddly, confirm the proxy is current
  before debugging the plugin.

## Network model

The only network destination the manifest permits is the Spec Layer proxy:
`https://api.spec-layer.com`. AI writing is generated through this proxy,
which enforces free-tier quotas and Pro licenses. There is **no Anthropic API
key** in the plugin: no API key is requested, entered, or stored.

Free users start with 20 generations for 30 days and then receive 10 per UTC
month. Pro has no fixed monthly cap for normal individual use, subject to fair
use and rate limits. Component requests carry a structured summary and, when it
fits the export limits, a rendered image of the selected node. Foundation group
requests carry token names and resolved values without an image.

## Create component docs

1. Select a component or component set and run the plugin.
2. Confirm the component name is shown (and the atom notice appears for
   `.`-prefixed components).
3. Toggle **AI writing**. On the free plan it enables without an API or license
   key while allowance remains.
4. Pick sections and, for a component set, the variants to document. Click
   **Create docs** and confirm a `<Name>: Documentation` Section holding frames
   named 1 Usage, 2 Specifications and 3 Accessibility is placed next to the
   component. Re-running replaces the previous Section in place.
5. With a component selected and no document created, click the footer's
   **Copy for AI** and paste into a plain text editor. Confirm it is a YAML
   brief for the live source that says `kind: component`, carries token values
   when Foundations have been read, and does not mention saved guidelines. It
   must not change the canvas. Then open **Library**, use a row menu's **Copy
   for AI**, and confirm that brief still includes saved guidelines when the
   document has them.
6. Move a generated Section to another page, reselect its component on the
   first page, and run **Create docs** again. The doc is rebuilt on the page
   it was moved to, the toast says it was updated, and the component screen
   still shows the component: the page switch that places the rebuilt
   Section must not empty the panel. Then start a Foundation build and, while
   it runs, click **Create docs** on a component. The toast says another
   build is still running, and the finished Foundation docs carry the brand
   theme, not the component doc's leftovers.
7. Start a Foundation build with enough collections selected that it takes a
   few seconds, and while it runs, select a different component on the page
   you are viewing. Once the toast says the build finished, confirm the
   component screen shows the component you selected during the build, not
   whatever was selected before you clicked **Create docs**.
8. From **Library**, click **Update** on a Foundation doc that lives on a
   different page than the one you are viewing, and while it runs, select a
   different component on your own page. The canvas returns to your page
   once the toast says the doc updated (it never stays on the other doc's
   page), and the panel shows the component you picked there during the
   build. Repeat clearing your selection instead of picking a component
   partway through: the panel goes back to its empty state once the toast
   shows, rather than keeping the last component shown.

Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state with no toast. Click
a frame, a text node, and one of the plugin's own Sections while the panel is
open: nothing should pop up on the canvas.

## Generate Foundation docs

1. Open **Foundation documents** and wait for local variable collections and
   text styles to finish loading. Use **Refresh sources** after changing the
   Figma file and confirm the list updates without creating Sections.
   Then select a component, change a variable value, come back to
   **Foundation documents**, click **Refresh sources**, select the component
   again, and run Library **Copy for AI** on it. The copied token value must be
   the new one: the selection message no longer carries the foundation dump,
   so this checks the refreshed dump still reaches the component copy.
2. Exercise **Select all** / **Clear all**, individual source selection, and a
   collection large enough to split. Confirm row and button frame counts match
   the Sections that are created.
3. Click **Create docs** and confirm collection and text-style Sections use the
   current frame theme, include only selected sources, and appear in Library.
4. Click the Foundations footer's **Copy all for AI** and paste into a
   plain text editor. Confirm it is a single line of compact JSON that a
   formatter can pretty-print, with `"version": "2025.10"`, one set or modifier
   per collection named exactly as in Figma, `$type` and `$value` on every
   token, `{Collection.path}` references for aliases, and a
   `$extensions["com.spec-layer"]` block carrying `content_hash`,
   `completeness`, `code_syntax`, and a `report` array. Every unresolved
   library alias in the file must appear in `report` and nowhere else.
   Confirm the complete file-wide vocabulary is present regardless of source
   selection, and no canvas objects are created. Note the size the toast
   reports, if any; it appears above 200 KB and is measured in kilobytes.
5. Click the copy icon on one collection row and paste. Confirm the document
   contains that collection with all of its modes plus only the collections
   its aliases need, that the "included" checkbox did not toggle, and that the
   copy is much smaller than the whole-file copy. Repeat for the **Text
   styles** row and confirm only `sets["Typography styles"]` and its
   dependency collections appear. Repeat for the **Effect styles** row and
   confirm only `sets["Effect styles"]` and its dependency collections appear.
6. If AI group descriptions are enabled, confirm a failed or refused AI
   request still creates deterministic Foundation Sections and reports that it
   went without descriptions.
7. In a collection with a variable whose Web code syntax is longer than the
   Name column (about forty characters), and a text-styles or effect-styles
   source with more than four modes' worth of omitted names, generate the
   docs. The code-syntax chip wraps inside its cell instead of running under
   the next column, the "Modes not shown" footer line wraps at the prose
   measure, and a long mode name used as a block label wraps rather than
   widening the card.

### Foundation Context v5 Copy matrix

Run this matrix against a development plugin build before releasing a change
to Foundation extraction or Copy. The clipboard is a Design Tokens Format
Module 2025.10 document; the checks below name fields at that top level and
under its `$extensions["com.spec-layer"]` block.

1. Copy an ordinary local file twice without editing it. Both copies must
   have `"version": "2025.10"`, a `schema_version` of `5.1.0` under
   `$extensions["com.spec-layer"]`, and a matching `content_hash`; export
   ids and timestamps play no part in it. Every declared mode appears as its own
   resolver context (a single-mode collection is a `set` instead of a
   `modifier`, with contexts named after the modes and a `default`); a token
   with no value for some mode is simply absent from that mode's source,
   with a matching `value_omitted` entry in `report`.
2. Copy a collection containing a cross-collection alias. The selected
   collection and every complete transitive dependency collection must
   appear as their own set or modifier, and every `{Collection.path}`
   reference must resolve to a token actually present in the document; no
   reference may dangle. A grouped/split frame row must still copy the
   complete collection and all modes.
3. Copy a text-style Library row. It must have `sets["Typography styles"]`
   with every requested typography style and add only the collections
   required by bound property tokens; it must not include unrelated
   collections or `sets["Effect styles"]`. If two tokens or two styles
   collide on the same escaped path, confirm `report` carries a
   `path_collision` entry: both colliding tokens are dropped, while for
   styles only the later one is dropped and the first keeps the path.
4. Test an enabled/readable external library and an unavailable/deprecated
   one. Neither alias ever appears as a value in the tree; `report` carries
   a `value_omitted` entry with `reason: "source_library_unavailable"`,
   plus `source_library_name` when Figma exposes it.
5. Simulate a local variable read failure. A known local id's omission must
   never read as `source_library_unavailable`, and
   `$extensions["com.spec-layer"].completeness.collections` must read
   `partial` or `unavailable`.
6. Use two modes with one display name. Both value sets must survive as
   separate resolver contexts, distinguished by appending the mode id to
   the otherwise duplicate label (for example `Light [ModeID:...]`).
7. Check a `GAP` float, a `FONT_WEIGHT` float, and a float whose scopes
   state no unit. Expect `{ $type: "dimension", $value: { value, unit:
   "px" } }`, `{ $type: "fontWeight", $value: <number> }`, and `{ $type:
   "number", $value: <number> }` respectively. The third case's
   `UNIT_METADATA_UNAVAILABLE` diagnostic is not in the clipboard:
   diagnostics stay in the canonical artifact, and the clipboard carries
   `report` instead.
8. Check a half-precision and a fully precise color. `$value.hex` is the
   canonical hex and `$value.components` are the precise source channels,
   even where they differ from what the hex alone would round to. A
   corrupt-color fixture must be absent from the tree with a
   `value_omitted` report entry, never a clamped black or white value.
9. Check a multi-hop alias, a cycle, and depth exhaustion. A resolved alias
   references its direct target only, as `{Collection.path}`, never the
   chain's terminal value. An unresolved case (a cycle or exhausted
   resolution depth) is absent from the tree with a `value_omitted` report
   entry naming the reason, and must not crash the UI.
10. Copy with existing generated group descriptions, then change only their
    wording and copy again. The matching group's `$description` in the
    tree must update while `$extensions["com.spec-layer"].content_hash`
    stays unchanged.
11. Exercise the large-payload manual clipboard fallback. Its line-count
    caveat and modal must remain available for the DTCG document text.
    There is no byte/line ceiling against the canonical artifact to check
    here: the resolver's inlined sources are full per-mode files, not a
    summarized profile, so `copyFoundation.test.ts`'s size-caveat tests are
    the coverage for the 800-line threshold itself.

## Doc frame content

Build one component Section with every section enabled, against a component
set that has at least two variant axes and a hardcoded paint. Check that:

1. **Anatomy** switches between **Diagram**, **Table**, and **Both**. Diagram
   numbers match table rows, and nested components show depth and main name.
2. **Measurements** respects the size, padding, and spacing lenses. Selecting
   none falls back to all three instead of producing an empty section.
3. **States** uses lifecycle-ordered columns and caps large row sets with a
   note rather than an unbounded grid.
4. **Variants** gives the default variant all rows and other variants only
   differences, with a same-as-default count for the rest.
5. **Tokens used** preserves conditions and shows hardcoded paint as a raw
   value instead of inventing a token.
6. Unchecking a section removes it; unchecking a whole group removes its group
   heading.
7. **Hidden elements, off.** On a component with two boolean-controlled layers
   off by default (a Chip with `Icon left` and `Icon right`), generate with
   **Document hidden elements** unchecked. The frames match a build from the
   previous release and the Library badge reads in sync.
8. **Hidden elements, on.** Generate the same component with the option
   checked. Both icons appear in Anatomy with "Shown when Icon left is true"
   in the legend, and in every States, Variants, and Measurements instance.
   Pins land on the icons.
9. **Update keeps the option.** Update the doc from row 8 via the Library. The
   icons stay, and the row reads in sync afterwards.
10. **Variant inside a set.** Row 8 on a component set, so the boolean
    definitions are read from the set, not the variant.
11. **No bound layer.** On a component with no boolean-controlled layer, the
    option's switch does not appear above the section list.
12. **Callout order.** In row 8's Anatomy, the pins ascend left to right
    (1, 2, 3 on a horizontal component), each pin sits over the part its
    legend row names, and no leader line crosses another. Unit tests fix the
    part ORDER but not where a pin lands, which is measured live.
13. **Hierarchical numbers.** In the same legend, a nested row reads "2.1"
    rather than a whole number, and the pill badge is not clipping the text.
    Depth-0 rows count 1, 2, 3 with nothing skipped.
14. **Tokens for a revealed part.** In row 8's **Tokens used**, each revealed
    icon has its own part group with real token names. Turn the option off,
    regenerate, and confirm those groups are gone. The extraction fix is unit
    tested; what this proves is that the icons in your file carry bindings at
    all, and that the group headers read sensibly.
15. **The switch survives a section change.** With the option on, uncheck
    Anatomy and check it again. The switch stays visible and stays on, and the
    other sections still show the revealed icons.

Rows 7 to 11 were added on 2026-09-10 and have not been run. Rows 12 to 15
were added the same day, after the review that found the callouts reading
2, 1, 4 and the Tokens section empty for a revealed icon.

16. **True size, small component.** Generate a checkbox. The anatomy instance
    and the measurement instance render at their real pixel size; every
    anatomy part carries a thin outline around what it draws (the label's
    outline hugs the word, not the layer's full width) and each pin's leader
    ends on its outline; pins fan out with elbow leaders and no two overlap;
    measurement badges on the right rail do not overlap; the measurements
    table under the diagram lists gap, padding, radius and border-width
    bindings only, never a fill or a text style.
17. **Downscale note.** Generate a component wider than about 1300px. The
    frame widens first; if the instance still shrinks, "Shown at N%" appears
    under the anatomy and measurement diagrams. The Variants and States
    matrices show every instance at true size: a wide component gets one axis
    value per band with a slot spanning the column, and no preview shrinks.
18. **Rebuild from 5.1.0.** Open a file with a doc generated by 5.1.0. The
    Library row reads "Rebuild needed" with the note about written sections.
    Rebuild it: Overview, Variants guide, Anatomy roles, Do and Don't,
    Semantics and Content survive; keyboard bullets that opened with a key
    became table rows; Configuration is now Properties.
19. **AI writing off.** Generate with AI off on a component that has a Figma
    description of more than one sentence. The header subtitle takes the
    description's first sentence and the Overview section below it shows the
    rest, both untagged: edit the description in Figma and Update replaces
    both. Only Figma-backed sections render, no placeholder text appears
    anywhere, and the result message names each omitted section with its
    reason.
20. **Keyboard table.** With AI on, a Button gets a Keyboard table with chips;
    a Divider gets none and the result says "Left out Keyboard: nothing to
    show."
21. **Display names.** A component named `checkbox` titles as "Checkbox"; a
    layer named `checkboxItem` reads "Checkbox item" in the legend; the
    Section and layer names keep the raw name; boolean matrix headers read
    as typed ("isInvalid: true"), not uppercased.
22. **Do and Don't colours.** The DO cards carry a faint green fill, a green
    border and a green DO label; the DON'T cards the same in red. The rule
    and reason text read as before, and both labels are legible at 100% zoom
    on a light and a dark header theme.
23. **Code spans.** A Semantics bullet with a code span renders it in Medium
    weight with no backticks; after Update the bullet still reads the same.
24. **Description drift.** Edit the component description in Figma. The
    Library row reads "Update available" and the change list names the
    description; Update refreshes the Overview and subtitle.
25. **AI writing on, free plan.** Select a checkbox component set that has a
    Figma description, tick every section, and generate with AI writing on
    while signed in with no Pro key. Expected: the Usage frame shows the
    description's first sentence as the subtitle and an Overview, When to
    use and When not to use columns, a variants guide naming only real option
    values, and DO and DON'T cards with a reason on every card; the
    Specifications frame fills the Properties description column and draws
    the States matrix with no table under it; the Accessibility frame shows a Keyboard
    table with key chips, Pointer, Semantics and Content. No part, property,
    option or state name appears that the component does not have (compare
    against the Figma layers and properties). The quota meter shows
    `X-Tier: free` usage moved by one.
26. **AI writing on, Pro plan.** Repeat row 25 with an active Pro key.
    Expected: the same sections fill, the quota meter reads unlimited, and a
    second generation of the same unchanged component completes without the
    meter moving (the proxy replays the stored answer). The prose is written
    by Claude Sonnet 5; the canvas cannot show which model wrote it, so the
    proxy log (`wrangler tail`) is the evidence: the forwarded request names
    `claude-sonnet-5` with `output_config.effort` `low`.
27. **Rebuild with AI writing on.** Open a Library that holds a document
    built by 5.1.0 whose Keyboard section has hand-edited bullets, turn AI
    writing on, and press Rebuild on the row marked "Rebuild needed".
    Expected: the row's note reads "Frames are rebuilt in the new layout.
    Your written sections are kept. Keyboard is rewritten when AI writing is
    on."; after the rebuild, Overview, Semantics and the DO and DON'T cards
    keep the old text word for word, When to use and the Properties
    descriptions appear for the first time, and the Keyboard table is
    rewritten as chips. With AI writing off, the same rebuild keeps every
    old section and adds nothing.
28. **Foundation overview is stored and drawn.** Build a colour collection
    with AI writing on. Expected: the group lines render as before, and one
    paragraph under 400 characters sits under the header band at the prose
    measure; the document's stored link carries the same text as
    `collectionOverview`. Editing the paragraph on canvas turns the Library
    row to "Edited".
29. **One overview per collection.** Build two collections in one run with AI
    writing on. Expected: each document carries its own paragraph under the
    header, the two paragraphs differ, and each stored link's
    `collectionOverview` matches its own frame.
30. **Overview without colour groups.** Build a collection holding only
    number variables with AI writing on. Expected: an overview paragraph is
    drawn and there are no group lines, since there are no colour groups.
31. **Reference chips.** In a collection where one variable defines a Web
    code syntax and another defines Web and iOS, build the doc. Expected:
    one chip per defined platform under those two names, with the exact
    identifiers Figma shows in the variable's settings; every other variable
    has no chip.
32. **Scales drawn to scale.** Build a collection holding one number
    variable per scope: gap, corner radius, stroke, opacity (a value between
    0 and 1), font size, line height, letter spacing, plus one with a gap
    value wider than its cell. Expected: each cell draws its glyph above the
    value at the true size (measure the bar and the radius square against a
    Figma ruler), the wide bar ends in a tick, and a variable scoped to all
    scopes shows the plain value only.
33. **Type specimens.** Build the Text styles doc for a file with a 48px
    style and a style bound to a size token. Expected: "The quick brown fox
    jumps over the lazy dog" set in each style at its true size, wrapping
    to the column; the metrics line matches Figma's inspector for that
    style; the bound size shows its token chip.
34. **Effect specimens.** Build the Effect styles doc for a file with a drop
    shadow style, an inner shadow style and a background blur style.
    Expected: the shadows fall on the tinted pane, the blur has a checkered
    backdrop behind its card, and each layer line matches the inspector.
35. **Effect row copy and library.** Click the copy icon on the Effect styles
    row and paste. Expected: a DTCG document with only `sets["Effect
    styles"]` plus the collections its bound tokens need. In My Library the
    row shows the effect glyph and reads "Effect styles".
36. **Pre-6.0.0 foundation doc.** Open a file holding a foundation doc built
    by 5.1.0. Expected: the row reads "Update available" and its change list
    carries one "New layout" item; Update renders the new layout and keeps
    the group lines and overview.

Rows 16 to 24 were added on 2026-09-17 for Docs 2.0 Plan 1, rows 25 to 28
on 2026-09-18 for Plan 2, and rows 29 to 36 on 2026-09-19 for Plan 3. None
of rows 16 to 36 have been run. Before running them, open Plugins,
Development, Figma Desktop Bridge so the before and after screenshots can be
captured for the review record.

## Library

1. Generate two or three component and Foundation Sections. Confirm Library
   lists every connection with its source and page name and correct filter
   counts.
2. Use **View this doc on canvas** and, for a component, **View source
   component**. Confirm each focuses the intended object.
3. A fresh document reports **In sync**.
4. Change a source and refresh Library. Confirm **Update available**, then run
   **Update this doc** and verify replacement in place and a return to
   **In sync**.
5. Edit text in a writing section (the definition, a do or don't, an
   accessibility line, an anatomy part description). Refresh Library and
   confirm the row still reads **In sync**. Change the source, run **Update
   this doc**, and confirm the rebuilt frame keeps your edited text
   word for word, bold included, while its tables reflect the source change.
   Duplicate a do row before updating and confirm the extra row survives.
   Then edit a generated cell (a token table value). Confirm **Manually
   edited**, the confirm that says generated edits are replaced and writing
   sections are kept, and that an accepted Update replaces the cell edit and
   keeps the writing sections. Run **Copy for AI** on the edited doc and
   confirm the brief carries the edited text. Separately, edit an anatomy
   part description on its own (including a part whose name contains a
   colon, if the component has one) and confirm it survives an Update word
   for word: anatomy has the most fragile read-back rule of any slot.
6. Delete a source component or remove a documented Foundation scope. Confirm
   **Source missing** and that Update and **Copy for AI** are not offered.
7. Run **Copy for AI** on in-sync, update-available, and manually edited
   component rows. Each copy must say `kind: component`, `version: 5`, and
   `profile: ai`; read the live source; include saved AI guidelines when
   present; and leave the Section and link data unchanged. Every binding must
   carry a stable `source_id`. The embedded Foundation block must contain only
   referenced variables/styles and their complete local alias dependencies,
   while `foundation_hash` matches a whole-file Foundation copy from the same
   read. A rule used once carries `path`; otherwise-identical rules used on
   multiple nodes carry one ordered `paths` list with every exact path.
8. Run **Copy for AI** on a split or grouped Foundation row. Confirm the copy
   is the same DTCG resolver document shape as the file-wide copy, widened to
   the complete collection and all modes, with sets or modifiers for only that
   collection and any additional ones required by transitive local aliases. A
   text-style row's `sets["Typography styles"]` covers every requested style
   plus only its bound-token dependency collections, with no `sets["Effect
   styles"]` and no unrelated collection.
9. Confirm Update and Copy do not disturb the selection or settings on the
   Selected component screen.
10. **Detach this doc** first asks for confirmation in a dialog inside
    the panel. Confirm the dialog follows the current theme, Cancel leaves the
    row unchanged, Escape closes the dialog without also leaving the screen
    underneath, a click on the dimmed backdrop cancels, and focus returns to
    the row menu button afterwards. Accepting leaves the canvas Section in
    place while removing its Library connection. **Delete this doc** asks
    the same way and deletes the doc’s Section, and everything in it, only on accept. Also confirm that
    **Update this doc** on a row marked **Manually edited** shows its
    confirmation, and that **Update all** with an edited row shows one
    confirmation naming how many documents have hand edits.
11. Close and reopen the plugin. Library must survive because connections live
    in the document, not only on the device.
12. **Review detected changes** lists what changed. Generate a component doc
    and a Foundation doc. In the source component, change one bound token
    (rebind a fill to a different variable), one unbound value (a hardcoded
    padding number), and one variant value (rename an option). In the
    Foundation source, change one variable value in one mode. Refresh
    Library. Each row reads **Update available**. Open **Review detected
    changes** on each: the panel says "Comparing…" briefly, then lists each
    edit exactly once with its before and after value, spelled "changed to",
    under the right group (Tokens, Unbound values, Variants for the
    component; Tokens for the Foundation). The rebound fill is one Tokens
    item, not a "Removed" line plus several "Added" lines: the first line
    reads "Part / fill: old changed to new" and a quieter second line reads
    "1 of N variants:" followed by the axis values of the variant you edited,
    with axes left at their default collapsed to "others at default". The other
    variants of the same part are not mentioned, and no token name repeats
    within one line. No item names anything you did
    not change. Run **Update this doc** and confirm the row returns to
    **In sync** and the panel is no longer offered.
13. A doc generated before this build shows "Source changed" with "Update
    this doc once to enable change lists." To produce one on a fresh file,
    generate the doc with the currently published plugin build, then open the
    same file with this development build and refresh the Library. Run
    **Update this doc**, change the source again, refresh, and confirm
    the list now appears.
14. In Settings > Export choose **Markdown**. Run **Copy for AI** from the
    component screen's footer and from a component row's menu, and paste each
    into a plain text editor. Each opens with `---` and `spec_layer:` over
    `kind: component` and `profile: markdown`, then `# <component name>`, and
    the toast reads "Copied as Markdown." followed by the usual caveats. Choose
    **YAML** again: the toast reads "Copied as YAML." and the payload is the
    same YAML brief as before this build.
15. With Markdown chosen, run **Copy for AI** on a Foundation row and on the
    Foundations screen. Both still copy the DTCG JSON document, and the toast
    still begins "Copied." and names no format.

## AI-writing allowance (free plan)

1. With AI enabled and no Pro key, confirm the header shows remaining free
   uses and the ring reflects the state.
2. Confirm the allowance offers **Upgrade** and License owns activation.
3. Exhaust the free quota or simulate it. Confirm the header reads **No free
   uses left** and offers **Upgrade** while the ordinary **Create docs** action
   remains available.
4. Click **Create docs** with AI writing selected. The build must complete with
   deterministic documentation, omit AI prose, and report the exhausted
   allowance without trapping the user in a dead-end footer state.

## License

1. Paste a Pro license key and click **Activate**. Confirm the plan card reads
   **Pro plan** with an **Active** badge, the header reads **Pro plan active**,
   and the connection persists across reopen.
2. An invalid or expired key shows the matching status; an expired key offers
   **Renew Pro**.
3. Click **Upgrade** from the free allowance and **Renew Pro** from the expired
   state. Both must open
   `https://speclayer-docs.lemonsqueezy.com/checkout/buy/077cd029-d066-4d03-9e12-4ec25a114ba6`.
4. **Remove key from this device** deactivates the device and returns the UI to
   the free plan.
5. **Manage subscription** opens the billing portal.
6. If the proxy is unreachable, the saved key remains and the UI reports a
   temporary verification problem rather than falsely marking it expired.

## Publish and pull

Publishing lives on its own screen now, behind the Library footer's **Publish**
action. The rows below start there.

- [ ] Reaching it: the Library footer shows three buttons that fit without
      wrapping in the widest state (trigger a failed source check so the primary
      reads "Refresh to retry"). **Publish** stays enabled during a refresh and
      during Update all docs, unlike the two beside it.
- [ ] The screen: **Publish** opens "Publish" with the rail still
      on Library. The back control and Escape both return to the list, and the
      list is where it was, not scrolled. Leaving by the rail and returning to
      Library lands on the list, not the publish screen.
- [ ] Publish (Pro license, file with foundation + 2 component docs): the footer
      reports "Collecting sources" then "Uploading library" while it runs and
      the primary reads "Publishing…"; a toast reads "Published. Anyone with
      the key can pull this version."; the screen then shows the **Published**
      pill, a Last published line with the local date and time, and the
      Developer setup and AI agent setup blocks with their full text visible
      and a **Copy** each. Response arrived in under 30s.
- [ ] Pull: run the copied setup command in an empty directory; `.speclayer/`
      contains bundle.json, manifest.json, ai/foundation.yaml, and one YAML per
      component; the YAML matches what Copy for AI puts on the clipboard.
- [ ] Stored key: run the copied setup command in an empty directory inside a
      git repository. The output names speclayer.json, the .gitignore entry and
      the stored key, and never prints the key itself. `git status` shows no
      untracked speclayer.local.json. `spec-layer pull` and `spec-layer status`
      then both work with nothing in the environment.
- [ ] Stored key, no git: run the same command in a directory that is not a git
      working tree. It stores the key, says it left .gitignore alone, and pulls.
- [ ] Agent next step: after a successful setup the output ends by naming
      `npx spec-layer skill --install` and, when the directory holds a `.claude`
      directory, the path `.claude/skills/spec-layer/SKILL.md`. Running it
      writes that file; the file lists every pulled component with its path,
      the token collections with their modes, and carries no key. A second run
      reports the file unchanged.
- [ ] AI agent setup: the block shows the full numbered message under its own
      **Copy**, below the Developer setup block and above **Rotate pull key**, is
      present on a free plan, and Copy puts on the clipboard a
      numbered message whose first command is `npx --yes spec-layer setup` with
      the same id and key as the setup command, followed by
      `npx --yes spec-layer skill --install`. Pasting the message into a coding
      agent in an empty git repository ends with `AGENTS.md` written.
- [ ] Markdown setup: with Markdown chosen in Settings > Export, both setup
      blocks end their setup line with `--component-format md`, and each
      **Copy** puts exactly that on the clipboard. With YAML chosen the line
      carries no flag. Run the Markdown command in an empty directory once
      `spec-layer@0.10.0` or later is `latest` on npm (check with `npm view
      spec-layer version`); before that, run `npx spec-layer@0.10.0 setup ...`
      in place of `npx spec-layer setup ...`. `speclayer.json` carries
      `"componentSpecsFormat": "md"` and `component-specs/` holds one `.md`
      page per component.
- [ ] Format switch: in that repository a plain `npx spec-layer pull` reports
      up to date; `npx spec-layer pull --component-format yaml` removes the
      `.md` pages and writes `.yaml`; `npx spec-layer show component Button
      --component-format md` prints the page; `--canonical` still prints JSON;
      `npx spec-layer show foundation --component-format md` refuses with
      "--component-format applies to components. The Foundation prints as its
      DTCG document."
- [ ] Same page both ways: open Foundations once so the plugin has read them,
      publish, and change nothing. With Markdown chosen, **Copy for AI** on a
      component's Library row must match that component's pulled
      `component-specs/<slug>.md` byte for byte. Use the Library row, not the
      component screen: the screen copies without saved guidelines, so it never
      matches a pull of a document that has them.
- [ ] Stored key, already tracked: after the no-git run above, `git init` in
      that directory, then `git add -A && git commit -m tracked` so
      speclayer.local.json is tracked. Re-paste the setup command: it refuses,
      says the entry is in .gitignore but git still does not ignore the file,
      names `git rm --cached speclayer.local.json`, and the stored key is
      unchanged. Run that command, re-paste again, and it stores the key.
- [ ] Stored key after a rotation: rotate in the plugin, then run
      `spec-layer pull` in the directory holding the old stored key. It fails
      with the message pointing back at the setup command. Re-pasting the new
      setup command reports that it replaced the stored key, and the next pull
      succeeds.
- [ ] Republish after editing a token: `spec-layer status` exits 2 and names
      the new publish time; `spec-layer pull` then `status` exits 0.
- [ ] Rotate pull key: a confirmation asks first on the device that holds the key; after it, the old command fails with the rotated-key message within about
      a minute; new command pulls. While a publish is running, **Rotate pull key**
      is disabled.
- [ ] Two files: publish file A, then open an unrelated file B and publish.
      B gets its own library id and key; pulling A's id still returns A's
      components.
- [ ] Second device (or a second Figma account on the same file): the publish
      screen shows the **Published** pill, the library id, that the key is
      stored on the device that published, and only **Rotate pull key**, with no
      command or prompt block. The Last published line shows the same date the
      first device saw. On the same account, rotating shows a "Pull key rotated."
      toast and both blocks, and the first device's old command then fails. On
      a different Figma account with no license, rotating shows "Only the
      account that published this library can rotate its key." and nothing
      changes.
- [ ] Gone library: publish, then rotate the license key (or publish the same
      file with another Pro license). The screen reports the library is gone
      or belongs to another account, publishes nothing, the pill returns to
      **Not published**, and the next publish creates a new library.
- [ ] Recorded date: publish, close the plugin, reopen it and open Publish. The
      Last published line shows the publish time without a new publish.
      **Read the guide** in the footer opens
      spec-layer.com/docs/quickstart/#publish-pull in the browser.
- [ ] Free plan publish and pull (no license key entered): the screen opens
      with the **Not published** pill and "10 of 10 free publishes left this
      month"; Publish creates a library and shows both blocks; the developer
      command pulls it. Publish again without changes: a toast reads "Nothing
      changed since the last publish.", the line still shows 9, and the Last
      published line keeps the earlier time. Edit a token and publish: the
      line shows 8. Open a second file and publish: the error line names the
      first file and offers Upgrade to Pro.
- [ ] Free plan at the cap: after 10 changed publishes in one month the status
      line names the reset date and Publish stays enabled.
- [ ] Lapsed Pro key with a library published while Pro: Publish updates it
      and the meter appears; Rotate pull key works.
- [ ] Broken source: delete a doc's source component, publish; the error names
      the component and nothing was published.
- [ ] First version: a file with a Foundation doc and two component docs,
      never published. Open Publish; the Version block reads "Not versioned
      yet" with First version prefilled 1.0.0. Type `2.0` and see "Use three
      numbers, like 1.0.0."; restore 1.0.0. The primary reads "Publish 1.0.0".
      Publish; the toast names 1.0.0; the meta line reads "Version 1.0.0,
      published <local date>"; every group frame header and the Foundation card
      header carries a pill reading `v1.0.0 · Published`, right of the
      eyebrow and left of the logo when one is set.
- [ ] Hand-edit detector stays quiet: after that publish, open the Library;
      every row reads In sync, none reads Edited. Run Update on one doc; the
      pill is still `v1.0.0 · Published` and the row is still In sync.
- [ ] Changed since: add a variant option to one component. Update its doc;
      its pill reads `v1.0.0 · Changed since`; the other docs keep
      `Published`. Move a group frame's header by hand, then Update again; the
      pill repaints where the header now sits.
- [ ] Proposal and raise: open Publish. The meta line reads "Version 1.0.0,
      published <date>". The block reads "Next version 1.1.0" and "Minor: 1
      addition" and nothing about the current version; the control shows
      Patch, Minor, Major with Patch disabled, and hovering Patch shows "The
      changes need at least a minor bump." Minor is checked. Choose Major; the
      block reads "Next version 2.0.0" and "Major, raised from minor: 1
      addition", the primary reads "Publish 2.0.0", and the screen does not
      jump to the top. Type a note. Publish; every pill now reads
      `v2.0.0 · Published`.
- [ ] Variant, not removals: the addition above was a whole variant with its
      own token bindings. The reason must say "1 addition" and never a
      removal, and the change list in the next row must not list any binding
      of the variants that already existed.
- [ ] History: open Version history from the block. Two rows, v2.0.0 first
      with a "Major" badge that is not cropped and whose tooltip reads
      "Something was removed or renamed. Code that used it may break.", the
      date, and the note on one line; v1.0.0 with "First version". Click the
      date side of the v2.0.0 row, not the badge: the whole row is the
      control and it opens. One card named after the component lists "Option
      <name> added to <axis>"; no other card and no bindings of existing
      variants. Back
      returns to Publish; Escape from history returns to Publish, and again
      to the list.
- [ ] Nothing changed: publish again without editing; the toast reads
      "Nothing changed since the last publish." and the version stays 2.0.0.
- [ ] Pull prints the version: run `spec-layer pull` in the developer
      directory; the line ends `(v2.0.0, published <date>)`; `spec-layer
      status` reads "Up to date (v2.0.0, …)"; `spec-layer list` names v2.0.0.
- [ ] Second device (no key): open Publish in the same file from another
      account; the Version block says the dry run could not run or the
      history says the key is on the publishing device; nothing claims a
      version it did not fetch.
- [ ] Pre-versioning library: a library published before this build. Open
      Publish; the block says the library has no version yet and the next
      publish creates 1.0.0. Publish; pills appear at v1.0.0.
- [ ] Deploy order: before releasing the plugin, confirm the deployed proxy
      answers a dry run (`curl -X POST https://api.spec-layer.com/v1/libraries
      -H 'X-Figma-User: probe' -H 'content-type: application/json' -d
      '{"bundle":<a minimal bundle>,"dryRun":true}'` returns a body with
      `proposedVersion` or `unchanged`). Against a proxy that predates dry
      runs the plugin would publish for real on every open of the Publish
      screen.

## Download skill

The download is a blob save from the plugin iframe. Nothing in the unit suite
can reach it, and it is the one step that decides whether the feature works at
all.

1. Open **Publish** from the Library footer. The **Download a snapshot** block
   is present whether or not this file has ever been published.
2. Press **Download snapshot (.zip)**. Confirm a file saves, named after the
   Figma file, and that the button is disabled while the collect runs.
3. Repeat in the browser version of Figma as well as the desktop app. A
   sandboxed iframe can refuse a download in one and allow it in the other.
4. Unzip into `.claude/skills/` in a scratch repository. Confirm
   `spec-layer/SKILL.md` sits beside `components/` and `tokens/`, and that
   every file `SKILL.md` names exists.
5. Open the repository with a coding agent. Confirm it finds the skill and
   reads the right component file when asked to change that component.
6. On a file with no Foundation read, confirm the zip carries no `tokens/`
   folder and that `SKILL.md` says the foundation was not read, rather than
   describing tokens that are not there.
7. Run `npx spec-layer skill --install` in that same repository. Confirm it
   prints the line naming the now stale `components` and `tokens` folders.
8. In Settings > Export choose **Markdown**, then download. The block's line
   reads "Components export as Markdown." The zip holds
   `components/<slug>.md` and no `.yaml`; every file `SKILL.md` names exists,
   and its step 1 names **Properties**, **Anatomy**, **Token bindings** and
   **Unbound values**. `tokens/` and `fonts.json` are byte-identical to a YAML
   download of the same file.
9. **Change this in Settings** opens Settings on the Export tab.

## Settings, search, keyboard, and visuals

1. Test every frame-theme preset. **Custom** reveals color and font controls;
   other presets hide them. Logo remains available in every mode.
2. Test valid, empty, and invalid custom colors, the native color picker, font
   search/fallback, and generated component and Foundation Sections.
3. Attach and remove a logo. Confirm an oversized logo is rejected clearly.
4. Global search: opening it with no query lists recent component docs, newest
   first, and no workflow rows. Typing matches component and foundation docs by
   name and by source, and the panel does not flash or jump as each letter is
   typed. Enter and a click both open the Library, scroll to that
   document's row, mark it, and leave focus on the row; the mark survives the
   source checks that follow and clears on Refresh, a filter change, and
   leaving the Library. A file with foundation docs but no component docs says
   so rather than reporting no matches.
5. Tab and Shift+Tab reach every input and action logically. Focus remains
   visible in light and dark Figma themes.
6. Reduced-motion mode avoids nonessential animation. Errors remain visible
   and retryable.
7. On a fresh launch of the plugin, Settings opens on **Frames**, with
   **Export** and **About** beside it; within a session it reopens on the last
   tab chosen. Each tab shows only its own content, the strip stays in place
   while the panel scrolls, and About shows both versions and the Documentation
   link. With focus on a tab, Left and Right move and select, wrapping at the
   ends, and Home and End go to the first and last; Tab moves into the panel,
   not to the next tab. Open a font list on Frames, then choose Export: the
   list closes.
8. **Export** shows **Component format** on YAML. Choose Markdown, close the
   plugin and reopen it: Markdown is still chosen. The arrow keys move the
   choice.

## Automated checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run lint
npm run build:plugin
npm run check:proxy-dry-run
npm run audit
```

## Release gate

`packages/plugin/package.json` is the plugin's in-repo version source; the
build stamps it into each connected document as `pluginVersion` via
`__PLUGIN_VERSION__`. The Figma-published version should match it.

Repository builds target `https://api.spec-layer.com` in both
`packages/plugin/src/ui/proxy.ts` and `packages/plugin/manifest.json`. Before a
public production build, verify those locations remain aligned, build again,
and rerun this checklist.

`spec-layer@0.10.0` or later must be the `latest` on npm (`npm view
spec-layer version`) before a plugin build whose setup command can carry
`--component-format md` reaches the Figma listing. CLI 0.9.0 does not know the
flag: it prints its usage and exits 1.

Use only synthetic or publishable Figma files in screenshots, fixtures, and
bug reports.

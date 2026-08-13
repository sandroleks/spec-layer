# Plugin UI design system

The production design system lives in
`packages/plugin/src/ui/design-system/` and does not require React. This
directory preserves the original documentation paths, but its CSS and
TypeScript files are compatibility entry points that import or re-export the
production source. Do not copy changes back into this directory.

## Files

- `tokens.css`: compatibility import for production semantic tokens.
- `components.css`: compatibility import for production primitives.
- `patterns.css`: compatibility import for production workflow composition.
- `index.css`: canonical import order for the three CSS layers.
- `contracts.ts`: compatibility re-export of the production presentation
  contracts.
- `component-markup.md`: accessible HTML structures for the current DOM
  renderer.

## Import order

Use `index.css`, or preserve its import order when the CSS is embedded.

The production plugin emits one embedded HTML file. `packages/plugin/build.mjs`
embeds the three production CSS layers in this order.

## Theme contract

Set one of these attributes on `body`:

```html
<body data-theme="dark">
<body data-theme="light">
```

The current `theme.ts` already manages this attribute. Components consume only
semantic `--sl-*` roles and should never branch on theme in component CSS.

## Naming

- `sl-` is the global prefix.
- `is-*` is a visual state class derived from real state.
- `data-*` attributes describe variants and workflow state.
- `aria-*` attributes remain the source of truth for accessible state.

Prefer selectors driven by native state:

```css
.sl-button:disabled
.sl-checkbox-input:checked + .sl-checkbox-box
[role="switch"][aria-checked="true"]
[aria-expanded="true"]
```

Use `is-*` only where no native or ARIA state describes the visual condition.

## Type contract

Steps are named for the **role** they serve, not their position in a sequence:

| Token | px | Role |
| --- | --- | --- |
| `--sl-font-size-micro` | 8 | keyboard hints, smallest badges |
| `--sl-font-size-caption` | 9 | hints, counts, secondary `<small>` |
| `--sl-font-size-support` | 10 | metadata, help text, chips |
| `--sl-font-size-control` | 11 | buttons, control labels, row titles |
| `--sl-font-size-body` | 12 | base body copy |
| `--sl-font-size-section` | 14 | section headings |
| `--sl-font-size-display` | 20 | screen h1 |

The role names exist because the bug they replaced was **the same role rendering
at a different size on each screen** — a button label was 10px, 10.5px, or 11px
depending on which screen it sat on, and a row title was 10.75px, 11px, or
11.5px. Asking "what size is a button label?" must have exactly one answer.

Whole pixels only. The previous values ran to quarter-pixel steps (8.75, 9.25,
10.75) where no adjacent pair was distinguishable. There is deliberately no 16px
step: nothing needs one, and a role name without a consumer is how the old dead
`.sl-type-*` utilities started.

Weights are `regular` 450, `medium` 560, `semibold` 650, `bold` 720 — four, not
the twelve that existed before (610 / 620 / 640 are not distinguishable).
**Always set a weight on `<strong>`**: with no rule it inherits the UA default of
700, which is not a token.

Line heights are `none` 1 (single-line controls that centre their own text),
`tight` 1.15, `control` 1.25, `body` 1.4.

Tracking is `display` -0.035em, `tight` -0.01em, `caps` 0.045em, `caps-wide`
0.07em. Small uppercase labels need positive tracking to stay readable; large
text needs negative tracking to stop looking loose.

## Spacing contract

The spacing scale is **2px-stepped, not 4px**: with 24/28/34px control heights,
4px steps cannot express the difference between a tight and a comfortable row.
Step names are the pixel value, so `--sl-space-6` is 6px — there is no ordinal
indirection to remember.

```
0  2  4  6  8  10  12  14  16  20  24  32
```

8px is the anchor. Use a named step for any rhythm spacing: `gap`, `padding`,
`margin`. Two categories are deliberately **not** on the scale and stay literal
in the pattern layer:

- **Optical nudges** — the 1px `margin-top` that aligns an icon or caption to a
  text baseline, and the `-1px` clip in `.sl-sr-only`. These answer to the
  glyph, not the rhythm.
- **Computed layout** — footer scroll clearance (`68px`, `76px`) and the
  nested-row indents (`36px`, `40px`, `63px`) that align to a control column.
  These must track the thing they align to; snapping them to the rhythm would
  break the alignment they exist to create.

When you add a value, take the nearest step rather than inventing one. If no
step fits, the value probably belongs to one of the two categories above — say
which, in a comment.

## Icon contract

**One button, one glyph** — it names the act the button performs, and never
changes with the button's state.

The failure this fixes was never "primaries have icons". It was one slot holding
three different *categories* as its state changed: the Library primary drew
`refresh` while idle, `alertCircle` when source checks had failed, and `check`
when there was nothing to do — an action, then a warning, then a status, in one
button. Dropping the glyph made that slot honest but left every footer
half-drawn, one button with a pictogram beside one without.

- **Every footer action carries a glyph, in every state.** A busy or disabled
  button is still the same button, so "Creating docs…", "Up to date" and
  "Select sources to continue" keep the glyph of the act they belong to. State
  belongs in the label and the progress line, not in the glyph.
- **The two primaries are a family:** `filePlus` for making docs (component and
  Foundations) and `fileCheck` for bringing them up to date (Library). Same page
  outline, so they read as one act on one object; the plus and the check are
  what make them acts. Neither reuses `fileDescription` or `layoutGrid` — those
  draw the finished *output*, and are the sidebar's glyphs for those very
  screens, so a footer wearing one repeated the tab already on screen.
- **Conventional pictograms keep their exact meaning:** `refresh` (circular
  arrows) is "re-reads, writes nothing", `download` is an arrow to a tray,
  `externalLink` an arrow out of a box.
- **Tie-break:** when two buttons in one row would claim the same pictogram, it
  goes to the one it matches exactly. Circular arrows are "Refresh library",
  not the "Update all docs" beside it — which is why update needed a glyph of
  its own instead of a second pair of arrows. Two identical glyphs in one row
  read as the same button twice.
- **The same act keeps the same glyph wherever it appears.** A row menu's
  "Update documentation" wears `fileCheck` too, not the `refresh` it used to.
- **This is a property of the act, not of the button.** It says nothing about
  tone: a primary "Download" would keep its arrow.
- **Outside this rule:** a spinner reports work in flight rather than naming an
  act. The license Activate button spins its glyph while checking because that
  form has no progress line; all three footers have one, so their busy buttons
  keep their static glyph.

Sizes are consistency, not principle: leading glyphs in buttons are 15px (they
were mixed 15 and 16 within one row). Elsewhere they answer to their context —
row identity glyphs 17px, overflow-menu items 15px, inline status marks 13–14px.

## Footer actions

Three screens end in the same two-slot footer, so the three had drifted into
naming three different *kinds* of thing in one slot: an output ("Create docs"),
an internal storage unit ("Create 8 frames"), and a batch scope ("Update all
3"). Full copy rules live in `docs/plugin-voice-and-copy.md`; the shape is:

| Screen | Secondary | Primary |
| --- | --- | --- |
| Selected component | `Download` (`download`) | `Create docs` (`filePlus`) |
| Foundations | `Refresh sources` (`refresh`) | `Create docs` (`filePlus`) |
| Library | `Refresh library` (`refresh`) | `Update all docs` (`fileCheck`) |

- **The primary names its action plus the object the user came for** — *docs*,
  on every screen that makes them. A frame is how the foundations screen stores
  a doc, not what anyone asked for.
- **No counts in a button.** The count belongs where the screen already reports
  it: the foundations toolbar ("8 of 12 included") and any row that splits
  ("+ N frames"); the Library's Updates filter. A counting label also changes
  width as the user ticks rows, so the button moves under the cursor.
- **Scope only where two of these could collide** — "Update all docs" in the
  Library footer against "Update documentation" in a row's own menu. Every
  drifted doc versus this one, and they stay separate buttons.
- **Both slots hug and the row sits right.** No `flex` and no `min-width` on a
  footer button. The foundations primary used to take `flex: 1` and stretch the
  width of the footer while the same slot elsewhere hugged.

## Component inventory

Foundations:

- Color roles.
- Type scale (role-named; see Type contract).
- Spacing (2px steps) and radius scale.
- Control heights.
- Motion and focus.

Controls:

- Button.
- Icon button.
- Checkbox and mixed checkbox.
- Radio.
- Switch.
- Selectable chip.
- Segmented control.
- Text, password, and search fields.
- Select.

Feedback:

- Badge.
- Status.
- Banner.
- Toast.
- Skeleton.
- Progress.
- Tooltip.

Containers:

- Card.
- Disclosure.
- Menu.
- Dialog.
- Sticky action footer.

Product patterns:

- Utility header.
- AI allowance.
- Navigation rail.
- Section group.
- Library filter and row.
- Foundation source row.
- Plan card.

## Accessibility baseline

- Every icon-only control has an accessible name.
- Tooltip content is supplemental. The control's name must stand on its own.
- Inclusion controls use real checkboxes.
- Segmented single-selection controls use a radio group.
- Selectable chips use `aria-pressed`.
- Menus use menu semantics only when they provide action commands.
- Dialogs move focus on open, close with Escape, and restore focus.
- Animations respect `prefers-reduced-motion`.

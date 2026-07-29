# Section list visual refinement

## Source visual truth

- Reported Usage issue:
  `codex-clipboard-6539b990-5af6-4560-83d2-154915d84184.png`
  (860 × 606 pixels).
- Reported Specifications issue:
  `codex-clipboard-9aa4c895-c46f-4cf8-bede-fd5d02e2dfe3.png`
  (860 × 732 pixels).
- Original compact nested-control reference:
  `codex-clipboard-132c340e-b6ef-4144-8e55-62551233f811.png`
  (936 × 936 pixels).
- Implementation viewport: 480 × 680 CSS pixels at 1× density.

## Findings and fixes

- P1: applying radius and an expanded shadow to every section row turned the
  separators into rounded card outlines. Rows are flat again; hover changes
  only the background token and does not alter the border geometry.
- P1: `:focus-within` filled the entire row with the accent color after a
  checkbox click. Focus now remains on the actual checkbox/radio control with
  no persistent row fill.
- P2: Anatomy used a large segmented control and Measurements used large
  button chips. Both now use compact inline radio/checkbox choices with the
  original left guide and labels.
- P2: the nested controls consumed too much vertical space. The refined
  controls fit in one quiet line at the native plugin width.

## Evidence

- `01-specifications-inline-controls.png`: dark Specifications state.
- `02-keyboard-focus-without-row-fill.png`: focus remains local to the control.
- `03-usage-flat-rows.png`: flat Usage rows with category actions.
- `04-usage-source-vs-refined.png`: reported Usage issue and refined result in
  one comparison image.
- `05-specifications-source-vs-refined.png`: reported nested-control issue and
  refined result in one comparison image.
- `06-light-inline-controls.png`: light-theme validation.

## Verification

- [x] Anatomy radio choices update and preserve the selected value.
- [x] Measurement checkboxes update independently.
- [x] Keyboard focus no longer paints the full section row.
- [x] Dark and light layouts remain 480 × 680 with no horizontal overflow.
- [x] Inline controls have no internal horizontal overflow.
- [x] Browser warnings/errors: none.
- [x] No Figma bridge was used.

final result: passed

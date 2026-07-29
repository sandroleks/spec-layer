# Section list interactions

## Source

- User reference: `codex-clipboard-f9cb2da1-ef58-4228-820f-5279ca5399e4.png`
- Target viewport: 480 × 680
- Target state: Component documentation, Usage expanded

## What changed

- Each category has a dedicated `Select all` or `Clear all` action.
- Category expansion remains a separate disclosure control, so bulk selection
  does not unexpectedly collapse the category.
- Bulk selection counts only available sections. An unavailable section stays
  disabled and unchecked when its category is selected.
- Available section rows gain a full-row hover surface.
- Keyboard focus uses the same full-row treatment with a stronger accent
  surface. Disabled rows do not receive the hover treatment.

## Evidence

- `01-category-bulk-actions.png`: default dark state with all category actions.
- `02-dark-row-focus.png`: dark keyboard-focus treatment.
- `03-light-category-actions-focus.png`: light category actions and focus
  treatment.
- `04-source-vs-implementation.png`: source and implementation in one visual
  comparison.

## Interaction checks

- [x] Usage `Select all` changes 3 of 4 to 4 of 4.
- [x] Usage `Clear all` changes 4 of 4 to 0 of 4.
- [x] Specifications with no detected states selects 4 of 4 available rows and
  leaves States disabled and unchecked.
- [x] Disclosure and bulk controls have separate accessible names and focus
  targets.
- [x] Row hover and focus surfaces do not change layout dimensions.
- [x] Dark and light layouts fit the 480 × 680 viewport.
- [x] No Figma bridge was used.

final result: passed

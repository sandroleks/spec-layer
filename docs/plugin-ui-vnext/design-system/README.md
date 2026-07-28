# Plugin UI design system

This design system is prepared for the existing framework-free plugin iframe.
It does not require React.

## Files

- `tokens.css`: semantic color, type, spacing, shape, control, motion, elevation,
  and layout tokens for dark and light themes.
- `components.css`: reusable primitives and component states.
- `patterns.css`: plugin shell and workflow-level composition.
- `index.css`: canonical import order for the three CSS layers.
- `contracts.ts`: presentation contracts and state names to keep rendering
  exhaustive.
- `component-markup.md`: accessible HTML structures for the current DOM
  renderer.

## Import order

Use `index.css`, or preserve its import order when the CSS is embedded.

The production plugin emits one embedded HTML file. During integration, use the
same order when injecting CSS strings into `dom.ts`.

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

## Component inventory

Foundations:

- Color roles.
- Type scale.
- Spacing and radius scale.
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

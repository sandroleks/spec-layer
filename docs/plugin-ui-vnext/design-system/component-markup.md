# Component markup

These structures are compatible with the current DOM renderer.

## Inclusion checkbox

```html
<label class="sl-choice">
  <input class="sl-choice-input" type="checkbox" checked />
  <span class="sl-checkbox-box" aria-hidden="true">
    <!-- Render the approved check icon from the shared icon source. -->
  </span>
  <span class="sl-choice-copy">
    <strong>Overview</strong>
  </span>
</label>
```

For a mixed checkbox, set the native `indeterminate` property in JavaScript and
add `data-mixed="true"` to the input for styling.

## AI writing switch

```html
<label class="sl-switch-control">
  <span class="sl-choice-copy">
    <strong>AI writing</strong>
  </span>
  <span>
    <input
      class="sl-switch-input"
      type="checkbox"
      role="switch"
      aria-label="AI writing"
      checked
    />
    <span class="sl-switch-track" aria-hidden="true">
      <span class="sl-switch-thumb"></span>
    </span>
  </span>
</label>
```

## Measurement chip

```html
<button class="sl-chip" type="button" aria-pressed="true">
  <!-- Approved check icon -->
  Height &amp; width
</button>
```

## Segmented control

```html
<div class="sl-segmented" role="radiogroup" aria-label="Show anatomy as">
  <button type="button" role="radio" aria-checked="true">Diagram</button>
  <button type="button" role="radio" aria-checked="false">Table</button>
  <button type="button" role="radio" aria-checked="false">Both</button>
</div>
```

## Sidebar item and tooltip

```html
<div class="sl-sidebar-item" data-tooltip-trigger>
  <button
    class="sl-icon-button"
    type="button"
    aria-label="Generate component docs"
    aria-current="page"
  >
    <!-- Approved document icon -->
  </button>
  <span class="sl-tooltip" role="tooltip">Generate component docs</span>
</div>
```

The tooltip uses inverse tokens and does not inherit the page foreground.

## AI allowance

Use a real SVG progress ring. `r="10"` produces a circumference of
approximately `62.832`. That geometry is viewBox-space and does not change with
the ring's rendered size, which is `20px` in the header.

`strong` and `small` render as one baseline-aligned row, not a stack. The
separator between them is drawn by CSS, so neither element should contain one.
An empty `small` collapses the row to a single line, which is how the `pro`
state renders. The control has no resting border or fill; it paints a surface on
hover only.

The ring and the Pro check share one `.sl-allowance-status` cell so the control
keeps three grid columns in every state. Both are always in the DOM;
`[data-state="pro"]` decides which one paints.

```html
<button
  class="sl-ai-allowance"
  data-state="normal"
  type="button"
  aria-label="AI writing: 4 of 5 free uses remaining. Open License."
>
  <span class="sl-allowance-status">
    <svg class="sl-allowance-ring" viewBox="0 0 26 26" aria-hidden="true">
      <circle data-track cx="13" cy="13" r="10"></circle>
      <circle
        data-value
        cx="13"
        cy="13"
        r="10"
        stroke-dasharray="62.832"
        stroke-dashoffset="12.566"
      ></circle>
    </svg>
    <span class="sl-allowance-pro-mark" aria-hidden="true"><!-- check icon --></span>
  </span>
  <span class="sl-allowance-copy">
    <strong>AI writing</strong>
    <small>4 of 5 free uses left</small>
  </span>
  <span class="sl-allowance-action">Upgrade</span>
</button>
```

## Library overflow menu

```html
<div class="sl-menu" role="menu" aria-label="Actions for buttonPrimary">
  <button class="sl-menu-item" role="menuitem">Update documentation</button>
  <button class="sl-menu-item" role="menuitem">Open documentation frame</button>
  <button class="sl-menu-item" role="menuitem">View source component</button>
  <span class="sl-menu-separator" role="separator"></span>
  <button class="sl-menu-item" data-tone="danger" role="menuitem">
    Remove connection
  </button>
</div>
```

Return focus to the overflow trigger when the menu closes.


---
spec_layer:
  kind: component
  version: 5
  profile: markdown
  content_hash: sha256:c040465fd51c44d110c00540ea5b356abe5d373f30e8a7acdfd97ceddf01ca9c
  foundation_hash: sha256:c94a75e9f0d78969dcd512ea58b367370ed1790c733e780e62fb481a9aa5afcb
  source: { provider: figma, file_name: Reference Design System }
source: { node_id: 20:100, node_name: Button, component_key: ref-button }
---

# Button

Triggers an action in place. Pick the visual weight with Style and the footprint with Size.

Related: Icon

## Overview

*Written by AI from the extracted facts, not read from Figma.*

A button triggers an action in place, such as saving a form or confirming a choice.

Its visual weight tells people which action the view expects next, so keep one leading
action per view and let the rest sit quieter.

## Properties

| Property | Type | Options | Default |
|---|---|---|---|
| Size | Variant | Medium, Large | Medium |
| Style | Variant | Filled, Outlined | Filled |
| Show icon | Boolean |  | true |
| Label | Text |  | Button |

States: hover, disabled

## Anatomy

*Written by AI from the extracted facts, not read from Figma.*

The component itself is the container: it carries the fill or border, the corner radius,
the padding and the gap. Inside it sit an icon slot and a text label.

- icon-slot: `Container/icon-slot`, frame
  - icon: `Container/icon-slot/icon`, instance of Icon
- label: `Container/label`, text

## Layout

Default variant.

| Part | Layout |
|---|---|
| `Container` | horizontal, padding 8/12/8/12, gap 8, radius 8 |
| `Container/icon-slot` | horizontal, padding 2/2/2/2 |

## Token bindings

| Part | Property | Token | When |
|---|---|---|---|
| `Container` | padding-x | space/300 | Size: Medium |
| `Container` | padding-x | space/400 | Size: Large |
| `Container` | padding-y | space/200 | Size: Medium |
| `Container` | padding-y | space/300 | Size: Large |
| `Container` | fill | color/action/primary | Style: Filled; hover: False; disabled: False |
| `Container` | fill | color/action/primary-hover | Style: Filled; hover: True |
| `Container` | fill | color/action/disabled | Style: Filled; disabled: True |
| `Container` | border-radius | radius/control |  |
| `Container` | gap | space/200 |  |
| `Container` | effects | Elevation/1 | Style: Filled; hover: True |
| `Container` | border | color/border/subtle | Style: Outlined |
| `Container/icon-slot/icon` | fill | color/text/on-action | Style: Filled |
| `Container/icon-slot/icon` | fill | color/action/primary | Style: Outlined; disabled: False |
| `Container/icon-slot/icon` | fill | color/action/disabled | Style: Outlined; disabled: True |
| `Container/label` | fill | color/text/on-action | Style: Filled |
| `Container/label` | fill | color/action/primary | Style: Outlined; disabled: False |
| `Container/label` | fill | color/action/disabled | Style: Outlined; disabled: True |
| `Container/label` | typography | Label/Large |  |

## Tokens used

Foundation: collections complete, styles partial.

### Color

Modes: Light (default), Dark.

| Token | Type | Light | Dark | Code syntax |
|---|---|---|---|---|
| brand/200 | color | #bac8ff | #bac8ff | WEB `--brand-200` |
| brand/300 | color | #91a7ff | #91a7ff | WEB `--brand-300` |
| brand/600 | color | #3b5bdb | #3b5bdb | WEB `--brand-600` |
| brand/700 | color | #364fc7 | #364fc7 | WEB `--brand-700` |
| neutral/0 | color | #ffffff | #ffffff | WEB `--neutral-0` |
| neutral/200 | color | #e9ecef | #e9ecef | WEB `--neutral-200` |
| neutral/400 | color | #adb5bd | #adb5bd | WEB `--neutral-400` |
| neutral/700 | color | #495057 | #495057 | WEB `--neutral-700` |
| neutral/900 | color | #212529 | #212529 | WEB `--neutral-900` |
| color/action/primary | color | Color/brand/600 @ Light (resolved: #3b5bdb) | Color/brand/300 @ Dark (resolved: #91a7ff) | WEB `--color-action-primary` |
| color/action/primary-hover | color | Color/brand/700 @ Light (resolved: #364fc7) | Color/brand/200 @ Dark (resolved: #bac8ff) | WEB `--color-action-primary-hover` |
| color/action/disabled | color | Color/neutral/200 @ Light (resolved: #e9ecef) | Color/neutral/700 @ Dark (resolved: #495057) | WEB `--color-action-disabled` |
| color/text/on-action | color | Color/neutral/0 @ Light (resolved: #ffffff) | Color/neutral/900 @ Dark (resolved: #212529) | WEB `--color-text-on-action` |
| color/border/subtle | color | Color/neutral/400 @ Light (resolved: #adb5bd) | Color/neutral/700 @ Dark (resolved: #495057) | WEB `--color-border-subtle` |

### Spacing

Modes: Default (default).

| Token | Type | Default | Code syntax |
|---|---|---|---|
| space/200 | dimension | 8px | WEB `--space-200` |
| space/300 | dimension | 12px | WEB `--space-300` |
| space/400 | dimension | 16px | WEB `--space-400` |

### Radius

Modes: Default (default).

| Token | Type | Default | Code syntax |
|---|---|---|---|
| radius/200 | number | 8 | WEB `--radius-200` |
| radius/control | dimension | Radius/radius/200 @ Default (resolved: 8px) | WEB `--radius-control` |

### Typography

Modes: Default (default).

| Token | Type | Default | Code syntax |
|---|---|---|---|
| type/size/label | dimension | 16px | WEB `--type-size-label` |

### Typography styles

| Style | Font family | Weight | Size | Line height | Letter spacing | Paragraph indent |
|---|---|---|---|---|---|---|
| Label/Large | Inter | 600 | Typography/type/size/label (resolved: 16px) | 24px | 0px | 0px |

### Effect styles

| Style | Mode | Effects |
|---|---|---|
| Elevation/1 |  | drop\_shadow, offset 0px/1px, blur 3px, spread 0px, #000000 alpha 0.16 |

### Foundation issues

- warning: The numeric value is kept as a bare number because its scopes \[\] state no unit or more than one, so a consumer cannot use it as a length. (`Radius/radius/200`)

## Unbound values

| Part | Property | Issue | Value |
|---|---|---|---|
| `Container/icon-slot` | padding | hardcoded-value | 2 |

## Variants

*Written by AI from the extracted facts, not read from Figma.*

Two axes vary the look, and two switches record state.

- **Style:** Filled for the single leading action, Outlined for a secondary action.
- **Size:** Medium for most layouts, Large where the button leads a sparse view.
- **hover** and **disabled:** switches rather than one State axis, so each state is a
  condition a binding can name.

## Do and don't

*Written by AI from the extracted facts, not read from Figma.*

### Do

- **Use the Filled style for the single most important action in a view.** Its weight tells people where to go next.
- **Keep labels short and verb first** ("Save", "Add item"). People can then scan the action without reading a sentence.
- **Pair the icon with the label, not instead of it.** An icon on its own needs an accessible name the design file cannot carry.

### Don't

- **Don't place two Filled buttons side by side.** Competing leading actions make it unclear which one matters.
- **Don't use a button for plain navigation.** Screen readers announce links and buttons differently, so use a link (`<a>`) when it only goes somewhere.
- **Don't disable a button without saying why.** A disabled control gives no reason and drops out of the tab order.

## Accessibility

*Written by AI from the extracted facts, not read from Figma.*

### Keyboard

- **Activation:** `Enter` and `Space` both activate a button. A link activates on `Enter`
  alone, which is one reason not to swap the two.
- **Focus:** the design file records no focus state. Add a visible focus ring in code; it
  is required, not optional.

### Pointer and touch

- **Hover:** the hover state only exists for a pointer. Never put information in it that
  a touch or keyboard user would miss.
- **Target size:** the design file records padding and line height, not a final height.
  Check in code that every size stays at least 24 by 24px.

### Screen readers

- **Accessible name:** the visible label is the accessible name. A button that shows only
  its icon needs an explicit label in code, which the design file cannot carry.
- **Disabled:** a disabled button drops out of the tab order, so nobody hears why it is
  unavailable. Say why next to it.

## Interactions

*Written by AI from the extracted facts, not read from Figma.*

- **Hover:** a Filled button moves to `color/action/primary-hover` and lifts with the
  `Elevation/1` shadow. An Outlined button records no hover change.
- **Disabled:** a Filled button moves to `color/action/disabled`; an Outlined button keeps
  its border and moves its label and icon to `color/action/disabled`.
- **Pressed and focus:** neither is recorded. Choose them in code and apply them to every
  button.

## Content considerations

*Written by AI from the extracted facts, not read from Figma.*

- **Verb first:** write the label as an action in one to three words, such as "Save" or
  "Add item", never a bare "OK".
- **Length:** allow for labels to grow by a third in translation.

## Design considerations

*Written by AI from the extracted facts, not read from Figma.*

- **Tokens, not values:** fill, border, radius, padding and gap are all bound to tokens,
  so a change to the foundation reaches every button.
- **The icon slot is the exception:** its 2px padding is a literal, so a spacing change
  will not reach it.
- **One leading action:** two Filled buttons side by side make the leading action unclear.

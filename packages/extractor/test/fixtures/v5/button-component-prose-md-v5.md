---
spec_layer:
  kind: component
  version: 5
  profile: markdown
  content_hash: sha256:81848483eb4d70bfa987cc05b2f354ef0be13b8bc0f022c5f16e2d52d1b52660
  foundation_hash: sha256:4f57a78b751c4e7345b341eb86bf0dd01aad69286331ba658ce26d6fa65e24d1
  source: { provider: figma, file_name: Design System }
source: { node_id: 1:100, node_name: Button, component_key: m3-button }
---

# Button

Material 3 button. Pick the visual weight with the Style property.

Related: Icon

## Overview

*Written by AI from the extracted facts, not read from Figma.*

A button triggers an action in place, such as submitting a form or confirming a choice.

A button is where a decision becomes a change, so its weight tells people which action the
screen expects next. Keep one clearly leading action per view and let the rest sit quieter,
so the choice reads at a glance rather than after a comparison.

## Properties

| Property | Type | Options | Default |
|---|---|---|---|
| Style | Variant | Filled, Outlined | Filled |
| Show icon | Boolean |  | false |
| Label | Text |  | Button |

States: Enabled, Hovered, Disabled

## Anatomy

*Written by AI from the extracted facts, not read from Figma.*

A container holds a text label and an optional icon. The container carries the fill, the
corner radius and the padding, so the label and the icon only have to sit inside it.

- container: `Container/container`, frame
- label: `Container/label`, text
- icon: `Container/icon`, instance of Icon

## Layout

Default variant.

| Part | Layout |
|---|---|
| `Container/container` | horizontal, padding 10/24/10/24, gap 8 |

## Token bindings

| Part | Property | Token | When |
|---|---|---|---|
| `Container/container` | fill | md.sys.color.primary | Style: Filled; State: Enabled |
| `Container/container` | fill | md.sys.color.primary-hover | State: Hovered |
| `Container/container` | border-radius | md.sys.shape.corner.full |  |
| `Container/container` | border | md.sys.color.outline | Style: Outlined |
| `Container/label` | fill | md.sys.color.on-primary | Style: Filled |
| `Container/label` | fill | md.sys.color.primary | Style: Outlined |

## Tokens used

Foundation: collections complete, styles complete.

### Material tokens

Modes: Default (default).

| Token | Type | Default | Code syntax |
|---|---|---|---|
| md.sys.color.primary | color | #6750a4 | WEB `--md-sys-color-primary` |
| md.sys.shape.corner.full | dimension | 999px | WEB `--md-sys-shape-corner-full` |
| md.sys.color.on-primary | color | #ffffff | WEB `--md-sys-color-on-primary` |
| md.sys.color.outline | color | #79747e | WEB `--md-sys-color-outline` |
| md.sys.color.primary-hover | color | #5b438f | WEB `--md-sys-color-primary-hover` |

## Unbound values

| Part | Property | Issue | Value |
|---|---|---|---|
| `Container/container` | gap | hardcoded-value | 8 |
| `Container/container` | padding-x | hardcoded-value | 24 |
| `Container/container` | padding-y | hardcoded-value | 10 |
| `Container/label` | typography | missing-token-binding |  |
| `Container/debug-overlay` | fill | hardcoded-color |  |

## Variants

*Written by AI from the extracted facts, not read from Figma.*

One axis varies the visual weight: Style is either Filled or Outlined. A separate boolean
controls whether the icon shows.

- **Filled**: the single most important action in a view.
- **Outlined**: a secondary action that still needs a clear edge, next to a Filled button or
  alone in a quieter area.

## Do and don't

*Written by AI from the extracted facts, not read from Figma.*

### Do

- **Use the Filled style for the single most important action in a view.** Its weight tells people where to go next.
- **Keep labels to one to three words, verb first** ("Save", "Add item"). People can then scan the action without reading a sentence.
- **Pair the icon with the label, not instead of it.** An icon with no label needs its own accessible name, which this component does not provide.

### Don't

- **Don't place more than one Filled button in the same view.** Competing primary actions make it unclear which one matters most.
- **Don't use a button for plain navigation.** Screen readers announce links and buttons differently, so use a link (`<a>`) when it just goes somewhere.
- **Don't disable a button without explaining why.** A disabled control gives no reason and drops out of the tab order, so use inline validation instead.

## Accessibility

*Written by AI from the extracted facts, not read from Figma.*

### Keyboard

- **Activation:** `Enter` and `Space` both activate a button, while a link activates on
  `Enter` alone. That difference is one reason not to swap the two.
- **Focus order:** the design file does not encode focus order. Confirm in build that the
  button takes focus in reading order.

### Screen readers

- **Accessible name:** the visible label is the accessible name. A button that shows only
  its icon needs an explicit label in code, which the design file cannot carry.
- **Disabled state:** a disabled control drops out of the tab order, so nobody hears why it
  is unavailable. Put the reason next to it instead.

## Interactions

*Written by AI from the extracted facts, not read from Figma.*

- **Hover:** the container fill moves to `md.sys.color.primary-hover`.
- **Pressed:** this component records no pressed state, so choose one in build and apply it
  to every button.
- **Focus:** focus styling is not encoded in the design file. A visible focus ring is
  required, not optional.

## Content considerations

*Written by AI from the extracted facts, not read from Figma.*

- **Verb first:** write the label as an action in one to three words, such as "Save" or
  "Add item", never a bare "OK".
- **Length:** plan for labels that wrap or truncate, and allow roughly 30 to 40 percent text
  expansion in translation.
- **Icon pairing:** when the icon shows, it repeats what the label already says rather than
  carrying half the meaning.

## Design considerations

*Written by AI from the extracted facts, not read from Figma.*

- **Contrast:** keep label-to-background contrast at 4.5:1 or better in both styles,
  including the hover fill.
- **Spacing:** the padding and gap on the container are not bound to tokens, so a change to
  the spacing scale will not reach this component on its own.
- **One leading action:** two Filled buttons side by side make the leading action ambiguous.

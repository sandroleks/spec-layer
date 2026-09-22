---
spec_layer:
  kind: component
  version: 5
  profile: markdown
  content_hash: sha256:4c7e0de66d8d0173202669a5ce10b48f0b0273be8453bf46f6d1ac0b93f1ac47
  foundation_hash: sha256:4f57a78b751c4e7345b341eb86bf0dd01aad69286331ba658ce26d6fa65e24d1
  source: { provider: figma, file_name: Design System }
source: { node_id: 1:100, node_name: Button, component_key: m3-button }
---

# Button

Related: Icon

## Properties

| Property | Type | Options | Default |
|---|---|---|---|
| Style | Variant | Filled, Outlined | Filled |
| Show icon | Boolean |  | false |
| Label | Text |  | Button |

States: Enabled, Hovered, Disabled

## Anatomy

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

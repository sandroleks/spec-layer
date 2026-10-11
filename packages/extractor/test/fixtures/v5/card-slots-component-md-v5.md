---
spec_layer:
  kind: component
  version: 5
  profile: markdown
  content_hash: sha256:e4d84b7ee4d3cbda3af5f132ee5c40c0ae5b25ac13e5bde2f8319c4dda3661b2
  source: { provider: figma, file_name: Design System }
source: { node_id: 40:1, node_name: Card, component_key: synthetic-card-slots }
---

# Card

Groups content about one subject.

Related: Media

## Properties

| Property | Type | Options | Default | Description |
|---|---|---|---|---|
| Size | Variant | Small, Large | Small |  |
| Show footer | Boolean |  | false |  |
| Title | Text |  | Card title |  |
| Content | Slot | List · 1 component not found, only these; exactly 1 item | List | Body of the card. One list or one text block. |
| Actions | Slot |  | Badge (display empty by default) |  |

## Anatomy

- Title: `Container/Title`, text
- Body: `Container/Body`, frame
  - Content: `Container/Body/Content`, slot for `Content`, holds List in the default variant
- Actions: `Container/Actions`, slot for `Actions`, holds Badge in the default variant
- Footer: `Container/Footer`, slot, holds nothing in the default variant, shown when `Show footer` is true
- Media: `Container/Media`, instance of Media

## Layout

Default variant.

| Part | Layout |
|---|---|
| `Container` | vertical, padding 16/0/16/0, gap 12 |
| `Container/Body/Content` | vertical, gap 8 |

## Token bindings

| Part | Property | Token | When |
|---|---|---|---|
| `Container/Body/Content` | gap | space/gap (no_foundation) |  |
| `Container/Media/Image/Photo` | border-top-left-radius | radius/md (no_foundation) | Size: Small |

## Tokens used

Token values are not included: the foundations had not been read when this was exported.

## Unbound values

| Part | Property | Issue | Value |
|---|---|---|---|
| `Container` | gap | hardcoded-value | 12 |
| `Container` | padding-y | hardcoded-value | 16 |
| `Container/Title` | typography | missing-token-binding |  |

## Issues

- warning: A preferred component for the Content slot (key synthetic-missing) is not in this file and no instance in the component shows it, so it is listed without a name. (Content)
- warning: This slot is linked to a property named Footer, which the component does not define, so it is documented without one. (`Footer`)
- warning: No Foundation snapshot was available for this component copy. (`radius/md`)
- warning: No Foundation snapshot was available for this component copy. (`space/gap`)

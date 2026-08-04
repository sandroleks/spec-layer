# Workflow specifications

## 1. Generate component docs

### Entry states

- No valid selection: show a centered empty state explaining that a component
  or component set must be selected in Figma.
- Valid component selection: show the component name, AI writing control,
  section selection, and the sticky `Create docs` action.
- A nested layer inside a component resolves to its containing component using
  the existing main-thread behavior.

### AI writing

- Label: `AI writing`.
- The control is a switch with explicit `role="switch"` and `aria-checked`.
- A help button opens a tooltip:

  `AI can assist sections labeled AI. Component data, measurements, states, and
  tokens still come directly from Figma. Creating docs uses one free AI writing
  use when this is on.`

- The switch controls optional prose only.
- Turning it off hides section-level AI badges.
- An exhausted free allowance does not block deterministic docs. The workflow
  must let the user turn AI off and continue.

### Section groups

Usage:

- Overview, AI-capable.
- Variants, AI-capable where supported by current logic.
- Do's & Don'ts, AI-capable.
- Related components, deterministic.

Specifications:

- Anatomy with Diagram, Table, and Both choices.
- Measurements with independent selectable chips:
  Height & width, Inner padding, Children & spacing.
- Configuration.
- States.
- Tokens used.

Accessibility:

- Interactions.
- Content considerations.
- Semantics & focus.

Group headers disclose their rows. Row checkboxes mean inclusion, not
completion. Group counts read `{included} of {total} included`.

### Actions

- Primary action: `Create docs`.
- Do not label the action `Create with AI`.
- Do not show Preview.
- Show Download only after a successful create, or for an existing document
  with a valid download path.
- Loading text must describe the actual phase when useful. The current shared
  build lock remains authoritative.

## 2. Foundation documents

This is a file-level workflow and does not require a selected component.

### Content

- Page title only. No subtitle.
- One toolbar with:
  - `{selected} of {total} included`
  - a checkbox-style bulk action labeled `Clear all` or `Select all`
- A flat list of variable collections and text styles.
- Each row uses the same checkbox component as the Selected component screen.
- Rows are not collapsible.
- Do not show mode subsections or overflow menus.
- AI descriptions happen automatically when the product logic requires them.
  There is no user-facing switch.

### Actions

- Primary action: `Create {count} frames`.
- If nothing is selected: `Select sources to continue`.
- Do not show preview, selected-frame captions, or existing-frame update
  captions.
- Existing main-thread progress and error messages remain available during
  generation.

## 3. Library

### Header and filtering

- Page title: `Library`.
- The header search control searches library items on this screen.
- Filters are compact segmented controls:
  - All
  - Updates
  - In sync
- Counts are contained inside the tabs.
- No dot indicators and no duplicate summary line.

### Rows

- Clicking the item identity focuses the connected frame in Figma.
- Each row shows name, source path, status, age, and overflow actions.
- `Update available` rows can expand to show `Changes`.
- Expanded rows use the same blue border before, during, and after expansion.
- Changes may include detailed groups only when the extractor can identify them
  reliably.
- When a detailed comparison is not available, show:

  `Source changed`

  `A detailed comparison isn't available. Review the source from the row menu.`

Do not claim that every Figma change can be categorized. Content hashes are the
reliable signal; itemized change detection is best-effort.

### Overflow menu

Preserve all real plugin actions and vary them by row state:

- Review or hide changes.
- Update documentation.
- Open documentation frame.
- View source component, when a source exists.
- Download Markdown, when supported.
- Reconnect.
- Detach.
- Remove connection.

Destructive actions appear after a separator.

### Footer

- Secondary: `Refresh library`.
- Primary: `Update all {count}`.
- Do not repeat the update count as footer text.

## 4. Settings

Settings owns generated-frame appearance only.

- Page title: `Settings`.
- Subtitle: `Generated frame appearance`.
- Do not include an AI generation section.
- Do not include a plugin appearance section. The plugin theme control is in
  the header.

### Frame theme

Preserve the current presets and Custom:

- Default.
- Editorial.
- Tech.
- Warm.
- Custom.

Custom reveals:

- Header background.
- Accent.
- Body text.
- Table header.
- Heading font.
- Body font.

Logo is available for every preset:

- Use selected node as logo.
- Replace.
- Remove.
- Success and error states.

## 5. License

License owns plan state, AI writing usage, activation, subscription management,
and recovery.

### Free plan

- Plan card with readable secondary text.
- Current badge.
- AI writing usage with reset date, remaining count, and progress.
- `Upgrade to Pro`.
- Activation form below the card.

### Pro plan

- Active badge.
- One line stating there is no monthly cap. Not a benefits list, and not the
  word "unlimited": the per-minute rate limit still applies to Pro.
- Manage subscription.
- Connected key summary.
- Remove key.

### Recovery

Preserve expired, inactive, unverified, invalid, disabled, device-limit,
unreachable, removing, and removed states. See `state-matrix.md`.


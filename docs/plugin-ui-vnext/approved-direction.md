# Approved direction

## Product structure

The plugin is organized around five user workflows:

1. Generate component docs.
2. Generate foundation docs.
3. Maintain the library.
4. Configure generated-frame appearance.
5. Manage the plan and license.

The side navigation reflects that structure:

```text
Generate component docs
Generate foundation docs
------------------------
Library
------------------------
Settings
License
```

Website and LinkedIn links live at the bottom of the rail. They are utilities,
not primary workflow navigation.

## Header

Figma already renders the plugin name and logo in its native title bar. The
in-plugin header contains only high-value utilities:

- Quick search.
- AI writing allowance and plan access.
- Theme control.

The search control is stable in position and size on every screen. Library
search appears in the same header control rather than creating a second search
field or moving the header content.

The AI allowance has enough horizontal space for two lines:

- `AI writing`
- `{remaining} of {limit} free uses left`

The allowance control includes an `Upgrade` action for free users. It must
support normal, low, exhausted, Pro, unknown, and loading states without
changing the header height.

## Sidebar

- Selected navigation uses a background fill and a blue icon.
- Selected navigation does not use a left-side marker or outline.
- Tooltips never move on press and always use an inverse, high-contrast surface.
- Navigation labels are available to assistive technology even when visually
  hidden.
- The Library icon is a familiar folder, not a database.
- Group dividers are short and quiet.

## Visual language

- Dense, professional, Figma-native utility UI.
- Inter or Figma's host UI font stack.
- Small, deliberate radius values.
- One-pixel semantic borders.
- Restrained blue for selection, focus, and primary actions.
- Green, amber, and red are reserved for status.
- Animation explains state changes. It does not decorate static content.
- Surfaces should not all be outlined. Use spacing, background, and hierarchy
  before adding borders.

## Theme behavior

Light and dark themes use semantic tokens, not inverted hard-coded values.

- Light canvas: `#F7F7F8`
- Light chrome/surface: `#F0F1F2`
- Light raised surface: `#FFFFFF`
- Light primary text: `#1D1F22`
- Light muted text: `#5D6268`
- Light accent: `#0875C1`
- Dark canvas: `#1F1F1F`
- Dark chrome: `#232323`
- Dark surface: `#292929`
- Dark raised surface: `#303030`
- Dark primary text: `#F3F3F3`
- Dark muted text: `#ADADAD`
- Dark accent: `#0B99FF`

Inverse overlays such as tooltips use their own foreground and background roles
so they remain readable in both themes.

## Copy decisions

- Use American English.
- Use American English spelling for all color terminology.
- Use sentence case.
- Use `AI writing`, not `AI quota`.
- Use `Create docs` for the component workflow.
- Use `Foundation documents` for the file-level workflow.
- Use `Library`, not `My Library`, in navigation and page titles.
- Use `Changes` in expanded library rows.
- Do not describe deterministic output as AI-generated.
- Show an `AI` badge only when AI writing is enabled and the section can use it.
- Do not show a Preview action or preview screen.
- Download appears only after documentation has been created, or when an
  existing connected document can be downloaded.

## Explicitly removed

- Duplicate in-plugin logo and product name.
- Global social links in the header.
- Global progress bars.
- Preview actions.
- A separate Text styles navigation item.
- Foundation mode pills and expandable foundation rows.
- Foundation row overflow menus.
- A manual `Describe color groups with AI` switch.
- Foundation captions such as `9 frames selected` or `9 existing frames will be
  updated`.
- Component captions such as `Component · Ready to document`,
  `Choose what appears in the generated docs`, and `Sections · AI uses 1
  generation`.
- Library summaries that repeat counts already shown in the filters.

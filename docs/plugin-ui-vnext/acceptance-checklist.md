# Acceptance checklist

## Shell

- [ ] Default plugin size is 480 x 680 CSS pixels.
- [ ] The UI remains usable at 420px width.
- [ ] Figma's native title bar is not duplicated.
- [ ] Header controls share one height and baseline.
- [ ] Search does not move between workflows.
- [ ] Sidebar selection uses background plus blue icon, without an outline.
- [ ] Sidebar tooltips remain fixed during press.
- [ ] Website and LinkedIn links are at the bottom of the rail.
- [ ] Sticky footers do not cover scrollable content.

## Design system

- [ ] Light and dark tokens are both present.
- [ ] No component uses a dark-only hard-coded foreground.
- [ ] Inverse tooltip tokens pass in both themes.
- [ ] Focus is visible on every interactive element.
- [ ] Disabled controls retain readable labels.
- [ ] Status is communicated by text or icon as well as color.
- [ ] Reduced motion disables nonessential animation.
- [ ] Components use native buttons, inputs, checkboxes, radio buttons, and
      selects whenever possible.

## Generate component docs

- [ ] No-selection and valid-selection states work.
- [ ] AI writing tooltip explains deterministic and AI-assisted output.
- [ ] AI badges disappear when AI writing is off.
- [ ] Usage, Specifications, and Accessibility groups are present.
- [ ] Anatomy uses Diagram, Table, and Both.
- [ ] Measurement chips are independently selectable.
- [ ] Create docs remains available with AI off.
- [ ] Download appears only after create or for an existing downloadable doc.
- [ ] No Preview action exists.

## Foundation documents

- [ ] Rows use the shared inclusion checkbox.
- [ ] Rows are flat and not collapsible.
- [ ] No mode subsection or row overflow menu is visible.
- [ ] Clear all and Select all use checked and mixed states correctly.
- [ ] The empty, loading, error, progress, partial, and success states work.
- [ ] No manual AI-description switch is visible.

## Library

- [ ] Search filters library rows and remains in the header.
- [ ] All, Updates, and In sync counts are accurate.
- [ ] Clicking row identity focuses the frame in Figma.
- [ ] Overflow actions match the row's real capabilities.
- [ ] Update available rows disclose Changes.
- [ ] Expanded update borders remain consistently blue.
- [ ] Detailed change groups are shown only when reliable.
- [ ] Hash-only drift uses the honest fallback.
- [ ] Edited and source-missing states remain supported.
- [ ] Refresh library and Update all work with the shared build lock.

## Settings

- [ ] Only generated-frame appearance is configured here.
- [ ] Default, Editorial, Tech, Warm, and Custom are available.
- [ ] Custom colors and fonts validate correctly.
- [ ] Logo capture, replacement, removal, and error states work.

## License

- [ ] Free card secondary text is readable in both themes.
- [ ] Free usage count and reset date match the server response.
- [ ] Pro, expired, inactive, unknown, invalid, disabled, device-limit,
      unreachable, removing, and removed states render correctly.
- [ ] Network failure never presents as expiration.
- [ ] Manage, renew, activate, retry, and remove actions use the current URLs
      and message flow.

## Figma manual pass

- [ ] Import `packages/plugin/manifest.json` in Figma Desktop.
- [ ] Verify nested selection resolution.
- [ ] Create and replace a component doc frame.
- [ ] Create and update foundation frames.
- [ ] Focus, update, download, detach, and remove library items.
- [ ] Verify theme following and manual override.
- [ ] Verify keyboard order and screen-reader names.
- [ ] Verify no horizontal overflow or clipped menus.
- [ ] Verify no console errors.

## Automated checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run lint
npm run build:plugin
```


# Progress Placement Audit

## Scope

- Surface: Spec Layer vNext plugin.
- Task: review where work-in-progress feedback appears after Component,
  Foundation, and Library actions.
- Viewport: 480 × 680.
- Evidence: current harness states captured before and after the placement
  change.

## Verdict

The progress surface belonged to the action area, not the top of the content.
At the top it displaced the page, separated cause from feedback, and left the
disabled action button looking unrelated to the running operation.

The corrected pattern places progress directly above the action row inside the
footer. The action and its feedback now form one stable unit, with a six-pixel
gap. The content region no longer shifts when work starts.

Component before/after comparison:
`07-component-before-after-comparison.png`.

## Steps

1. **Component documentation — passed after correction**
   - Before: progress appeared above AI writing and the section controls.
   - After: progress is directly above Create docs while controls retain their
     position.
2. **Foundation generation — passed after correction**
   - Before: progress interrupted the source list and pushed its first row
     downward.
   - After: source rows remain stable; determinate frame progress sits above
     the disabled Creating frames action.
3. **Library batch update — passed after correction**
   - Before: progress interrupted the filters and document list.
   - After: document rows remain stable; batch progress stays with Refresh and
     Update all.

## Accessibility

- The progress surface retains `role="status"` and `aria-live="polite"`.
- Determinate work retains progressbar minimum, maximum, and current values.
- Button disabled states and progress labels remain adjacent in reading order.
- Screenshot review cannot validate screen-reader announcement timing; that
  remains a manual Figma-host check.

final result: passed

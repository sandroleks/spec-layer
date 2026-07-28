# State matrix

The prototype illustrates key states, but the real plugin must preserve the
complete behavior already implemented in `packages/plugin`.

## AI writing allowance

| State | Header | License page | Required behavior |
|---|---|---|---|
| Loading | Stable two-line placeholder | Loading meter | Do not change header height |
| Free, normal | Remaining free uses and Upgrade | Usage count, reset date, progress | AI switch can be enabled |
| Free, low | Low remaining count with warning semantics | Same count and progress | Do not block deterministic docs |
| Exhausted | No free uses left and Upgrade | Exhausted explanation | Offer AI off and continue |
| Pro | Pro plan active | Pro benefits and connected key | No free-use count |
| Unknown | Plan status unavailable | Saved key remains connected | Do not falsely demote or expire |

The server response remains the authority for quota and license status.

## Selected component

| State | Presentation |
|---|---|
| No selection | Empty state with Figma selection instruction |
| Reading selection | Component identity is stable; quiet reading state |
| Ready | AI control, sections, and Create docs |
| AI off | No AI badges; deterministic sections remain available |
| AI on | AI badges only on eligible sections |
| AI request failed | Explain that deterministic docs can still be created |
| Build running | Disable every competing build action through the shared lock |
| Build succeeded | Success status; Download becomes available |
| Build failed | Persistent error with retry path |

## Library

| Existing status | New visual treatment | Available actions |
|---|---|---|
| Checking | Neutral status and skeleton-safe row | Open frame, limited overflow |
| In sync | Green status | Open, source, download, reconnect, detach, remove |
| Update available | Blue status and optional disclosure | Review changes, update, plus standard actions |
| Manually edited | Amber status | Update with overwrite warning, plus standard actions |
| Source missing | Red status | Detach and remove only |
| Drift check failed | Honest neutral fallback | Do not claim an update |
| Empty library | Empty state | Return to component workflow |
| Filter has no results | Filter-specific empty state | Clear filter |
| Refreshing | Secondary footer action loading | Keep current rows visible |
| Updating one | Disable conflicting builds | Keep row position stable |
| Updating all | Disable conflicting builds | Report created/updated outcome accurately |

Detailed changes are optional. A content-hash mismatch is sufficient to show
`Update available`; it is not sufficient to invent an itemized explanation.

## Foundation documents

| State | Presentation |
|---|---|
| Reading file | Flat skeleton rows and quiet summary |
| Ready | Flat selectable list |
| Mixed selection | Mixed checkbox in the bulk action |
| None selected | Disabled primary action with instructional label |
| Empty file | Explain that no supported variables or text styles were found |
| Read failed | Error banner with retry |
| Generating | Existing progress count and shared build lock |
| Partial failure | Keep successful result count and explain the failure |
| Succeeded | Success status naming created and replaced counts when meaningful |

## License

| State | Plan card | Activation area | Primary recovery |
|---|---|---|---|
| Free | Free plan, current | Empty key field | Activate or upgrade |
| Checking | Free card remains stable | Checking | Wait |
| Pro | Pro plan, active | Connected masked key | Manage or remove |
| Expired | Free plan | Expired warning | Renew Pro |
| Inactive | Free plan | Key not connected | Reconnect |
| Unknown | Pro key saved, unverified | Saved masked key | Retry |
| Invalid | Free plan | Key not found | Correct and retry |
| Disabled | Free plan | Key disabled | Contact support |
| Device limit | Free plan | Device-limit error | Manage subscription |
| Unreachable | Current plan unchanged | Server unavailable | Retry |
| Removing | Pro card remains stable | Disconnecting | Wait |
| Removed | Free plan | Removal success | Activate another key |

## Theme

Every state above must be checked in light and dark themes. Selected, focus,
warning, error, disabled, and inverse overlay states cannot rely on color alone.


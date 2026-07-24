// ---------------------------------------------------------------------------
// Phase machine types
// ---------------------------------------------------------------------------

export type UiPhase = 'idle' | 'extracting' | 'reviewing' | 'sent';
export type UiEvent = 'selected' | 'rendered' | 'sent';

// ---------------------------------------------------------------------------
// nextStatus — pure transition function
//
//   idle --selected--> extracting --rendered--> reviewing --sent--> sent
//   sent --selected--> idle          (new selection resets the cycle)
//   sent --sent-->     sent          (re-send keeps the phase)
//
// 'sent' is only reachable from phases where a rendered spec exists
// (reviewing, or sent itself). Any other (phase, event) pair is a no-op.
// ---------------------------------------------------------------------------

export function nextStatus(phase: UiPhase, event: UiEvent): UiPhase {
  if (phase === 'idle' && event === 'selected') return 'extracting';
  if (phase === 'extracting' && event === 'rendered') return 'reviewing';
  if ((phase === 'reviewing' || phase === 'sent') && event === 'sent') return 'sent';
  if (phase === 'sent' && event === 'selected') return 'idle';
  return phase;
}

// ---------------------------------------------------------------------------
// resetToIdle — explicit named reset operation
// ---------------------------------------------------------------------------

export function resetToIdle(): UiPhase {
  return 'idle';
}

// ---------------------------------------------------------------------------
// toKebab — slug helper; handles Figma hierarchy names (/ and \)
// ---------------------------------------------------------------------------

export function toKebab(name: string): string {
  return name.toLowerCase()
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

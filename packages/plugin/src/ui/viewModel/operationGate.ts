/**
 * Keeps a component build tied to the selection it started with.
 *
 * Figma can report a new selection while AI generation is awaiting the
 * network. The shared UiState must not switch components in the middle of that
 * operation, so selection messages are deferred and refreshed once it ends.
 */
export interface OperationGate {
  active: boolean;
  selectionChanged: boolean;
}

export function createOperationGate(): OperationGate {
  return { active: false, selectionChanged: false };
}

export function beginOperation(gate: OperationGate): boolean {
  if (gate.active) return false;
  gate.active = true;
  return true;
}

/** Returns true when the caller should defer the selection message. */
export function deferSelection(gate: OperationGate): boolean {
  if (!gate.active) return false;
  gate.selectionChanged = true;
  return true;
}

/** Ends the operation and says whether the deferred selection payload should be applied. */
export function finishOperation(gate: OperationGate): boolean {
  gate.active = false;
  const refresh = gate.selectionChanged;
  gate.selectionChanged = false;
  return refresh;
}

/**
 * Keeps a component build tied to the selection it started with: a selection
 * reported mid-operation (AI awaiting the network) is deferred until it ends.
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

/** True when the caller should defer the selection message. */
export function deferSelection(gate: OperationGate): boolean {
  if (!gate.active) return false;
  gate.selectionChanged = true;
  return true;
}

/** Ends the operation; true when a deferred selection should now be applied. */
export function finishOperation(gate: OperationGate): boolean {
  gate.active = false;
  const refresh = gate.selectionChanged;
  gate.selectionChanged = false;
  return refresh;
}

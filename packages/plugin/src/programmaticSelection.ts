/**
 * Correlates the one canvas selection the plugin makes after creating a doc.
 *
 * `consume` clears the expectation on every selection event: an exact match is
 * suppressed, while a different selection is real user input and proceeds.
 */
export class ProgrammaticSelection {
  private expectedId: string | null = null;

  expect(nodeId: string): void {
    this.expectedId = nodeId;
  }

  cancel(): void {
    this.expectedId = null;
  }

  consume(nodeIds: readonly string[]): boolean {
    const suppress =
      this.expectedId !== null &&
      nodeIds.length === 1 &&
      nodeIds[0] === this.expectedId;
    this.expectedId = null;
    return suppress;
  }
}

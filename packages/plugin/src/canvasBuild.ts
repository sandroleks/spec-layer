/**
 * One canvas build at a time, whichever frame family it draws.
 *
 * buildDocFrames and buildFoundationFrame both write frameKit's module state
 * (palette, fonts, corner scale, per-build caches), so a component build and
 * a foundation build interleaving would paint one document in the other's
 * theme. main.ts used to keep one flag per family, which stopped two component
 * builds or two foundation builds from overlapping but not one of each. This
 * is the single flag.
 *
 * It also answers the selection listener. A build switches pages to place a
 * doc beside its predecessor and switches back, and each switch fires
 * `selectionchange` with that page's selection, which is nobody's choice;
 * posting it would empty the component pane the moment "Updated" shows.
 */
export class CanvasBuildGate {
  private building = false;

  /** True while a build holds the gate. */
  get busy(): boolean {
    return this.building;
  }

  /** Take the gate. False when a build already holds it: reply, do not build. */
  begin(): boolean {
    if (this.building) return false;
    this.building = true;
    return true;
  }

  end(): void {
    this.building = false;
  }
}

/**
 * fakeFigma.ts — a minimal stand-in for the Figma plugin API, good enough to
 * build a whole document out of frameKit primitives and then assert on it.
 *
 * Shared rather than copied because of one line: resize() pins BOTH axes to
 * FIXED, which is the behaviour behind the row-clipping bug. A second copy of
 * this stub would eventually lose that line and the suites relying on it would
 * start passing against broken code. See the "stub fidelity" tests in
 * foundationFrame.test.ts, which pin the emulation itself.
 *
 * Not a general-purpose mock: hugging WIDTH is deliberately unmodelled and
 * throws, so a test that depends on real text measurement fails loudly instead
 * of asserting against an invented number.
 */

type SizeMode = 'FIXED' | 'AUTO';
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL';

/** The height every fake text node reports. */
export const TEXT_H = 14;
/** The intrinsic size every fake image reports, for logo aspect-ratio maths. */
export const IMAGE_W = 200;
export const IMAGE_H = 50;

export interface FakeNode { type?: string; height?: number; width?: number }

/**
 * A minimal auto-layout frame modelling the two things the clipping bug turned
 * on: resize() fixing both axes, and layoutSizing{Horizontal,Vertical} being
 * views onto primary/counter that depend on layoutMode.
 */
export class FakeFrame {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE';
  primaryAxisSizingMode: SizeMode = 'AUTO';
  counterAxisSizingMode: SizeMode = 'AUTO';
  itemSpacing = 0;
  paddingTop = 0;
  paddingBottom = 0;
  children: FakeNode[] = [];
  fills: unknown = [];
  [k: string]: unknown;

  private fixedW = 0.01;
  private fixedH = 0.01;
  private fillH = false;

  appendChild(n: FakeNode): void {
    this.children.push(n);
  }

  /**
   * Figma's real behaviour: an explicit resize pins BOTH axes to FIXED. This is
   * the single most important line in the stub.
   */
  resize(w: number, h: number): void {
    this.fixedW = w;
    this.fixedH = h;
    this.primaryAxisSizingMode = 'FIXED';
    this.counterAxisSizingMode = 'FIXED';
  }

  resizeWithoutConstraints(w: number, h: number): void {
    this.resize(w, h);
  }

  /** Which sizing mode governs the horizontal axis, given the layout direction. */
  private get horizontalMode(): SizeMode {
    return this.layoutMode === 'VERTICAL' ? this.counterAxisSizingMode : this.primaryAxisSizingMode;
  }

  private get verticalMode(): SizeMode {
    return this.layoutMode === 'VERTICAL' ? this.primaryAxisSizingMode : this.counterAxisSizingMode;
  }

  private setAxis(axis: 'horizontal' | 'vertical', mode: SizeMode): void {
    const isPrimary = this.layoutMode === 'VERTICAL' ? axis === 'vertical' : axis === 'horizontal';
    if (isPrimary) this.primaryAxisSizingMode = mode;
    else this.counterAxisSizingMode = mode;
  }

  get layoutSizingHorizontal(): LayoutSizing {
    if (this.fillH) return 'FILL';
    return this.horizontalMode === 'AUTO' ? 'HUG' : 'FIXED';
  }

  /** FILL is a stretch against the parent, which Figma stores as a fixed axis. */
  set layoutSizingHorizontal(v: LayoutSizing) {
    this.fillH = v === 'FILL';
    this.setAxis('horizontal', v === 'HUG' ? 'AUTO' : 'FIXED');
  }

  get layoutSizingVertical(): LayoutSizing {
    return this.verticalMode === 'AUTO' ? 'HUG' : 'FIXED';
  }

  set layoutSizingVertical(v: LayoutSizing) {
    this.setAxis('vertical', v === 'HUG' ? 'AUTO' : 'FIXED');
  }

  get width(): number {
    if (this.horizontalMode === 'FIXED') return this.fixedW;
    // A hugging width is not modelled: measuring text is Figma's job, and
    // returning a made-up number would make a future test quietly meaningless.
    throw new Error('FakeFrame: hugging width is not modelled');
  }

  /** A hugging height is measured from the content, so a clipped row shows up. */
  get height(): number {
    if (this.verticalMode === 'FIXED') return this.fixedH;
    const content = this.layoutMode === 'VERTICAL'
      ? this.children.reduce((a, c) => a + (c.height ?? 0), 0)
        + Math.max(this.children.length - 1, 0) * this.itemSpacing
      : this.children.reduce((a, c) => Math.max(a, c.height ?? 0), 0);
    return content + this.paddingTop + this.paddingBottom;
  }

  /** Every string rendered by this frame or anything inside it, in tree order. */
  textChars(): string[] {
    const out: string[] = [];
    for (const child of this.children) {
      if (child instanceof FakeFrame) out.push(...child.textChars());
      else if (child.type === 'TEXT') out.push(String((child as { characters?: unknown }).characters ?? ''));
    }
    return out;
  }

  /** Every descendant frame carrying this name, in tree order. */
  findAllNamed(name: string): FakeFrame[] {
    const out: FakeFrame[] = [];
    for (const child of this.children) {
      if (!(child instanceof FakeFrame)) continue;
      if (child.name === name) out.push(child);
      out.push(...child.findAllNamed(name));
    }
    return out;
  }
}

export class FakeSection {
  name = '';
  children: FakeNode[] = [];
  width = 0;
  height = 0;
  x = 0;
  y = 0;
  [k: string]: unknown;

  appendChild(n: FakeNode): void {
    this.children.push(n);
  }

  resizeWithoutConstraints(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }
}

function fakeText(): Record<string, unknown> {
  return { type: 'TEXT', height: TEXT_H, characters: '' };
}

function fakeRect(): Record<string, unknown> {
  const r: Record<string, unknown> = {
    type: 'RECTANGLE',
    width: 0,
    height: 0,
    resize(w: number, h: number) { r.width = w; r.height = h; },
  };
  return r;
}

/**
 * Install the stub on globalThis. `overrides` replaces individual members, for
 * tests that need a failing font load or a corrupt image.
 */
export function installFakeFigma(overrides: Record<string, unknown> = {}): void {
  (globalThis as Record<string, unknown>).figma = {
    createFrame: () => new FakeFrame(),
    createText: () => fakeText(),
    createRectangle: () => fakeRect(),
    createSection: () => new FakeSection(),
    loadFontAsync: async () => {},
    base64Decode: () => new Uint8Array([0]),
    createImage: () => ({
      hash: 'fake-image-hash',
      getSizeAsync: async () => ({ width: IMAGE_W, height: IMAGE_H }),
    }),
    ...overrides,
  };
}

export function uninstallFakeFigma(): void {
  delete (globalThis as Record<string, unknown>).figma;
}

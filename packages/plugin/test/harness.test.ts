// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The harness promises "any screen in any state". This mounts each view the
 * way the browser does and fails on the first fixture that has drifted from
 * a screen's contract, which is how ?view=foundations came to throw for
 * weeks without anyone noticing.
 */
const QUERIES = [
  'view=component',
  'view=component&state=error&facts=states',
  'view=component&state=ready&allowance=exhausted',
  'view=foundations',
  'view=foundations&state=progress&selection=partial',
  'view=foundations&empty=1',
  'view=library',
  'view=library&pane=publish&publish=published',
  'view=library&pane=publish&publish=checking',
  'view=library&pane=publish&publish=proposal&plan=free',
  'view=library&pane=history&history=ready',
  'view=settings&tab=export',
  'view=license&licenseState=expired',
];

interface HappyWindow { happyDOM: { setURL(url: string): void } }

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('ui harness', () => {
  for (const query of QUERIES) {
    it(`mounts ?${query} without throwing`, async () => {
      (window as unknown as HappyWindow).happyDOM.setURL(`http://localhost/ui-harness.html?${query}`);
      await import('../src/ui/harness');
      const scroll = document.getElementById('sl-screen-scroll');
      expect(scroll?.children.length ?? 0).toBeGreaterThan(0);
      if (query === 'view=component&state=error&facts=states') {
        // The failed build's banner sits in the footer's status slot.
        expect(document.getElementById('sl-screen-footer')?.innerHTML).toContain('sl-footer-error');
      }
    });
  }
});

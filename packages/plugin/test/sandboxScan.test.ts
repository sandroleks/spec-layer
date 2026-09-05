import { describe, it, expect } from 'vitest';
import { scanSandboxBundle } from '../../../scripts/check-main-sandbox.mjs';

describe('scanSandboxBundle', () => {
  it('reports minified zero-argument constructor calls without parentheses', () => {
    const minified = '(()=>{function r(){let e=new TextEncoder,o=new Blob;return e}})();';
    const offenders = scanSandboxBundle(minified);
    const names = offenders.map((o) => o.name);
    expect(names).toContain('TextEncoder');
    expect(names).toContain('Blob');
  });

  it('does not match a constructor name that is only a prefix of a longer identifier', () => {
    const src = 'const e = new TextEncoderPolyfill();';
    const offenders = scanSandboxBundle(src);
    expect(offenders).toEqual([]);
  });
});

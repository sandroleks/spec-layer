/// <reference types="node" />
// The one proxy test that reads a file needs node types. The reference adds
// them to whichever program includes this file, which is the test typecheck,
// never the Worker build (tsconfig `types` names the Workers runtime only).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const toml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');

describe('wrangler.toml', () => {
  it('serves the custom domain only: no workers.dev origin outside the zone rate rules', () => {
    expect(toml).toMatch(/^workers_dev = false$/m);
    expect(toml).toMatch(/^routes = \[\{ pattern = "api\.spec-layer\.com", custom_domain = true \}\]$/m);
  });

  it('turns on Workers observability with every invocation sampled', () => {
    expect(toml).toMatch(/^\[observability\]$/m);
    expect(toml).toMatch(/^\[observability\]\nenabled = true\nhead_sampling_rate = 1$/m);
  });
});

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

  it('binds both shared rate limiters at the isolate windows\' limits, in production and staging', () => {
    const block = (env: string, name: string, id: string, limit: number) =>
      new RegExp(`^\\[\\[${env}ratelimits\\]\\]\\nname = "${name}"\\nnamespace_id = "${id}"\\nsimple = \\{ limit = ${limit}, period = 60 \\}$`, 'm');
    expect(toml).toMatch(block('', 'REQUEST_RATE_LIMITER', '1001', 60));
    expect(toml).toMatch(block('', 'LICENSE_RATE_LIMITER', '1002', 20));
    expect(toml).toMatch(block('env\\.staging\\.', 'REQUEST_RATE_LIMITER', '2001', 60));
    expect(toml).toMatch(block('env\\.staging\\.', 'LICENSE_RATE_LIMITER', '2002', 20));
  });

  describe('[env.staging]', () => {
    const staging = toml.slice(toml.indexOf('\n[env.staging]\n'));

    it('exists after the production config, so nothing above it is scoped to staging', () => {
      expect(toml.indexOf('\n[env.staging]\n')).toBeGreaterThan(toml.indexOf('[observability]'));
    });

    it('serves a custom domain in the same zone and no workers.dev origin, like production', () => {
      expect(staging).toMatch(/^workers_dev = false$/m);
      expect(staging).toMatch(/^routes = \[\{ pattern = "staging-api\.spec-layer\.com", custom_domain = true \}\]$/m);
    });

    it('binds its own KV namespace and quota object, never the production namespace id', () => {
      expect(staging).toMatch(/\{ binding = "LICENSE_CACHE", id = "[0-9a-f]{32}" \}/);
      expect(staging).not.toContain('46fbd911b2194babbf2019fd4d0b412a');
      expect(staging).toMatch(/^\[\[env\.staging\.durable_objects\.bindings\]\]\nname = "QUOTA"\nclass_name = "QuotaDO"$/m);
    });

    it('keeps observability on with every invocation sampled', () => {
      expect(staging).toMatch(/^\[env\.staging\.observability\]\nenabled = true\nhead_sampling_rate = 1$/m);
    });
  });
});

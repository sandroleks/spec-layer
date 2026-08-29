import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import {
  COMPONENT_V5_GOLDEN_PATH, renderComponentV5Golden, writeComponentV5Golden,
} from '../fixtures/componentV5';

if (process.env.UPDATE_COMPONENT_V5_GOLDEN === '1') writeComponentV5Golden();

describe('Component Context v5 reviewed golden', () => {
  it('matches the deterministic AI profile byte for byte', () => {
    expect(renderComponentV5Golden()).toBe(readFileSync(COMPONENT_V5_GOLDEN_PATH, 'utf8'));
  });

  it('is exact-id scoped and independently parseable', () => {
    const parsed = load(renderComponentV5Golden()) as {
      spec_layer: { kind: string; version: number; profile: string };
      references: {
        used: Array<{ source_id: string }>;
        foundation: { collections: Array<{ tokens: Array<{ source_id: string }> }> };
      };
    };
    expect(parsed.spec_layer).toMatchObject({ kind: 'component', version: 5, profile: 'ai' });
    expect(parsed.references.used.every((reference) => reference.source_id.length > 0)).toBe(true);
    expect(parsed.references.foundation.collections.flatMap((collection) => collection.tokens)
      .some((token) => token.source_id === 'VariableID:unrelated')).toBe(false);
  });
});

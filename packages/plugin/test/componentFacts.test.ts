import { describe, expect, it } from 'vitest';
import type { IntermediateSpec } from '@spec-layer/extractor';
import { componentFacts, NO_FACTS } from '../src/ui/viewModel/componentFacts';

/** The smallest spec shape these facts read. Everything else is irrelevant here. */
function spec(over: Partial<IntermediateSpec> = {}): IntermediateSpec {
  return {
    name: 'Button',
    props: [],
    variants: [],
    variantInstances: [],
    ...over,
  } as unknown as IntermediateSpec;
}

describe('componentFacts', () => {
  it('reports nothing usable when no spec has been extracted', () => {
    expect(componentFacts(null, 'Button')).toEqual(NO_FACTS);
  });

  it('can identify an atom from the selected node while extraction is pending', () => {
    expect(componentFacts(null, '.Button base').isAtom).toBe(true);
    expect(componentFacts(null, '.Button base').hasStates).toBeNull();
  });

  it('flags an atom from its name, using the legacy naming rule', () => {
    expect(componentFacts(spec(), '.Button base').isAtom).toBe(true);
    expect(componentFacts(spec(), 'Button').isAtom).toBe(false);
  });

  it('has no states when no variant axis looks like a state', () => {
    expect(componentFacts(spec(), 'Button').hasStates).toBe(false);
  });

  it('detects a state-like variant axis', () => {
    const facts = componentFacts(
      spec({
        variants: [{ prop: 'State', values: ['Default', 'Hover'] }] as never,
      }),
      'Button',
    );
    expect(facts.hasStates).toBe(true);
  });

  it('renders an enum axis as an attributed chip', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Size: 'Small' } }] as never }),
      'Button',
    );
    expect(facts.variants).toHaveLength(1);
    expect(facts.variants[0].chips).toEqual([
      { text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' },
    ]);
  });

  it('renders a true boolean as a flag named after its axis', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Disabled: 'true' } }] as never }),
      'Button',
    );
    expect(facts.variants[0].chips).toEqual([
      { text: 'Disabled', tone: 'flag', title: 'Disabled: true' },
    ]);
  });

  it('drops a false boolean as noise, and never leaves a row with no chip', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Disabled: 'false' } }] as never }),
      'Button',
    );
    expect(facts.variants[0].chips).toEqual([
      { text: 'Default', tone: 'muted', title: 'Default' },
    ]);
  });

  it('preselects the default variant, so a build is never empty by accident', () => {
    const facts = componentFacts(
      spec({
        props: [{ kind: 'variant', name: 'Size', default: 'Medium' }] as never,
        variantInstances: [
          { nodeId: '1:1', values: { Size: 'Small' } },
          { nodeId: '1:2', values: { Size: 'Medium' } },
        ] as never,
      }),
      'Button',
    );
    expect([...facts.defaultVariantIds]).toEqual(['1:2']);
  });
});

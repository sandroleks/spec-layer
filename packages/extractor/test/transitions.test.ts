import { describe, it, expect } from 'vitest';
import { extractTransitions } from '../src/transitions';
import { variantAxisModel } from '../src/tokens';
import { extract, specContentHash, validate } from '../src/index';
import type { SerializedNode } from '../src/tree';

const hover = { trigger: { type: 'on_hover' as const }, destinationId: '1:2',
  transition: { type: 'smart_animate' as const, duration: 0.3, easing: { type: 'named' as const, name: 'ease_out' as const } } };
const press = { trigger: { type: 'on_press' as const }, destinationId: '1:3', transition: { type: 'instant' as const } };
const away = { trigger: { type: 'on_click' as const }, destinationId: '9:9', transition: { type: 'instant' as const } };

const set: SerializedNode = {
  id: '1:0', name: 'Button', type: 'COMPONENT_SET', visible: true,
  children: [
    { id: '1:1', name: 'State=Default', type: 'COMPONENT', visible: true, transitions: [hover, hover, away],
      children: [{ id: '1:11', name: 'Icon', type: 'FRAME', visible: true, transitions: [press] }] },
    { id: '1:2', name: 'State=Hover', type: 'COMPONENT', visible: true,
      transitions: [{ trigger: { type: 'mouse_leave', delay: 0 }, destinationId: '1:1', transition: { type: 'instant' } }] },
    { id: '1:3', name: 'State=Pressed', type: 'COMPONENT', visible: true },
  ],
};

describe('extractTransitions', () => {
  it('maps CHANGE_TO destinations to axis values, in variant then reaction order, deduplicated', () => {
    const { rules, issues } = extractTransitions(set, variantAxisModel(set));
    expect(rules).toEqual([
      { from: { State: 'Default' }, fromVariantId: '1:1', to: { State: 'Hover' }, toVariantId: '1:2',
        trigger: { type: 'on_hover' }, triggerPart: 'Container', triggerPath: 'Container', transition: hover.transition },
      { from: { State: 'Default' }, fromVariantId: '1:1', to: { State: 'Pressed' }, toVariantId: '1:3',
        trigger: { type: 'on_press' }, triggerPart: 'Icon', triggerPath: 'Container/Icon', transition: { type: 'instant' } },
      { from: { State: 'Hover' }, fromVariantId: '1:2', to: { State: 'Default' }, toVariantId: '1:1',
        trigger: { type: 'mouse_leave', delay: 0 }, triggerPart: 'Container', triggerPath: 'Container', transition: { type: 'instant' } },
    ]);
    expect(issues).toEqual([{ path: 'Container', destinationId: '9:9' }]);
  });

  it('skips an off-set interaction on a nested instance without an issue', () => {
    const nested: SerializedNode = {
      id: '3:0', name: 'Card', type: 'COMPONENT_SET', visible: true,
      children: [
        { id: '3:1', name: 'State=A', type: 'COMPONENT', visible: true,
          children: [{ id: '3:11', name: 'Inner', type: 'INSTANCE', visible: true, transitions: [away] }] },
        { id: '3:2', name: 'State=B', type: 'COMPONENT', visible: true },
      ],
    };
    const { rules, issues } = extractTransitions(nested, variantAxisModel(nested));
    expect(rules).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('keeps an instance interaction whose destination is a variant of the set', () => {
    const nested: SerializedNode = {
      id: '3:0', name: 'Card', type: 'COMPONENT_SET', visible: true,
      children: [
        { id: '3:1', name: 'State=A', type: 'COMPONENT', visible: true,
          children: [{ id: '3:11', name: 'Inner', type: 'INSTANCE', visible: true,
            transitions: [{ trigger: { type: 'on_click' }, destinationId: '3:2', transition: { type: 'instant' } }] }] },
        { id: '3:2', name: 'State=B', type: 'COMPONENT', visible: true },
      ],
    };
    const { rules, issues } = extractTransitions(nested, variantAxisModel(nested));
    expect(issues).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ fromVariantId: '3:1', toVariantId: '3:2', triggerPath: 'Container/Inner' });
  });

  it('reports the same off-set interaction on several variants once', () => {
    const layer = (id: string): SerializedNode => ({ id, name: 'Icon', type: 'FRAME', visible: true, transitions: [away] });
    const many: SerializedNode = {
      id: '4:0', name: 'Chip', type: 'COMPONENT_SET', visible: true,
      children: [
        { id: '4:1', name: 'State=A', type: 'COMPONENT', visible: true, children: [layer('4:11')] },
        { id: '4:2', name: 'State=B', type: 'COMPONENT', visible: true, children: [layer('4:21')] },
      ],
    };
    const { rules, issues } = extractTransitions(many, variantAxisModel(many));
    expect(rules).toEqual([]);
    expect(issues).toEqual([{ path: 'Container/Icon', destinationId: '9:9' }]);
  });

  it('yields no rules for a lone component', () => {
    const lone: SerializedNode = { id: '2:1', name: 'Tag', type: 'COMPONENT', visible: true, transitions: [away] };
    const { rules, issues } = extractTransitions(lone, variantAxisModel(lone));
    expect(rules).toEqual([]);
    expect(issues).toEqual([{ path: 'Tag', destinationId: '9:9' }]);
  });
});

describe('transitions in the spec', () => {
  it('leaves the hash of a component without transitions unchanged and moves it when one appears', () => {
    const bare = { ...set, children: set.children!.map((c) => ({ ...c, transitions: undefined, children: undefined })) } as unknown as SerializedNode;
    const before = specContentHash(extract(bare, { figmaFile: 'F' }));
    const stripped = extract(bare, { figmaFile: 'F' });
    delete (stripped as { transitions?: unknown }).transitions;
    delete (stripped as { transitionIssues?: unknown }).transitionIssues;
    expect(specContentHash(stripped)).toBe(before);
    expect(specContentHash(extract(set, { figmaFile: 'F' }))).not.toBe(before);
  });

  it('reports a destination outside the set as a warning', () => {
    const findings = validate(extract(set, { figmaFile: 'F' }), new Map());
    expect(findings).toContainEqual({
      id: 'transition-target-outside-set', severity: 'warning', path: 'Container', property: 'reactions',
      message: 'A prototype interaction on this layer changes to a node outside this component set, so it is not listed as a variant transition.',
    });
  });
});

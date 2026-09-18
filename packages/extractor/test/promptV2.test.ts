import { describe, it, expect } from 'vitest';
import { extract } from '../src/extract';
import { buildProsePrompt, partKind, PROSE_KEY_INSTRUCTIONS, PROMPT_RETURN_ANCHOR } from '../src/prose/promptV2';
import { PROSE_V2_KEYS } from '../src/prose/v2';
import type { SerializedNode } from '../src/tree';
import type { AnatomyPart } from '../src/anatomy';
import button from './fixtures/button.json';

const spec = extract(button as SerializedNode, { figmaFile: 'FILE1' });

/** A component set with one option axis, one state axis, a boolean, a text
 *  property, a hidden nested icon, and a bound stroke that differs by state. */
function fieldNode(): SerializedNode {
  const bind = (property: string, name: string) => ({
    property, id: `VariableID:${name}`, name, kind: 'variable' as const, remote: false,
    collectionId: 'VariableCollectionId:1',
  });
  const variant = (state: string): SerializedNode => ({
    id: `v:${state}`, name: `Style=Filled, State=${state}`, type: 'COMPONENT', visible: true,
    layout: { mode: 'VERTICAL', itemSpacing: 4 },
    children: [
      { id: `v:${state}:label`, name: 'Label', type: 'TEXT', visible: true },
      {
        id: `v:${state}:input`, name: 'Input', type: 'FRAME', visible: true,
        layout: { mode: 'HORIZONTAL', paddingLeft: 12, paddingRight: 12, itemSpacing: 8 },
        bindings: [bind('strokes', state === 'Focused' ? 'color/border/focus' : 'color/field/border')],
        children: [
          { id: `v:${state}:icon`, name: 'Leading icon', type: 'INSTANCE', visible: false,
            visibleProperty: 'Show leading icon', mainComponent: { name: 'Icon', key: 'icon-key' } },
          { id: `v:${state}:placeholder`, name: 'Placeholder', type: 'TEXT', visible: true },
        ],
      },
    ],
  });
  return {
    id: '9:0', name: 'text field', type: 'COMPONENT_SET', visible: true, key: 'field-key',
    description: 'A single-line field where people type short, free-form text. Keep it to one value.',
    propertyDefinitions: {
      Style: { type: 'VARIANT', defaultValue: 'Filled', variantOptions: ['Filled', 'Outlined'] },
      State: { type: 'VARIANT', defaultValue: 'Enabled', variantOptions: ['Enabled', 'Focused', 'Disabled'] },
      'Show leading icon': { type: 'BOOLEAN', defaultValue: false },
      Label: { type: 'TEXT', defaultValue: 'Label' },
    },
    children: [variant('Enabled'), variant('Focused'), variant('Disabled')],
  };
}

describe('partKind', () => {
  const part = (type: string, extra: Partial<AnatomyPart> = {}): AnatomyPart =>
    ({ id: 'p', name: 'P', type, nested: false, path: 'Container/P', depth: 0, ...extra });

  it('names text, vector, shape and container kinds from the Figma type', () => {
    expect(partKind(part('TEXT'))).toBe('text');
    expect(partKind(part('VECTOR'))).toBe('vector');
    expect(partKind(part('BOOLEAN_OPERATION'))).toBe('vector');
    expect(partKind(part('RECTANGLE'))).toBe('shape');
    expect(partKind(part('ELLIPSE'))).toBe('shape');
    expect(partKind(part('FRAME'))).toBe('container');
    expect(partKind(part('GROUP'))).toBe('container');
  });

  it('names a nested component by its main component', () => {
    expect(partKind(part('INSTANCE', { nested: true, component: 'Icon' }))).toBe('nested component Icon');
  });

  it('falls back to the lower-cased Figma type for anything else', () => {
    expect(partKind(part('SLICE'))).toBe('slice');
  });
});

describe('buildProsePrompt (v9)', () => {
  const prompt = buildProsePrompt(extract(fieldNode(), { figmaFile: 'F' }));

  it('opens with the display name and the raw layer name', () => {
    expect(prompt.startsWith('Component: Text field (layer name: text field)\n')).toBe(true);
  });

  it('opens with the name alone when display and raw names agree', () => {
    expect(buildProsePrompt(spec).startsWith('Component: Button\n')).toBe(true);
  });

  it('marks the designer description as authoritative and quotes it verbatim', () => {
    expect(prompt).toContain("Designer's description (authoritative; build on it, never contradict or restate it):\n  A single-line field where people type short, free-form text. Keep it to one value.");
  });

  it('omits the description block when there is none', () => {
    expect(buildProsePrompt(spec)).not.toContain("Designer's description");
  });

  it('lists anatomy depth-first with kinds, nesting, and the shown-by property', () => {
    expect(prompt).toContain('Anatomy (depth-first; indent marks nesting):\n  Label: text\n  Input: container\n');
    expect(prompt).toContain('\n    Leading icon: nested component Icon; shown by Show leading icon\n');
    expect(prompt).toContain('\n    Placeholder: text\n');
    // Nested parts are indented one level deeper than their container.
    expect(prompt.indexOf('  Input: container')).toBeLessThan(prompt.indexOf('    Placeholder: text'));
  });

  it('splits option axes from the state axis and gives each option axis its default', () => {
    expect(prompt).toContain('Options:\n  Style: Filled · Outlined (default Filled)');
    expect(prompt).toContain('State axis:\n  State: Enabled · Focused · Disabled');
    expect(prompt).not.toContain('Options:\n  State');
  });

  it('lists the other properties with kind and default, and the states line as today', () => {
    expect(prompt).toContain('Properties:\n  Show leading icon [boolean] (default: false)\n  Label [text] (default: Label)');
    expect(prompt).toContain('States: Enabled, Focused, Disabled');
  });

  it('lists tokens by part and property with their conditions, and keeps the condition note', () => {
    // The fixture binds the Figma-native `strokes` property; tokens.ts's
    // SIMPLE_PROPERTY_MAP (pre-existing, shared by every consumer) renders it
    // as the CSS-like `border`, exactly as the v8 prompt and every canvas
    // Tokens section already do. The prompt must not invent a second naming.
    expect(prompt).toContain('Design tokens:\n  Input.border');
    expect(prompt).toMatch(/Input\.border \[State=Focused\] → color\/border\/focus/);
    expect(prompt).toContain('color/field/border');
    expect(prompt).toContain('a bracketed condition like [State=Hover]');
  });

  it('never leaks ids, keys, or hashes', () => {
    const field = extract(fieldNode(), { figmaFile: 'FILE-KEY-XYZ' });
    const out = buildProsePrompt(field);
    expect(out).not.toContain('FILE-KEY-XYZ');
    expect(out).not.toContain('field-key');
    expect(out).not.toContain('9:0');
    for (const inst of field.variantInstances) expect(out).not.toContain(inst.nodeId);
    for (const part of field.anatomy) expect(out).not.toContain(part.id);
    expect(out).not.toContain('"id"');
    expect(out).not.toContain('sha256');
  });

  it('asks only for the requested keys, in contract order, after the anchor the proxy checks', () => {
    const out = buildProsePrompt(spec, new Set(['keyboard', 'overview']));
    const tail = out.slice(out.indexOf(PROMPT_RETURN_ANCHOR));
    expect(tail).toContain(PROSE_KEY_INSTRUCTIONS.overview);
    expect(tail).toContain(PROSE_KEY_INSTRUCTIONS.keyboard);
    expect(tail.indexOf('overview (')).toBeLessThan(tail.indexOf('keyboard ('));
    expect(tail).not.toContain('guidelines (');
  });

  it('asks for every key when nothing is requested', () => {
    const out = buildProsePrompt(spec);
    for (const key of PROSE_V2_KEYS) expect(out).toContain(PROSE_KEY_INSTRUCTIONS[key]);
  });

  it('closes with the formatting rules and no em dash of its own', () => {
    expect(prompt).toContain('Leave out any key you cannot fill honestly.');
    expect(prompt).toContain('Markdown only as **bold** or `code` inside a sentence; no headings.');
    expect(prompt).not.toMatch(/[—–]/);
  });

  it('never writes the state axis into the variants guide instruction', () => {
    expect(PROSE_KEY_INSTRUCTIONS.variantsGuide).toContain('omit state values');
  });
});

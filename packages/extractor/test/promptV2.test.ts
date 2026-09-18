import { describe, it, expect } from 'vitest';
import { extract } from '../src/extract';
import {
  buildProsePrompt, partKind, PROSE_KEY_INSTRUCTIONS, PROMPT_RETURN_ANCHOR, parseProseResponse,
  PROSE_SYSTEM_PROMPT, PROSE_MAX_TOKENS, BANNED_PHRASES, exemplarSpec, EXEMPLAR_PROMPT, EXEMPLAR_RESPONSE,
  proseFewShot,
} from '../src/prose/promptV2';
import { PROSE_V2_KEYS, validateProseV2, KEYBOARD_KEYS } from '../src/prose/v2';
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

describe('PROSE_KEY_INSTRUCTIONS for the usage sections', () => {
  it('asks for situations, then alternatives in a fixed shape, then mirrored one-topic pairs', () => {
    const p = buildProsePrompt(spec, new Set(['whenToUse', 'whenNotToUse', 'guidelines']));
    // When to use: situations, never rules.
    expect(p).toContain('each names a task or context, never a rule about how to use it');
    // When not to use: a situation and the alternative, never a don't card.
    expect(p).toContain('each phrased "For <situation>, use <alternative> instead"');
    expect(p).toContain('never start with "Do not"');
    // Guidelines: about using the component once chosen, one topic per pair,
    // the don't mirrors the do, nothing repeated from When to use.
    expect(p).toContain('about using this component once chosen');
    expect(p).toContain('each pair covers one topic drawn from its options, states or text parts');
    expect(p).toContain('the dont mirrors the do');
    expect(p).toContain('no pair repeats a When to use or When not to use bullet');
  });
});

describe('parseProseResponse (v2)', () => {
  it('reads a plain JSON object and adds the v marker', () => {
    const out = parseProseResponse(JSON.stringify({ overview: { lede: 'L.', body: ['B.'] }, pointer: ['P.'] }));
    expect(out).toEqual({ v: 2, overview: { lede: 'L.', body: ['B.'] }, pointer: ['P.'] });
  });

  it('strips a code fence and any preamble before it', () => {
    const out = parseProseResponse('Here you go:\n```json\n{"pointer":["P."]}\n```');
    expect(out.pointer).toEqual(['P.']);
  });

  it('throws on malformed JSON and on a non-object', () => {
    expect(() => parseProseResponse('{not json')).toThrow(/Failed to parse prose response/);
    expect(() => parseProseResponse('[1,2]')).toThrow(/must be a JSON object/);
  });

  it('drops keys it does not know and fields of the wrong shape, keeping the rest', () => {
    // whenToUse is 42 (a number), not a string: asStringList requires a string
    // or a string[], so this must be dropped rather than coerced. A string
    // value here (even one reading "not an array") would instead be wrapped
    // into a one-item list per the lone-string coercion the next test pins,
    // so it would not demonstrate a wrong-shape drop.
    const out = parseProseResponse(JSON.stringify({
      definition: 'v1 leftover', overview: 'not an object', whenToUse: 42,
      keyboard: [{ keys: ['Tab'], action: 'Moves focus.' }], semantics: ['S.'],
    }));
    expect(out).toEqual({ v: 2, keyboard: [{ keys: ['Tab'], action: 'Moves focus.' }], semantics: ['S.'] });
  });

  it('coerces a lone string into a one-item list for list keys, as the v1 parser did', () => {
    const out = parseProseResponse(JSON.stringify({ whenToUse: 'One situation.' }));
    expect(out.whenToUse).toEqual(['One situation.']);
  });

  it('keeps an object field for the keyed lists without validating names (validation does that)', () => {
    const out = parseProseResponse(JSON.stringify({ anatomyParts: [{ name: 'Ghost', role: 'Boo.' }] }));
    expect(out.anatomyParts).toEqual([{ name: 'Ghost', role: 'Boo.' }]);
  });
});

describe('PROSE_SYSTEM_PROMPT (v9)', () => {
  it('states the voice rules the spec lists', () => {
    for (const rule of [
      'Second person, verb first, one idea per sentence.',
      'Every rule carries its reason.',
      'Name only what the prompt lists',
      "The designer's description, when given, is authoritative",
      'States are not variants.',
      'Return only the JSON object',
    ]) expect(PROSE_SYSTEM_PROMPT).toContain(rule);
  });

  it('lists every banned phrase in quotes and uses none of them as prose', () => {
    for (const phrase of BANNED_PHRASES) expect(PROSE_SYSTEM_PROMPT).toContain(`"${phrase}"`);
    const withoutQuotes = PROSE_SYSTEM_PROMPT.replace(/"[^"]*"/g, '');
    for (const phrase of BANNED_PHRASES) expect(withoutQuotes.toLowerCase()).not.toContain(phrase);
  });

  it('forbids em dashes and headings and uses neither', () => {
    expect(PROSE_SYSTEM_PROMPT).toContain('No em dashes and no spaced en dashes.');
    expect(PROSE_SYSTEM_PROMPT).not.toMatch(/[—–]/);
    expect(PROSE_SYSTEM_PROMPT).not.toMatch(/^#{1,2}\s/m);
  });

  it('lists the keyboard vocabulary exactly', () => {
    expect(PROSE_SYSTEM_PROMPT).toContain(KEYBOARD_KEYS.join(', '));
  });

  it('gives When to use and the guidelines different jobs and forbids saying a fact twice', () => {
    // The first live Button run wrote the same three rules under When not to
    // use and again as DON'T cards. The two sections answer different
    // questions, and the prompt has to say which.
    expect(PROSE_SYSTEM_PROMPT).toContain('Say each fact once.');
    expect(PROSE_SYSTEM_PROMPT).toContain(
      'When to use and When not to use are about choosing this component over another; the guidelines are about using it well once chosen.',
    );
  });
});

describe('the Text field exemplar', () => {
  const spec = exemplarSpec();

  it('is a real extraction with text parts, a hidden nested icon, two option axes and a state axis', () => {
    expect(spec.name).toBe('Text field');
    expect(spec.anatomy.map((p) => p.name)).toEqual(['Label', 'Input', 'Leading icon', 'Placeholder', 'Helper text']);
    expect(spec.anatomy.find((p) => p.name === 'Leading icon')).toMatchObject({ nested: true, component: 'Icon', shownBy: 'Show leading icon' });
    expect(spec.variants.map((v) => v.prop)).toEqual(['Size', 'Style', 'State']);
    // detectStateMatrix orders states by the lifecycle vocabulary: disabled sorts before error.
    expect(spec.states).toEqual(['Enabled', 'Hover', 'Focused', 'Disabled', 'Error']);
    expect(spec.description).toBe('A single-line field where people type short, free-form text.');
  });

  it('prompt is exactly what the real builder produces for the exemplar spec', () => {
    expect(EXEMPLAR_PROMPT).toBe(buildProsePrompt(spec));
    expect(EXEMPLAR_PROMPT.startsWith('Component: Text field\n')).toBe(true);
    expect(EXEMPLAR_PROMPT).toContain("Designer's description");
  });

  it('response fills every contract key and validates with nothing dropped', () => {
    for (const key of PROSE_V2_KEYS) expect(EXEMPLAR_RESPONSE[key], key).toBeDefined();
    const { prose, dropped } = validateProseV2(spec, EXEMPLAR_RESPONSE);
    expect(dropped).toEqual({});
    expect(prose).toEqual(EXEMPLAR_RESPONSE);
  });

  it('names only real parts, properties, option values and states', () => {
    const parts = new Set(spec.anatomy.map((p) => p.name));
    for (const p of EXEMPLAR_RESPONSE.anatomyParts!) expect(parts.has(p.name), p.name).toBe(true);
    const props = new Set(spec.props.map((p) => p.name));
    for (const p of EXEMPLAR_RESPONSE.properties!) expect(props.has(p.name), p.name).toBe(true);
    const options = new Set(spec.variants.filter((v) => v.prop !== 'State').flatMap((v) => v.values));
    for (const g of EXEMPLAR_RESPONSE.variantsGuide!) expect(options.has(g.name), g.name).toBe(true);
    const states = new Set(spec.states);
    for (const s of EXEMPLAR_RESPONSE.states!) expect(states.has(s.name), s.name).toBe(true);
  });

  it('is in the house voice: no banned phrase, no dash, no heading, reasons on every card', () => {
    const text = JSON.stringify(EXEMPLAR_RESPONSE).toLowerCase();
    for (const phrase of BANNED_PHRASES) expect(text).not.toContain(phrase);
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toContain('\\n#');
    for (const pair of EXEMPLAR_RESPONSE.guidelines!) {
      expect(pair.do!.reason.length).toBeGreaterThan(20);
      expect(pair.dont!.reason.length).toBeGreaterThan(20);
    }
  });

  it('names no component as an alternative, since the exemplar has no related components', () => {
    expect(spec.related).toEqual([]);
    for (const bullet of EXEMPLAR_RESPONSE.whenNotToUse!) expect(bullet).not.toMatch(/\b[A-Z][a-z]+ (field|picker|area)\b/);
  });

  it('phrases When not to use as a situation with an alternative, never as a rule', () => {
    for (const bullet of EXEMPLAR_RESPONSE.whenNotToUse!) {
      expect(bullet, bullet).toMatch(/^For .+, use .+ instead/);
      expect(bullet, bullet).not.toMatch(/^Do not/);
    }
    for (const bullet of EXEMPLAR_RESPONSE.whenToUse!) expect(bullet, bullet).not.toMatch(/^Do not/);
  });

  it('makes every guideline pair a mirror on one topic', () => {
    // One topic word per pair, present in both the do rule and the dont rule.
    const topics = [/label/i, /validat|error/i, /size/i];
    const pairs = EXEMPLAR_RESPONSE.guidelines!;
    expect(pairs).toHaveLength(topics.length);
    pairs.forEach((pair, i) => {
      expect(pair.do!.rule, `do ${i}`).toMatch(topics[i]);
      expect(pair.dont!.rule, `dont ${i}`).toMatch(topics[i]);
    });
  });

  it('fits the output cap with room for a richer component and for thinking tokens', () => {
    const chars = JSON.stringify(EXEMPLAR_RESPONSE).length;
    expect(chars).toBeLessThan(6000);
    // 3.5 characters per token is a conservative estimate for English JSON.
    expect(Math.ceil(chars / 3.5) * 3).toBeLessThan(PROSE_MAX_TOKENS);
  });

  it('few-shot turns carry the exemplar with exactly one cache breakpoint on the assistant text', () => {
    const [user, assistant] = proseFewShot();
    expect(user).toEqual({ role: 'user', content: EXEMPLAR_PROMPT });
    expect(assistant).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(EXEMPLAR_RESPONSE), cache_control: { type: 'ephemeral' } }],
    });
    expect(JSON.stringify(proseFewShot()).match(/cache_control/g)).toHaveLength(1);
  });
});

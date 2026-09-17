import { describe, it, expect } from 'vitest';
import type { IntermediateSpec, ProseDrafts } from '../src/index';
import {
  upgradeProseV1, proseToLegacy, validateProseV2, normalizeKey, parseKeyboardBullet,
  splitRuleReason, firstSentence, isProseV2, hasProseContent, KEYBOARD_KEYS, type ProseV2,
} from '../src/prose/v2';

const spec = {
  name: 'Checkbox', figmaKey: '', figmaFile: 'f', figmaNode: '1:1', description: '', documentationLinks: [],
  anatomy: [
    { id: '1:2', name: 'checkboxItem', type: 'FRAME', nested: false, depth: 0, path: 'Container/checkboxItem' },
    { id: '1:3', name: 'Label', type: 'TEXT', nested: false, depth: 0, path: 'Container/Label' },
  ],
  anatomyComponentId: '1:1',
  props: [
    { name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' },
    { name: 'showLabel', kind: 'boolean', default: true },
  ],
  variants: [{ prop: 'Style', values: ['Filled', 'Outlined'] }, { prop: 'State', values: ['Default', 'Hover'] }],
  variantInstances: [], states: ['Default', 'Hover'], tokens: [], related: ['Radio'], gaps: [], layout: [],
  rawValues: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const v1: ProseDrafts = {
  definition: 'A Checkbox selects one option. Use it in forms.\n\nIt pairs a box with a label.',
  accessibility: '- **Semantics:** render a native `<input type="checkbox">`.\n- **Name:** the label names it.',
  dos: ['**Pair the box with a label.** The label widens the target.', 'Keep labels short.'],
  donts: ['**Do not use it for one choice.** Use a Radio instead.'],
  interactions: '### Mouse\n- Clicking the box toggles it.\n### Keyboard\n- Tab moves focus to the box.\n- Enter or Space toggles it.\n- Arrow keys do nothing.\n- The focus ring is drawn by the browser.\n### Other\n- Screen readers announce the state.',
  variantsSummary: 'Style sets the visual weight.\n\n**When to use each:**\n- **Filled**: the default.\n- **Outlined**: dense layouts.',
  anatomySummary: 'A box and a label.',
  anatomyParts: [{ name: 'Label', description: 'Names the option.' }],
  contentConsiderations: '- Write labels as statements.',
  designConsiderations: '- Dropped on upgrade.',
};

describe('firstSentence', () => {
  it('splits at the first sentence boundary followed by a capital', () => {
    expect(firstSentence('A box. Use it. Then stop.')).toEqual({ sentence: 'A box.', remainder: 'Use it. Then stop.' });
  });
  it('does not split on abbreviations or decimals', () => {
    expect(firstSentence('Pick 3.5 items e.g. often. Next.').sentence).toBe('Pick 3.5 items e.g. often.');
  });
});

describe('normalizeKey', () => {
  it('accepts every vocabulary spelling and its variants', () => {
    expect(normalizeKey('tab')).toEqual(['Tab']);
    expect(normalizeKey('Shift + Tab')).toEqual(['Shift+Tab']);
    expect(normalizeKey('ArrowUp')).toEqual(['Arrow Up']);
    expect(normalizeKey('Esc')).toEqual(['Escape']);
    expect(normalizeKey('Arrow keys')).toEqual(['Arrow Up', 'Arrow Down', 'Arrow Left', 'Arrow Right']);
    expect(normalizeKey('Cmd+K')).toBeNull();
  });
  it('vocabulary is the canonical list', () => {
    expect(KEYBOARD_KEYS).toContain('Page Down');
    expect(KEYBOARD_KEYS).toHaveLength(15);
  });
});

describe('parseKeyboardBullet', () => {
  it('reads leading keys joined by or, slash, comma or and', () => {
    expect(parseKeyboardBullet('Enter or Space toggles it.')).toEqual({ keys: ['Enter', 'Space'], action: 'Toggles it.' });
    expect(parseKeyboardBullet('Tab / Shift+Tab move focus.')).toEqual({ keys: ['Tab', 'Shift+Tab'], action: 'Move focus.' });
  });
  it('returns null when the sentence does not open with a key', () => {
    expect(parseKeyboardBullet('The focus ring is drawn by the browser.')).toBeNull();
  });
});

describe('splitRuleReason', () => {
  it('splits at the end of the first bold run', () => {
    expect(splitRuleReason('**Pair the box with a label.** The label widens the target.'))
      .toEqual({ rule: 'Pair the box with a label.', reason: 'The label widens the target.' });
  });
  it('falls back to the first sentence', () => {
    expect(splitRuleReason('Keep labels short. People scan them.'))
      .toEqual({ rule: 'Keep labels short.', reason: 'People scan them.' });
    expect(splitRuleReason('Keep labels short.')).toEqual({ rule: 'Keep labels short.', reason: '' });
  });
});

describe('upgradeProseV1', () => {
  const v2 = upgradeProseV1(v1);
  it('is marked v2 and drops design considerations', () => {
    expect(v2.v).toBe(2);
    expect(isProseV2(v2)).toBe(true);
    expect('designConsiderations' in v2).toBe(false);
  });
  it('splits the definition into lede and body paragraphs', () => {
    expect(v2.overview).toEqual({ lede: 'A Checkbox selects one option.', body: ['Use it in forms.', 'It pairs a box with a label.'] });
  });
  it('splits the variants summary into intro and guide pairs', () => {
    expect(v2.variantsIntro).toBe('Style sets the visual weight.\n\n**When to use each:**');
    expect(v2.variantsGuide).toEqual([{ name: 'Filled', guidance: 'the default.' }, { name: 'Outlined', guidance: 'dense layouts.' }]);
  });
  it('renames anatomy descriptions to roles', () => {
    expect(v2.anatomyParts).toEqual([{ name: 'Label', role: 'Names the option.' }]);
  });
  it('turns accessibility and content bullets into sentence arrays, bold kept', () => {
    expect(v2.semantics).toEqual(['**Semantics:** render a native `<input type="checkbox">`.', '**Name:** the label names it.']);
    expect(v2.content).toEqual(['Write labels as statements.']);
  });
  it('routes keyboard bullets to rows and everything else to pointer, counting drops', () => {
    expect(v2.keyboard).toEqual([
      { keys: ['Tab'], action: 'Moves focus to the box.' },
      { keys: ['Enter', 'Space'], action: 'Toggles it.' },
      { keys: ['Arrow Up', 'Arrow Down', 'Arrow Left', 'Arrow Right'], action: 'Do nothing.' },
    ]);
    expect(v2.pointer).toEqual(['Clicking the box toggles it.', 'Screen readers announce the state.']);
  });
  it('pairs dos and donts by index, leaving an unpaired remainder half-empty', () => {
    expect(v2.guidelines).toEqual([
      { do: { rule: 'Pair the box with a label.', reason: 'The label widens the target.' },
        dont: { rule: 'Do not use it for one choice.', reason: 'Use a Radio instead.' } },
      { do: { rule: 'Keep labels short.', reason: '' }, dont: null },
    ]);
  });
  it('yields an empty object body for an empty v1', () => {
    const empty = upgradeProseV1({ definition: '', accessibility: '', dos: [], donts: [] });
    expect(empty).toEqual({ v: 2 });
    expect(hasProseContent(empty)).toBe(false);
    expect(hasProseContent(v2)).toBe(true);
  });
});

describe('proseToLegacy', () => {
  it('flattens back to the v1 shape the brief and v5 artifact read', () => {
    const legacy = proseToLegacy(upgradeProseV1(v1));
    expect(legacy.definition).toBe('A Checkbox selects one option.\n\nUse it in forms.\n\nIt pairs a box with a label.');
    expect(legacy.accessibility).toBe('- **Semantics:** render a native `<input type="checkbox">`.\n- **Name:** the label names it.');
    expect(legacy.dos).toEqual(['**Pair the box with a label.** The label widens the target.', '**Keep labels short.**']);
    expect(legacy.donts).toEqual(['**Do not use it for one choice.** Use a Radio instead.']);
    expect(legacy.interactions).toBe('### Keyboard\n- Tab: Moves focus to the box.\n- Enter or Space: Toggles it.\n- Arrow Up or Arrow Down or Arrow Left or Arrow Right: Do nothing.\n### Other\n- Clicking the box toggles it.\n- Screen readers announce the state.');
    expect(legacy.variantsSummary).toBe('Style sets the visual weight.\n\n**When to use each:**\n- **Filled**: the default.\n- **Outlined**: dense layouts.');
    expect(legacy.anatomyParts).toEqual([{ name: 'Label', description: 'Names the option.' }]);
    expect(legacy.contentConsiderations).toBe('- Write labels as statements.');
    expect('designConsiderations' in legacy).toBe(false);
  });
  it('returns the empty v1 shape for an empty v2', () => {
    expect(proseToLegacy({ v: 2 })).toEqual({ definition: '', accessibility: '', dos: [], donts: [] });
  });
});

describe('validateProseV2', () => {
  const dirty: ProseV2 = {
    v: 2,
    variantsGuide: [{ name: 'filled', guidance: 'ok' }, { name: 'Ghost', guidance: 'invented' }],
    anatomyParts: [{ name: 'label', role: 'ok' }, { name: 'Icon', role: 'invented' }],
    properties: [{ name: 'showLabel', description: 'ok' }, { name: 'size', description: 'invented' }],
    states: [{ name: 'hover', whenItApplies: 'ok' }, { name: 'Loading', whenItApplies: 'invented' }],
    keyboard: [{ keys: ['Enter'], action: 'ok' }, { keys: ['Cmd+K'], action: 'invented' }, { keys: [], action: 'no keys' }],
    pointer: ['ok', '', '  '],
    guidelines: [{ do: { rule: '', reason: '' }, dont: null }, { do: { rule: 'Keep it.', reason: 'x' }, dont: null }],
    overview: { lede: 'A box — with a dash.', body: [] },
  };
  const { prose, dropped } = validateProseV2(spec, dirty);
  it('keeps only names that exist, matching case-insensitively', () => {
    expect(prose.variantsGuide).toEqual([{ name: 'filled', guidance: 'ok' }]);
    expect(prose.anatomyParts).toEqual([{ name: 'label', role: 'ok' }]);
    expect(prose.properties).toEqual([{ name: 'showLabel', description: 'ok' }]);
    expect(prose.states).toEqual([{ name: 'hover', whenItApplies: 'ok' }]);
  });
  it('keeps only vocabulary keys and non-empty rows', () => {
    expect(prose.keyboard).toEqual([{ keys: ['Enter'], action: 'ok' }]);
    expect(prose.pointer).toEqual(['ok']);
    expect(prose.guidelines).toEqual([{ do: { rule: 'Keep it.', reason: 'x' }, dont: null }]);
  });
  it('normalises dashes and counts every drop per key', () => {
    expect(prose.overview).toEqual({ lede: 'A box, with a dash.', body: [] });
    expect(dropped).toEqual({ variantsGuide: 1, anatomyParts: 1, properties: 1, states: 1, keyboard: 2, pointer: 2, guidelines: 1 });
  });
  it('omits a key whose survivors are empty', () => {
    const { prose: p } = validateProseV2(spec, { v: 2, keyboard: [{ keys: ['Cmd+K'], action: 'x' }] });
    expect('keyboard' in p).toBe(false);
  });
});

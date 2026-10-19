import { describe, expect, it } from 'vitest';
import { contentHash } from '@spec-layer/extractor';
import {
  writeDescriptions, writeKey, aiTextUnedited, AI_DESCRIPTION_KEY,
  type DescriptionHost, type WritableComponent, type WritableDescribed,
} from '../src/descriptionWriter';

function described(description = ''): WritableDescribed {
  const data = new Map<string, string>();
  return { description, getPluginData: (k) => data.get(k) ?? '', setPluginData: (k, v) => { data.set(k, v); } };
}
function component(): WritableComponent & { slots: Record<string, string> } {
  const base = described();
  const slots: Record<string, string> = {};
  return {
    ...base, slots,
    editComponentProperty: (name, value) => {
      if (!(name in slots) && name !== 'Content#1:2') throw new Error('No such property');
      slots[name] = value.description ?? '';
      return name;
    },
  };
}
function host(over: Partial<DescriptionHost> = {}): DescriptionHost {
  return {
    variable: async () => null, style: async () => null, component: async () => null, ...over,
  };
}

describe('writeDescriptions', () => {
  it('writes each kind into its own field', async () => {
    const v = described(); const s = described(); const c = component();
    const out = await writeDescriptions(host({
      variable: async (id) => (id === 'V1' ? v : null),
      style: async (id) => (id === 'S1' ? s : null),
      component: async (id) => (id === '1:1' ? c : null),
    }), [
      { kind: 'variable', id: 'V1', text: 'Page background.', origin: 'person' },
      { kind: 'style', id: 'S1', text: 'Body text.', origin: 'person' },
      { kind: 'component', id: '1:1', text: 'Groups content.', origin: 'person' },
      { kind: 'slot', id: '1:1', propertyName: 'Content#1:2', text: 'The body.', origin: 'person' },
    ]);
    expect(v.description).toBe('Page background.');
    expect(s.description).toBe('Body text.');
    expect(c.description).toBe('Groups content.');
    expect(c.slots['Content#1:2']).toBe('The body.');
    expect(out).toEqual({ written: ['variable:V1', 'style:S1', 'component:1:1', 'slot:1:1:Content#1:2'], failed: [] });
  });

  it('one failure never blocks the rest, and is named', async () => {
    const v = described();
    const out = await writeDescriptions(host({ variable: async (id) => (id === 'V1' ? v : null) }), [
      { kind: 'variable', id: 'gone', text: 'x', origin: 'person' },
      { kind: 'variable', id: 'V1', text: 'Kept.', origin: 'person' },
    ]);
    expect(v.description).toBe('Kept.');
    expect(out.written).toEqual(['variable:V1']);
    expect(out.failed).toEqual([{ key: 'variable:gone', message: 'That variable is no longer in this file.' }]);
  });

  it('skips empty text without touching the field', async () => {
    const v = described('Before.');
    const out = await writeDescriptions(host({ variable: async () => v }), [{ kind: 'variable', id: 'V1', text: '   ', origin: 'person' }]);
    expect(v.description).toBe('Before.');
    expect(out).toEqual({ written: [], failed: [{ key: 'variable:V1', message: 'Nothing to write.' }] });
  });

  it('marks AI text saved unedited, and a person edit clears the mark', async () => {
    const v = described();
    await writeDescriptions(host({ variable: async () => v }), [{ kind: 'variable', id: 'V1', text: 'Drafted.', origin: 'ai' }]);
    expect(JSON.parse(v.getPluginData(AI_DESCRIPTION_KEY))).toEqual({ description: contentHash('Drafted.') });
    expect(aiTextUnedited(v, 'description', 'Drafted.')).toBe(true);
    expect(aiTextUnedited(v, 'description', 'Drafted, then edited.')).toBe(false);
    await writeDescriptions(host({ variable: async () => v }), [{ kind: 'variable', id: 'V1', text: 'Mine.', origin: 'person' }]);
    expect(v.getPluginData(AI_DESCRIPTION_KEY)).toBe('');
  });

  it('keys a slot mark by its property name on the component', async () => {
    const c = component();
    await writeDescriptions(host({ component: async () => c }), [{ kind: 'slot', id: '1:1', propertyName: 'Content#1:2', text: 'Drafted.', origin: 'ai' }]);
    expect(JSON.parse(c.getPluginData(AI_DESCRIPTION_KEY))).toEqual({ 'Content#1:2': contentHash('Drafted.') });
  });
});

describe('writeKey', () => {
  it('is stable per field', () => {
    expect(writeKey({ kind: 'variable', id: 'V1' })).toBe('variable:V1');
    expect(writeKey({ kind: 'slot', id: '1:1', propertyName: 'Content#1:2' })).toBe('slot:1:1:Content#1:2');
  });
});

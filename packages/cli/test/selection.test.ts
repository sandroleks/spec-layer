import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SELECTION, selectionFromFlags, resolveSelection, matchesName, selectComponents,
} from '../src/selection';
import type { BundleV1 } from '../src/bundle';

const artifact = (hash: string) => ({ spec_layer: { export: { content_hash: hash.repeat(64) } } });

const BUNDLE: BundleV1 = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'foundation: yes\n', artifact: artifact('f') },
  components: [
    { name: 'Button', ai: 'button: yes\n', artifact: artifact('a') },
    { name: 'Icon Button', ai: 'icon: yes\n', artifact: artifact('b') },
    { name: 'Card', ai: 'card: yes\n', artifact: artifact('c') },
  ],
};

describe('selectionFromFlags', () => {
  it('returns null when no selection flag is present', () => {
    expect(selectionFromFlags({})).toBeNull();
  });

  it('--only foundation selects the foundation and no components', () => {
    expect(selectionFromFlags({ only: 'foundation' })).toEqual({ foundation: true, components: [] });
  });

  it('--only components drops the foundation and keeps every component', () => {
    expect(selectionFromFlags({ only: 'components' })).toEqual({ foundation: false, components: null });
  });

  it('--component lists the named components and keeps the foundation', () => {
    expect(selectionFromFlags({ component: ['Button', 'Card'] }))
      .toEqual({ foundation: true, components: ['Button', 'Card'] });
  });

  it('--only components with --component narrows both', () => {
    expect(selectionFromFlags({ only: 'components', component: ['Card'] }))
      .toEqual({ foundation: false, components: ['Card'] });
  });

  it('rejects --only foundation combined with --component', () => {
    expect(() => selectionFromFlags({ only: 'foundation', component: ['Card'] }))
      .toThrow(/--only foundation.*--component/);
  });

  it('rejects an unknown --only value and names the accepted ones', () => {
    expect(() => selectionFromFlags({ only: 'tokens' })).toThrow(/foundation|components/);
  });
});

describe('resolveSelection', () => {
  it('defaults to everything when neither flags nor config select', () => {
    expect(resolveSelection({}, null)).toEqual(DEFAULT_SELECTION);
    expect(DEFAULT_SELECTION).toEqual({ foundation: true, components: null });
  });

  it('uses the config include block when no flag is present', () => {
    const config = { include: { foundation: false, components: ['Card'] } };
    expect(resolveSelection({}, config)).toEqual({ foundation: false, components: ['Card'] });
  });

  it('flags replace the config selection entirely rather than merging', () => {
    const config = { include: { foundation: false, components: ['Card'] } };
    expect(resolveSelection({ component: ['Button'] }, config))
      .toEqual({ foundation: true, components: ['Button'] });
  });
});

describe('matchesName', () => {
  it('matches by slug so case and separators do not matter', () => {
    expect(matchesName('button', 'Button')).toBe(true);
    expect(matchesName('icon-button', 'Icon Button')).toBe(true);
    expect(matchesName('Icon Button', 'icon_button')).toBe(true);
  });

  it('does not match a different component', () => {
    expect(matchesName('button', 'Icon Button')).toBe(false);
  });
});

describe('selectComponents', () => {
  it('selects every component when components is null', () => {
    expect(selectComponents(BUNDLE, DEFAULT_SELECTION)).toEqual([true, true, true]);
  });

  it('selects none when components is empty', () => {
    expect(selectComponents(BUNDLE, { foundation: true, components: [] })).toEqual([false, false, false]);
  });

  it('selects the named components by slug', () => {
    expect(selectComponents(BUNDLE, { foundation: true, components: ['card', 'icon-button'] }))
      .toEqual([false, true, true]);
  });

  it('selects every component sharing a duplicated name', () => {
    const bundle: BundleV1 = {
      ...BUNDLE,
      components: [
        { name: 'Button', ai: 'a\n', artifact: artifact('a') },
        { name: 'button', ai: 'b\n', artifact: artifact('b') },
        { name: 'Card', ai: 'c\n', artifact: artifact('c') },
      ],
    };
    expect(selectComponents(bundle, { foundation: true, components: ['Button'] })).toEqual([true, true, false]);
  });

  it('fails when a name matches nothing and lists what the bundle has', () => {
    expect(() => selectComponents(BUNDLE, { foundation: true, components: ['Toast'] }))
      .toThrow(/Toast.*\n?.*Button.*Icon Button.*Card/s);
  });
});

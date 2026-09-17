import { describe, it, expect } from 'vitest';
import { displayComponentName, displayPartName } from '../src/ui/displayNames';

describe('displayComponentName', () => {
  it('capitalises a fully lowercase name', () => {
    expect(displayComponentName('checkbox')).toBe('Checkbox');
    expect(displayComponentName('text field')).toBe('Text field');
  });
  it('leaves a name with any capital exactly as typed', () => {
    expect(displayComponentName('iOS Toggle')).toBe('iOS Toggle');
    expect(displayComponentName('Button')).toBe('Button');
  });
  it('drops a leading atom marker', () => {
    expect(displayComponentName('.icon')).toBe('Icon');
    expect(displayComponentName('_Base Button')).toBe('Base Button');
  });
  it('returns an empty name unchanged', () => {
    expect(displayComponentName('')).toBe('');
  });
});

describe('displayPartName', () => {
  it('splits simple camelCase into words', () => {
    expect(displayPartName('checkboxItem')).toBe('Checkbox item');
    expect(displayPartName('leadingIconSlot')).toBe('Leading icon slot');
  });
  it('splits snake_case and kebab-case', () => {
    expect(displayPartName('icon_left')).toBe('Icon left');
    expect(displayPartName('icon-right-2')).toBe('Icon right 2');
  });
  it('leaves names with spaces, capitals runs, or leading capitals as typed', () => {
    expect(displayPartName('Label')).toBe('Label');
    expect(displayPartName('Leading icon')).toBe('Leading icon');
    expect(displayPartName('iOSToggle')).toBe('iOSToggle');
    expect(displayPartName('URLField')).toBe('URLField');
  });
});

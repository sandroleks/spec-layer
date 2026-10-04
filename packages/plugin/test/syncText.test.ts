import { describe, it, expect } from 'vitest';
import type { ProseV2 } from '@spec-layer/extractor';
import { descriptionText, provenanceLine, calendarDate, fileKeyFromUrl, sectionLink } from '../src/syncText';

const PROSE: ProseV2 = {
  v: 2,
  overview: { lede: 'A button starts an action.', body: ['Use one per view for the main action.'] },
  whenToUse: ['To submit a form.', '  '],
  whenNotToUse: ['To navigate to another page.'],
  keyboard: [{ keys: ['Enter'], action: 'Activates the button.' }],
};

describe('descriptionText', () => {
  it('writes the Usage text and nothing else', () => {
    const d = descriptionText(PROSE, '2026-10-03');
    expect(d?.body).toBe(
      'A button starts an action.\n\nUse one per view for the main action.\n\n' +
      '**When to use**\n- To submit a form.\n\n**When not to use**\n- To navigate to another page.',
    );
    expect(d?.markdown).toBe(`${d?.body}\n\nWritten with AI in Spec Layer · 2026-10-03`);
    expect(d?.markdown).not.toContain('Enter');
  });

  it('leaves an empty section out instead of filling it', () => {
    const d = descriptionText({ v: 2, whenToUse: ['To confirm.'] }, '2026-10-03');
    expect(d?.body).toBe('**When to use**\n- To confirm.');
  });

  it('is null when no Usage section has text', () => {
    expect(descriptionText(null, '2026-10-03')).toBeNull();
    expect(descriptionText({ v: 2, overview: { lede: ' ', body: [] }, keyboard: [] }, '2026-10-03')).toBeNull();
  });

  it('names the origin from what a person edited', () => {
    expect(descriptionText({ ...PROSE, authored: ['overview', 'whenToUse', 'whenNotToUse'] }, 'd')?.origin).toBe('authored');
    expect(descriptionText({ ...PROSE, authored: ['overview'] }, 'd')?.origin).toBe('mixed');
    expect(descriptionText({ ...PROSE, authored: ['keyboard'] }, 'd')?.origin).toBe('ai');
  });

  it('keeps the body identical across days, so a re-sync writes nothing new', () => {
    expect(descriptionText(PROSE, '2026-10-03')?.body).toBe(descriptionText(PROSE, '2027-01-01')?.body);
  });

  it('never writes an em dash', () => {
    expect(descriptionText(PROSE, '2026-10-03')?.markdown).not.toMatch(/—/);
    expect(provenanceLine('authored', 'x')).not.toMatch(/—/);
  });
});

describe('links', () => {
  it('reads the file key from design and file links only', () => {
    expect(fileKeyFromUrl('https://www.figma.com/design/AbCdEf1234567890/My-file?node-id=1-2')).toBe('AbCdEf1234567890');
    expect(fileKeyFromUrl('https://figma.com/file/AbCdEf1234567890')).toBe('AbCdEf1234567890');
    expect(fileKeyFromUrl('https://example.com/design/AbCdEf1234567890')).toBeNull();
    expect(fileKeyFromUrl('figma.com/design/AbCdEf1234567890')).toBeNull();
    expect(fileKeyFromUrl('')).toBeNull();
  });

  it('builds the doc Section link with dashes in the node id', () => {
    expect(sectionLink('AbCdEf1234567890', '12:34')).toBe('https://www.figma.com/design/AbCdEf1234567890/?node-id=12-34');
  });

  it('formats a local calendar date', () => {
    expect(calendarDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

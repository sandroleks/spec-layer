import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { VersionLog } from '@spec-layer/extractor';
import { historyHeaderMarkup, historyScrollMarkup } from '../src/ui/screens/history';
import type { HistoryState } from '../src/ui/history';

const LOG: VersionLog = { v: 1, records: [
  {
    version: '2.0.0', publishedAt: '2026-09-12T10:00:00.000Z', bump: 'major', minimumBump: 'minor',
    note: 'Card is new API and the old icon slot is gone.', contentHash: 'c2', bundleHash: 'b2', extractorVersion: '2', pluginVersion: '5.1.0',
    counts: { major: 1, minor: 1, patch: 1 },
    changes: [
      { kind: 'removed', entity: 'property', component: 'Button', id: 'icon', name: 'icon', from: 'instanceSwap', to: null, scope: null, bump: 'major' },
      { kind: 'added', entity: 'component', component: 'Card', id: 'key-card', name: 'Card', from: null, to: null, scope: null, bump: 'minor' },
      { kind: 'changed', entity: 'token_value', component: null, id: 'V1', name: 'color/primary', from: '#6750a4', to: '#5b438f', scope: 'Light', bump: 'patch' },
    ],
    changesTruncated: false,
  },
  {
    version: '1.0.0', publishedAt: '2026-09-01T10:00:00.000Z', bump: 'initial', minimumBump: null, note: null,
    contentHash: 'c1', bundleHash: 'b1', extractorVersion: '2', pluginVersion: '5.0.0',
    counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
  },
] };

const state = (over: Partial<HistoryState> = {}): HistoryState => ({
  status: 'ready', log: LOG, etag: null, message: null, expanded: null, ...over,
});

describe('history screen', () => {
  it('has a back control to the publish screen and the title', () => {
    expect(historyHeaderMarkup()).toContain('data-history-back');
    expect(historyHeaderMarkup()).toContain('<h1>Version history</h1>');
  });

  it('renders one row per record, newest first, with version, bump badge, time, and the note', () => {
    const markup = historyScrollMarkup(state(), 'en-GB');
    expect(markup.indexOf('v2.0.0')).toBeLessThan(markup.indexOf('v1.0.0'));
    expect(markup).toContain('<span class="sl-badge" data-tone="danger">Major</span>');
    expect(markup).toContain('<span class="sl-badge" data-tone="success">First version</span>');
    expect(markup).toContain('<span class="sl-tooltip" role="tooltip">Something was removed or renamed. Code that used it may break.</span>');
    expect(markup).toContain('<span class="sl-tooltip" role="tooltip">The first publish. Nothing to compare against.</span>');
    expect(markup).toMatch(/<span class="sl-history-bump" data-tooltip-trigger><span class="sl-badge"/);
    // The whole row is the disclosure: version, badge, date, and note all sit
    // inside the one button, so a click anywhere on the row opens it.
    expect(markup).toMatch(
      /<button class="sl-history-summary" type="button" data-history-disclosure="2\.0\.0" aria-expanded="false" aria-controls="sl-history-details-2\.0\.0">[\s\S]*?<time[\s\S]*?<span class="sl-history-note">[^<]*<\/span><\/button>/,
    );
    expect(markup).not.toContain('sl-library-update-disclosure');
    expect(markup).not.toContain('sl-library-summary');
    // Rows run edge to edge like the Library list, not inside the padded
    // Publish body, so the hover band and hairlines span the panel.
    expect(markup).toMatch(/^<div class="sl-history-list">/);
    expect(markup).not.toContain('sl-publish-body');
    // The empty and failed states keep the padded body: they are prose.
    expect(historyScrollMarkup(state({ status: 'noLibrary' }))).toMatch(/^<div class="sl-publish-body sl-history-body">/);
    expect(markup).toMatch(/<time datetime="2026-09-12T10:00:00.000Z">\d{1,2} Sept 2026, \d{2}:\d{2}<\/time>/);
    expect(markup).toContain('class="sl-history-note">Card is new API and the old icon slot is gone.<');
  });

  it('renders one card per subject, Foundations first, and renders from and to in two spans', () => {
    const markup = historyScrollMarkup(state({ expanded: '2.0.0' }), 'en-GB');
    const foundations = markup.indexOf('<strong>Foundations</strong>');
    const button = markup.indexOf('<strong>Button</strong>');
    const card = markup.indexOf('<strong>Card</strong>');
    expect(foundations).toBeGreaterThan(-1);
    expect(foundations).toBeLessThan(button);
    expect(button).toBeLessThan(card);
    expect(markup).not.toContain('<strong>Removed</strong>');
    expect(markup).not.toContain('<strong>Components</strong>');
    expect(markup).toContain('<li data-change-kind="removed"><span class="sl-history-name">Property icon removed</span>');
    expect(markup).toContain('<span class="sl-history-name">color/primary in Light</span>');
    expect(markup).toContain('<span class="sl-history-from">#6750a4</span><span class="sl-history-to">#5b438f</span>');
    // The mode is in the sentence, so no scope line repeats it.
    expect(markup).not.toContain('<span class="sl-library-change-scope">Light</span>');
  });

  it('lays the row out so the badge cannot run under the date', () => {
    const css = readFileSync(new URL('../src/ui/design-system/patterns.css', import.meta.url), 'utf-8');
    const rule = (selector: string) =>
      new RegExp(`\\n${selector.replace(/[.+*?^$(){}|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const summary = rule('.sl-history-summary');
    expect(summary).toMatch(/width:\s*100%/);
    expect(summary).toMatch(/grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto/);
    expect(rule('.sl-history-summary > time')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.sl-history-note')).toMatch(/grid-column:\s*1 \/ -1/);
    expect(rule('.sl-history-bump')).toMatch(/position:\s*relative/);
    expect(rule('.sl-history-row .sl-library-summary')).toBe('');
    expect(rule('.sl-history-row .sl-library-update-disclosure')).toBe('');
  });

  it('says a first version has nothing to compare, and states truncation with counts for a truncated one', () => {
    // 1.0.0 is bump 'initial' with no changes: never "No property changes",
    // which would read as if there was something to diff against.
    expect(historyScrollMarkup(state({ expanded: '1.0.0' }), 'en-GB')).toContain('First version, nothing to compare against.');
    const truncated: VersionLog = { v: 1, records: [{ ...LOG.records[0], changesTruncated: true, counts: { major: 1, minor: 2, patch: 40 } }] };
    expect(historyScrollMarkup(state({ log: truncated, expanded: '2.0.0' }), 'en-GB')).toContain('Showing the first 3 changes of 43');
  });

  it('says the changes are no longer stored for a record the log compacted, with the real counts', () => {
    // versions.ts compactLog empties `changes` and sets `changesTruncated` on
    // an old record; the pane must not read that as "No property changes".
    const compacted: VersionLog = { v: 1, records: [{ ...LOG.records[0], changes: [], changesTruncated: true }] };
    const markup = historyScrollMarkup(state({ log: compacted, expanded: '2.0.0' }), 'en-GB');
    expect(markup).toContain('The changes for this version are no longer stored (3 changes).');
    expect(markup).not.toContain('No property changes');
  });

  it('names every empty and failed state in plain words', () => {
    expect(historyScrollMarkup(state({ status: 'loading', log: null }))).toContain('Loading versions');
    expect(historyScrollMarkup(state({ log: { v: 1, records: [] } }))).toContain('No versions yet. The first publish creates 1.0.0.');
    expect(historyScrollMarkup(state({ status: 'noLibrary', log: null }))).toContain('Publish this file to start a version history.');
    expect(historyScrollMarkup(state({ status: 'noKey', log: null }))).toContain('stored on the device that published it');
    expect(historyScrollMarkup(state({ status: 'gone', log: null }))).toContain('no longer exists on the publish service');
    const error = historyScrollMarkup(state({ status: 'error', log: null, message: 'Could not reach the publish service.' }));
    expect(error).toContain('Could not reach the publish service.');
    expect(error).toContain('data-history-retry');
  });

  it('carries no em dash', () => {
    for (const s of [state(), state({ expanded: '2.0.0' }), state({ status: 'gone', log: null })]) {
      expect(historyScrollMarkup(s, 'en-GB')).not.toContain('—');
    }
  });
});

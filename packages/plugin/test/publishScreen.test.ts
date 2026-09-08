import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentSetupMessage, setupCommand, type PublishState } from '../src/ui/publish';
import { PUBLISH_DOCS_URL } from '../src/ui/proxy';
import { ICON_PATHS } from '../src/ui/shell/icons';
import type { PublishAllowance } from '../src/ui/viewModel/allowance';
import {
  publishFooterMarkup,
  publishHeaderMarkup,
  publishScrollMarkup,
} from '../src/ui/screens/publish';

const LIBRARY_ID = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
const PULL_KEY = `sl_${'b'.repeat(48)}`;

function state(overrides: Partial<PublishState> = {}): PublishState {
  return {
    status: 'idle',
    message: null,
    libraryId: null,
    pullKey: null,
    lastPublishedAt: null,
    ...overrides,
  };
}

const PUBLISHED = state({
  status: 'done',
  libraryId: LIBRARY_ID,
  pullKey: PULL_KEY,
  lastPublishedAt: '2026-09-01T00:00:00.000Z',
});

const FREE: PublishAllowance = {
  kind: 'free', remaining: 3, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z',
};

/** The screen a Pro plan sees (allowance hidden). Free has its own block below. */
const proScroll = (s: PublishState) => publishScrollMarkup(s, { kind: 'hidden' });

const ALL_STATES: PublishState['status'][] = [
  'idle',
  'collecting',
  'uploading',
  'done',
  'error',
];

const block = (markup: string, label: string): string => {
  const at = markup.indexOf(`<h2>${label}</h2>`);
  if (at < 0) return '';
  const end = markup.indexOf('</section>', at);
  return markup.slice(at, end);
};

describe('publish screen header', () => {
  it('names the act alone, with a labelled way back to the Library', () => {
    const markup = publishHeaderMarkup(state());
    expect(markup).toContain('<h1>Publish</h1>');
    expect(markup).toContain('data-publish-back');
    // Icon-only, so the accessible name is the only name it has.
    expect(markup).toContain('aria-label="Back to Library"');
    expect(markup).toContain(ICON_PATHS.chevronLeft);
  });

  /**
   * The agent prompt below is for a coding agent, so a title naming only
   * developers named half the audience.
   */
  it('does not address developers alone', () => {
    expect(publishHeaderMarkup(state())).not.toContain('for developers');
    expect(publishHeaderMarkup(PUBLISHED)).not.toContain('for developers');
  });

  it('carries the status as a pill beside the title', () => {
    expect(publishHeaderMarkup(state()))
      .toContain('<span class="sl-badge">Not published</span>');
    expect(publishHeaderMarkup(PUBLISHED))
      .toContain('<span class="sl-badge" data-tone="success">Published</span>');
    // A device that knows the id but not the key is still looking at a
    // published library.
    expect(publishHeaderMarkup(state({ libraryId: LIBRARY_ID })))
      .toContain('>Published</span>');
    const markup = publishHeaderMarkup(PUBLISHED);
    expect(markup.indexOf('<h1>')).toBeLessThan(markup.indexOf('sl-badge'));
  });

  /**
   * The `<small>` eyebrow means "what kind of thing the h1 names" ("Selected
   * component" above a component's name). Reusing it as a "Library" breadcrumb
   * would put navigation in a slot that already means something else, which is
   * the one-slot-two-categories mistake the button-icon contract exists to
   * prevent. The back control carries the navigation instead.
   */
  it('does not overload the header eyebrow with navigation', () => {
    expect(publishHeaderMarkup(state())).not.toContain('<small>');
  });
});

describe('publish screen meta line', () => {
  it('shows nothing before the first publish on a plan with no allowance to state', () => {
    expect(proScroll(state())).not.toContain('sl-publish-meta');
  });

  it('shows the recorded date in local time once published', () => {
    const markup = publishScrollMarkup(PUBLISHED, { kind: 'hidden' }, 'en-GB');
    // PUBLISHED is stamped 2026-09-01T00:00:00Z; the hour depends on the
    // machine's zone, and so can the calendar day, so only the shape is fixed.
    expect(markup).toMatch(/<span>Last published \d{1,2} \w{3,4} 2026, \d{2}:\d{2}<\/span>/);
  });

  /**
   * Never fabricate. A library published by a build that stored no date, or a
   * date that does not parse, says so rather than showing today.
   */
  it('says the date is not recorded rather than inventing one', () => {
    expect(proScroll(state({ libraryId: LIBRARY_ID, pullKey: PULL_KEY, lastPublishedAt: null })))
      .toContain('<span>Last published date not recorded</span>');
    expect(proScroll(state({ libraryId: LIBRARY_ID, lastPublishedAt: 'garbage' })))
      .toContain('Last published date not recorded');
    expect(proScroll(state({ libraryId: LIBRARY_ID, lastPublishedAt: null })))
      .not.toContain('2026');
  });

  it('shows the free allowance on a free plan and nothing on pro or unknown', () => {
    expect(publishScrollMarkup(state(), FREE))
      .toContain('<span>3 of 10 free updates left this month, resets Oct 1</span>');
    expect(publishScrollMarkup(state(), { ...FREE, remaining: 0 }))
      .toContain('<span>No free updates left this month, resets Oct 1</span>');
    expect(publishScrollMarkup(state(), { kind: 'hidden' })).not.toContain('free updates');
  });

  it('keeps Publish enabled at zero remaining, since the server decides', () => {
    const footer = publishFooterMarkup(state());
    expect(footer).toContain('data-publish');
    expect(footer).not.toContain('data-publish disabled');
  });
});

describe('publish screen body', () => {
  it('explains once, before the first publish, and names both audiences', () => {
    const markup = proScroll(state());
    expect(markup).toContain('sl-publish-intro');
    expect(markup).toContain('developers and coding agents');
    expect(markup).toContain('The setup commands appear here after the first publish.');
    expect(markup).not.toContain('sl-publish-block');
    expect(markup).not.toContain('data-publish-rotate');
    expect(markup).not.toContain('data-publish-copy-command');
  });

  /**
   * The long-form explanation lives in the documentation the footer links
   * to. A published screen is the two blocks and nothing to read first.
   */
  it('drops the explanation and the old paragraphs once published', () => {
    const markup = proScroll(PUBLISHED);
    expect(markup).not.toContain('sl-publish-intro');
    expect(markup).not.toContain('What gets published');
    expect(markup).not.toContain('Developers run this in their repo');
    expect(markup).not.toContain('Anyone with the key can pull it');
    expect(markup).not.toContain('A library is this Figma file');
  });

  it('shows the developer command and the agent prompt in full, each with its own Copy', () => {
    const markup = proScroll(PUBLISHED);
    const dev = block(markup, 'Developer setup');
    const agent = block(markup, 'AI agent setup');
    expect(dev).toContain(setupCommand(LIBRARY_ID, PULL_KEY));
    expect(dev).toContain('data-publish-copy-command');
    expect(dev).toContain('<pre class="sl-publish-code"><code>');
    // The agent message is multi-line; it has to be visible, not just copyable.
    expect(agent).toContain('npx --yes spec-layer setup');
    expect(agent).toContain('npx --yes spec-layer skill --install');
    expect(agent).toContain('data-publish-copy-agent');
    expect(agent).toContain('<pre class="sl-publish-code"><code>');
    expect(markup.indexOf('Developer setup')).toBeLessThan(markup.indexOf('AI agent setup'));
  });

  it('escapes the copied texts rather than trusting them as markup', () => {
    // The raw prompt is plain text; the rendered block carries it escaped.
    expect(proScroll(PUBLISHED)).toContain(agentSetupMessage(LIBRARY_ID, PULL_KEY).split('\n')[0]);
    const evil = proScroll(state({ libraryId: 'lib_<b>x</b>', pullKey: PULL_KEY }));
    expect(evil).toContain('lib_&lt;b&gt;x&lt;/b&gt;');
    expect(evil).not.toContain('<b>x</b>');
  });

  /**
   * Rotating is the one destructive action on the screen. It keeps the
   * secondary tone with `is-danger` on the label (`data-tone="danger"` would
   * replace the surface with a filled red block and out-shout the footer's
   * primary), and it sits in its own row after both blocks, not beside a Copy.
   */
  it('puts rotate in its own row after both blocks, with no consequence line', () => {
    const markup = proScroll(PUBLISHED);
    const rotate = /<button[^>]*data-publish-rotate[^>]*>/.exec(markup)?.[0] ?? '';
    expect(rotate).toContain('data-tone="secondary"');
    expect(rotate).toContain('is-danger');
    expect(rotate).not.toContain('data-tone="danger"');
    const row = /<div class="sl-publish-rotate">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
    expect(row).toContain('data-publish-rotate');
    expect(markup.indexOf('sl-publish-rotate')).toBeGreaterThan(markup.indexOf('AI agent setup'));
    expect(markup).not.toContain('Rotating cuts off');
    expect(markup).not.toContain('sl-publish-hint');
  });

  it('disables rotate while a publish is collecting or uploading', () => {
    for (const status of ['collecting', 'uploading'] as const) {
      const rotate = /<button[^>]*data-publish-rotate[^>]*>/.exec(proScroll({ ...PUBLISHED, status }))?.[0] ?? '';
      expect(rotate).toContain('disabled');
    }
    const idle = /<button[^>]*data-publish-rotate[^>]*>/.exec(proScroll(PUBLISHED))?.[0] ?? '';
    expect(idle).not.toContain('disabled');
  });

  /**
   * Both halves are needed to build a runnable command. Rendering a box with
   * half of it filled in would print a command that cannot work, which is the
   * fabrication the extraction invariants forbid everywhere else. The id-only
   * case still gets the Rotate action, since that is how a device without the
   * key gets one.
   */
  it('shows the library id and rotate, but no command or prompt, when the key is not on this device', () => {
    const markup = proScroll(state({ libraryId: LIBRARY_ID, pullKey: null }));
    expect(markup).toContain(`<code>${LIBRARY_ID}</code>`);
    // Says where the key is and names both ways out, and this is the one
    // place the rotate consequence is stated: rotating from a device that
    // never had the key cuts off developers the reader may not know about.
    expect(markup).toContain('stored on the device that published it');
    expect(markup).toContain('Ask that person for the setup command');
    expect(markup).toContain('rotate the key to issue a new one here');
    expect(markup).toContain('stops the current key working for everyone within about a minute');
    expect(proScroll(PUBLISHED)).not.toContain('stops the current key');
    expect(markup).toContain('data-publish-rotate');
    expect(markup).not.toContain('sl-publish-code');
    expect(markup).not.toContain('data-publish-copy-command');
    expect(markup).not.toContain('data-publish-copy-agent');
    expect(markup).not.toContain('AI agent setup');
    // A key without an id is not a library at all.
    expect(proScroll(state({ pullKey: PULL_KEY }))).not.toContain('sl-publish-code');
    expect(proScroll(state({ pullKey: PULL_KEY }))).not.toContain('data-publish-rotate');
  });

  /**
   * Success is a toast (the controller's `notify`), so a done state renders
   * no line. Errors stay on screen until the next action.
   */
  it('shows only errors as a result line, after everything else', () => {
    const failed = proScroll(
      state({ status: 'error', message: 'Could not reach the publish service.' }),
    );
    expect(failed).toContain('sl-publish-status is-error');
    expect(failed).toContain('Could not reach the publish service.');
    expect(failed.indexOf('sl-publish-status')).toBeGreaterThan(failed.indexOf('sl-publish-intro'));

    expect(proScroll(PUBLISHED)).not.toContain('sl-publish-status');
    expect(proScroll(state({ status: 'done', message: 'Published.' }))).not.toContain('Published.');
    expect(proScroll(state())).not.toContain('sl-publish-status');
  });

  it('escapes an error message rather than trusting it as markup', () => {
    const markup = proScroll(
      state({ status: 'error', message: 'Failed <b>badly</b> & loudly' }),
    );
    expect(markup).toContain('Failed &lt;b&gt;badly&lt;/b&gt; &amp; loudly');
    expect(markup).not.toContain('<b>badly</b>');
  });

  /** The publish action itself is the footer's, not the body's. */
  it('leaves the publish action and the docs link to the footer', () => {
    for (const status of ALL_STATES) {
      expect(proScroll(state({ status }))).not.toContain('data-publish>');
      expect(proScroll(state({ status }))).not.toContain('data-publish ');
    }
    expect(proScroll(PUBLISHED)).not.toContain('sl-publish-docs');
  });
});

describe('publish screen footer', () => {
  it('names the act and the object it acts on', () => {
    const markup = publishFooterMarkup(state());
    expect(markup).toContain('data-publish>');
    expect(markup).toContain('Publish library');
    expect(markup).toContain('data-tone="primary"');
  });

  /**
   * The body no longer explains publishing, so the explanation needs a
   * permanent exit: a secondary before the primary, in the order the Library
   * footer uses. An anchor with target _blank is the plugin's established way
   * to leave the iframe (Settings > About does the same).
   */
  it('offers the documentation as a secondary before the primary', () => {
    const markup = publishFooterMarkup(state());
    const link = /<a class="sl-button sl-publish-docs"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(link).toContain('data-tone="secondary"');
    expect(link).toContain(`href="${PUBLISH_DOCS_URL}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener"');
    expect(markup).toContain('Read documentation');
    expect(markup).toContain(ICON_PATHS.externalLink);
    expect(markup.indexOf('sl-publish-docs')).toBeLessThan(markup.indexOf('data-publish>'));
    expect(PUBLISH_DOCS_URL).toBe('https://spec-layer.com/docs/quickstart/#publish-pull');
  });

  /**
   * Busy is the present participle plus an ellipsis: the same button working,
   * not a new action. See docs/plugin-voice-and-copy.md, "Footer actions".
   */
  it('reports work in the label and disables the button while it runs', () => {
    for (const status of ['collecting', 'uploading'] as const) {
      const markup = publishFooterMarkup(state({ status }));
      expect(markup).toContain('data-publish disabled');
      expect(markup).toContain('Publishing…');
      expect(markup).not.toContain('Publish library');
    }
    for (const status of ['idle', 'done', 'error'] as const) {
      const markup = publishFooterMarkup(state({ status }));
      expect(markup).not.toContain('disabled');
      expect(markup).toContain('Publish library');
    }
  });

  /**
   * One glyph per button, naming the act, never changing with state. See the
   * button-icon contract in design-system/components.css: the Library primary
   * used to swap an action glyph for a warning and then a status as its state
   * changed, and a footer button that drops its glyph while busy leaves the row
   * half-drawn.
   */
  it('keeps one static glyph on the primary in every state', () => {
    for (const status of ALL_STATES) {
      const markup = publishFooterMarkup(state({ status }));
      const primary = /<button class="sl-button sl-publish-submit"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? '';
      expect(primary).toContain(ICON_PATHS.upload);
      expect(primary.split('<svg').length - 1).toBe(1);
    }
  });

  /**
   * Progress labels carry no ellipsis: `sl-work-dots` animates one after them,
   * so a written one prints twice. The BUTTON label keeps its ellipsis, since
   * it has no dots of its own.
   */
  it('reports an in-flight publish in a progress line, and only then', () => {
    expect(publishFooterMarkup(state({ status: 'collecting' })))
      .toContain('<strong>Collecting sources</strong>');
    expect(publishFooterMarkup(state({ status: 'uploading' })))
      .toContain('<strong>Uploading library</strong>');
    for (const status of ['idle', 'done', 'error'] as const) {
      expect(publishFooterMarkup(state({ status })))
        .not.toContain('sl-footer-progress');
    }
  });

  it('keeps the plugin voice: no em dashes anywhere on the screen, on any plan', () => {
    const all = [
      publishHeaderMarkup(state()),
      publishHeaderMarkup(PUBLISHED),
      ...ALL_STATES.map((status) => proScroll(state({ status }))),
      ...ALL_STATES.map((status) => publishScrollMarkup(state({ status }), FREE)),
      proScroll(PUBLISHED),
      publishScrollMarkup(PUBLISHED, FREE),
      proScroll(state({ libraryId: LIBRARY_ID })),
      ...ALL_STATES.map((status) => publishFooterMarkup(state({ status }))),
    ].join('');
    expect(all).not.toContain('—');
    expect(all).not.toContain('Pro plan required');
  });
});

describe('publish screen styling', () => {
  const css = readFileSync(
    new URL('../src/ui/design-system/patterns.css', import.meta.url),
    'utf-8',
  );
  const rule = (selector: string) =>
    new RegExp(`\\n${selector.replace(/[.+*?^$(){}|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  /**
   * Title-only screens sit on the 48px single-line bar, which is the
   * page-header default since #44; only the component screen's
   * eyebrow-plus-title header is taller. This screen must not restate the
   * default (a second copy would drift) and must not grow past it.
   */
  it('sits on the default single-line header bar without restating it', () => {
    expect(rule('.sl-page-header')).toMatch(/min-height:\s*48px/);
    const header = rule('.sl-publish-screen .sl-page-header');
    expect(header).not.toMatch(/min-height/);
    expect(header).not.toMatch(/padding/);
    expect(header).toMatch(/justify-content:\s*flex-start/);
  });

  /**
   * The old `.sl-publish-section` had a top border and margin because it was
   * appended after the Library's row list and needed separating from it. As a
   * screen body it is the only thing there, so a rule dividing it from nothing
   * is just a stray line under the page header.
   */
  it('styles a screen body, not a section appended after a list', () => {
    expect(rule('.sl-publish-section')).toBe('');
    const body = rule('.sl-publish-body');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/border-top/);
  });

  /**
   * The copied text wraps rather than scrolling. Scrolling showed the start of
   * the key and hid the half that says what it does, behind a scrollbar that
   * is easy to miss in a 480px panel.
   */
  it('shows the whole copied text instead of scrolling half of it out of view', () => {
    const code = rule('.sl-publish-code > code');
    expect(code).toMatch(/white-space:\s*pre-wrap/);
    expect(code).toMatch(/overflow-wrap:\s*anywhere/);
    expect(code).not.toMatch(/overflow-x/);
  });

  /**
   * Defensive. SF Mono (macOS's `ui-monospace`) does not ligate `--`, but
   * `ui-monospace` is whatever the user's OS provides, and Fira Code,
   * JetBrains Mono and Iosevka all fuse `--` into one long dash. The command
   * carries a `--id` flag, so on one of those a developer would read an em
   * dash where two hyphens belong and typing back what they read would fail.
   */
  it('turns off ligatures so the command\'s -- flag cannot render as a dash', () => {
    expect(setupCommand(LIBRARY_ID, PULL_KEY)).toContain('--id');
    expect(rule('.sl-publish-code > code'))
      .toMatch(/font-variant-ligatures:\s*none/);
  });

  /** Rules for markup the screen no longer renders leave with it. */
  it('carries no rules for the retired groups, hint, facts and body link', () => {
    for (const gone of [
      '.sl-publish-group + .sl-publish-group',
      '.sl-publish-command',
      '.sl-publish-command-actions',
      '.sl-publish-hint',
      '.sl-publish-definition',
      '.sl-publish-allowance',
      '.sl-publish-facts',
    ]) {
      expect(css).not.toContain(`\n${gone} {`);
      expect(css).not.toContain(`\n${gone},`);
    }
    expect(rule('.sl-publish-rotate')).toMatch(/margin-top/);
    expect(rule('.sl-publish-title')).toMatch(/align-items:\s*center/);
  });

  /**
   * The header is `align-items: flex-start`, which keeps every screen's h1 at
   * the same y, so a taller control placed beside it centres below the title.
   * The lift has to be derived from the type and control tokens, not typed as a
   * px: a hard number silently stops aligning the moment either one changes.
   */
  it('centres the back control on the title line using tokens, not a magic px', () => {
    const back = rule('.sl-publish-back');
    expect(back).toMatch(/height:\s*var\(--sl-control-sm\)/);
    const margin = /margin-top:\s*calc\(([^;]*)\)/.exec(back)?.[1] ?? '';
    expect(margin).toContain('--sl-font-size-display');
    expect(margin).toContain('--sl-line-height-tight');
    expect(margin).toContain('--sl-control-sm');
    expect(margin).not.toMatch(/\d+px/);
  });
});

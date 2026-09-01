import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setupCommand, type PublishState } from '../src/ui/publish';
import { ICON_PATHS } from '../src/ui/shell/icons';
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
  message: 'Published. Developers get this version on their next pull.',
  libraryId: LIBRARY_ID,
  pullKey: PULL_KEY,
  lastPublishedAt: '2026-09-01T00:00:00.000Z',
});

const ALL_STATES: PublishState['status'][] = [
  'idle',
  'collecting',
  'uploading',
  'done',
  'error',
];

describe('publish screen header', () => {
  it('titles the screen and offers a labelled way back to the Library', () => {
    const markup = publishHeaderMarkup();
    expect(markup).toContain('<h1>Publish for developers</h1>');
    expect(markup).toContain('data-publish-back');
    // Icon-only, so the accessible name is the only name it has.
    expect(markup).toContain('aria-label="Back to Library"');
    expect(markup).toContain(ICON_PATHS.chevronLeft);
  });

  /**
   * The `<small>` eyebrow means "what kind of thing the h1 names" ("Selected
   * component" above a component's name). Reusing it as a "Library" breadcrumb
   * would put navigation in a slot that already means something else, which is
   * the one-slot-two-categories mistake the button-icon contract exists to
   * prevent. The back control carries the navigation instead.
   */
  it('does not overload the header eyebrow with navigation', () => {
    expect(publishHeaderMarkup()).not.toContain('<small>');
  });
});

describe('publish screen body', () => {
  it('names what publishing sends, before anything is published', () => {
    const markup = publishScrollMarkup(state());
    expect(markup).toContain('<h2>What gets published</h2>');
    expect(markup).toContain(
      "This library's AI context: the foundation document and every connected "
      + 'component document.',
    );
    expect(markup).toContain('Publishing replaces the version published before it.');
    // No key yet, so the whole Developer setup group is absent - and the
    // screen says where the key will come from rather than leaving a void.
    expect(markup).not.toContain('Developer setup');
    expect(markup).toContain(
      'Publishing creates the key and setup command developers need.',
    );
    expect(markup).not.toContain('data-publish-copy-command');
    expect(markup).not.toContain('data-publish-rotate');
  });

  it('drops the where-the-key-comes-from line once there is a key', () => {
    expect(publishScrollMarkup(PUBLISHED))
      .not.toContain('They appear here once it has run.');
  });

  it('shows the setup command, copy, and rotate once a key exists', () => {
    const markup = publishScrollMarkup(PUBLISHED);
    expect(markup).toContain('<h2>Developer setup</h2>');
    expect(markup).toContain('data-publish-copy-command');
    expect(markup).toContain('Copy setup command');
    expect(markup).toContain('data-publish-rotate');
    expect(markup).toContain('Rotate key');
    expect(markup).toContain(
      `SPEC_LAYER_KEY=${PULL_KEY} npx spec-layer pull --id ${LIBRARY_ID}`,
    );
  });

  /**
   * "Anyone with the key can pull it" is the sentence on this screen with a
   * consequence attached. It used to be the third sentence of the opening
   * paragraph, well above the key. It belongs with the key.
   */
  it('keeps the key warning in the group that shows the key', () => {
    const markup = publishScrollMarkup(PUBLISHED);
    const setupAt = markup.indexOf('Developer setup');
    const warningAt = markup.indexOf('Anyone with the key can pull it.');
    expect(warningAt).toBeGreaterThan(setupAt);
    expect(publishScrollMarkup(state())).not.toContain('Anyone with the key can pull it.');
  });

  /**
   * Rotating sits beside copying as a real button, flagged by colour rather
   * than by placement. `is-danger` sets only the label colour, so it composes
   * with the secondary tone's surface and border; `data-tone="danger"` would
   * replace them with a filled red block and out-shout the footer's primary.
   */
  it('puts rotate beside copy as a secondary button in danger colour', () => {
    const markup = publishScrollMarkup(PUBLISHED);
    const copy = /<button[^>]*data-publish-copy-command[^>]*>/.exec(markup)?.[0] ?? '';
    const rotate = /<button[^>]*data-publish-rotate[^>]*>/.exec(markup)?.[0] ?? '';
    expect(copy).toContain('data-tone="secondary"');
    expect(rotate).toContain('data-tone="secondary"');
    expect(rotate).toContain('is-danger');
    expect(rotate).not.toContain('data-tone="danger"');
    // Both live in the one actions row, copy first.
    const row = /<div class="sl-publish-command-actions">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
    expect(row).toContain('data-publish-copy-command');
    expect(row).toContain('data-publish-rotate');
    expect(row.indexOf('data-publish-copy-command'))
      .toBeLessThan(row.indexOf('data-publish-rotate'));
  });

  /**
   * The hint sits under a row of two buttons, so it has to name the action it
   * belongs to. Unnamed it reads as a consequence of the pair, and copying a
   * command invalidates nothing.
   */
  it('names rotating in the consequence under the two-button row', () => {
    const markup = publishScrollMarkup(PUBLISHED);
    expect(markup).toContain(
      'Rotating invalidates the current key for everyone using it.',
    );
    expect(markup.indexOf('sl-publish-hint'))
      .toBeGreaterThan(markup.indexOf('data-publish-rotate'));
  });

  /**
   * The screen holds two concerns, and the rule between them is only earned
   * when both are on screen.
   */
  it('groups the two concerns, and draws no divider when there is only one', () => {
    expect(publishScrollMarkup(PUBLISHED).split('sl-publish-group').length - 1).toBe(2);
    expect(publishScrollMarkup(state()).split('sl-publish-group').length - 1).toBe(1);
  });

  /**
   * Both halves are needed to build a runnable command. Rendering a box with
   * half of it filled in would print a command that cannot work, which is the
   * fabrication the extraction invariants forbid everywhere else.
   */
  it('withholds the command box when either half of it is unknown', () => {
    expect(publishScrollMarkup(state({ libraryId: LIBRARY_ID })))
      .not.toContain('sl-publish-command');
    expect(publishScrollMarkup(state({ pullKey: PULL_KEY })))
      .not.toContain('sl-publish-command');
    expect(publishScrollMarkup(PUBLISHED)).toContain('sl-publish-command');
  });

  /**
   * The message reports whichever action ran last, and both the footer's
   * Publish and this screen's Rotate key can set it, so it belongs after both
   * groups rather than inside either one.
   */
  it('puts the status line after both groups', () => {
    const markup = publishScrollMarkup(PUBLISHED);
    expect(markup.indexOf('sl-publish-status'))
      .toBeGreaterThan(markup.lastIndexOf('sl-publish-group'));
  });

  it('tones the status line by status and leaves the body without one when silent', () => {
    const failed = publishScrollMarkup(
      state({ status: 'error', message: 'Publishing needs an active Pro license.' }),
    );
    expect(failed).toContain('sl-publish-status is-error');
    expect(failed).toContain('Publishing needs an active Pro license.');

    expect(publishScrollMarkup(PUBLISHED)).not.toContain('is-error');
    expect(publishScrollMarkup(PUBLISHED))
      .toContain('Published. Developers get this version on their next pull.');

    expect(publishScrollMarkup(state())).not.toContain('sl-publish-status');
  });

  it('escapes a message and a key rather than trusting them as markup', () => {
    const markup = publishScrollMarkup(
      state({ status: 'error', message: 'Failed <b>badly</b> & loudly' }),
    );
    expect(markup).toContain('Failed &lt;b&gt;badly&lt;/b&gt; &amp; loudly');
    expect(markup).not.toContain('<b>badly</b>');
  });

  /** The publish action itself is the footer's, not the body's. */
  it('leaves the publish action to the footer', () => {
    for (const status of ALL_STATES) {
      expect(publishScrollMarkup(state({ status }))).not.toContain('data-publish>');
      expect(publishScrollMarkup(state({ status }))).not.toContain('data-publish ');
    }
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
   * One button, one glyph, naming the act, never changing with state. See the
   * button-icon contract in design-system/components.css: the Library primary
   * used to swap an action glyph for a warning and then a status as its state
   * changed, and a footer button that drops its glyph while busy leaves the row
   * half-drawn.
   */
  it('keeps one glyph in every state', () => {
    for (const status of ALL_STATES) {
      const markup = publishFooterMarkup(state({ status }));
      expect(markup).toContain(ICON_PATHS.upload);
      expect(markup.split('<svg').length - 1).toBe(1);
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

  it('keeps the plugin voice: no em dashes anywhere on the screen', () => {
    const all = [
      publishHeaderMarkup(),
      ...ALL_STATES.map((status) => publishScrollMarkup(state({ status }))),
      publishScrollMarkup(PUBLISHED),
      ...ALL_STATES.map((status) => publishFooterMarkup(state({ status }))),
    ].join('');
    expect(all).not.toContain('—');
  });
});

describe('publish screen styling', () => {
  const css = readFileSync(
    new URL('../src/ui/design-system/patterns.css', import.meta.url),
    'utf-8',
  );
  const rule = (selector: string) =>
    new RegExp(`\\n\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

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
   * The divider is between groups, so one group cannot draw half of one.
   *
   * `rule` escapes only the leading dot, so a selector with a combinator needs
   * its own escaped lookup rather than being passed through it.
   */
  it('hangs the group divider on the adjacency, not on the group', () => {
    const escaped = (selector: string) => new RegExp(
      `\\n${selector.replace(/[.+*?^$(){}|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    ).exec(css)?.[1] ?? '';
    expect(rule('.sl-publish-group')).toBe('');
    expect(escaped('.sl-publish-group + .sl-publish-group')).toMatch(/border-top/);
  });

  /**
   * The command wraps rather than scrolling. Scrolling showed the start of the
   * key and hid the `npx spec-layer pull` half that says what it does, behind
   * a scrollbar that is easy to miss in a 480px panel.
   */
  it('shows the whole command instead of scrolling half of it out of view', () => {
    const code = rule('.sl-publish-command > code');
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
    expect(rule('.sl-publish-command > code'))
      .toMatch(/font-variant-ligatures:\s*none/);
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

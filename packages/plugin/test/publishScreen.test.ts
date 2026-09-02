import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setupCommand, type PublishState } from '../src/ui/publish';
import { ICON_PATHS } from '../src/ui/shell/icons';
import { publishLocked } from '../src/ui/viewModel/allowance';
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

/**
 * Every case below this line renders the screen a Pro plan sees. The paywalled
 * screen has its own block at the end of the file, since almost nothing on it
 * is shared: no publish action, no rotate, and a different second group.
 */
const proScroll = (s: PublishState) => publishScrollMarkup(s, false);
const proFooter = (s: PublishState) => publishFooterMarkup(s, false);

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
    const markup = proScroll(state());
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
    expect(proScroll(PUBLISHED))
      .not.toContain('They appear here once it has run.');
  });

  it('shows the setup command, copy, and rotate once a key exists', () => {
    const markup = proScroll(PUBLISHED);
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
    const markup = proScroll(PUBLISHED);
    const setupAt = markup.indexOf('Developer setup');
    const warningAt = markup.indexOf('Anyone with the key can pull it.');
    expect(warningAt).toBeGreaterThan(setupAt);
    expect(proScroll(state())).not.toContain('Anyone with the key can pull it.');
  });

  /**
   * Rotating sits beside copying as a real button, flagged by colour rather
   * than by placement. `is-danger` sets only the label colour, so it composes
   * with the secondary tone's surface and border; `data-tone="danger"` would
   * replace them with a filled red block and out-shout the footer's primary.
   */
  it('puts rotate beside copy as a secondary button in danger colour', () => {
    const markup = proScroll(PUBLISHED);
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
    const markup = proScroll(PUBLISHED);
    expect(markup).toContain(
      'Rotating cuts off everyone using the current key within about a minute.',
    );
    expect(markup.indexOf('sl-publish-hint'))
      .toBeGreaterThan(markup.indexOf('data-publish-rotate'));
  });

  /**
   * The screen holds two concerns, and the rule between them is only earned
   * when both are on screen.
   */
  it('groups the two concerns, and draws no divider when there is only one', () => {
    expect(proScroll(PUBLISHED).split('sl-publish-group').length - 1).toBe(2);
    expect(proScroll(state()).split('sl-publish-group').length - 1).toBe(1);
  });

  /**
   * Both halves are needed to build a runnable command. Rendering a box with
   * half of it filled in would print a command that cannot work, which is the
   * fabrication the extraction invariants forbid everywhere else.
   */
  it('withholds the command box when either half of it is unknown', () => {
    // Half a command is a command that fails: no <code> box and no copy button
    // unless both the id and the key are known. The id-only case still gets
    // the Rotate action, since that is how a device without the key gets one.
    expect(proScroll(state({ libraryId: LIBRARY_ID })))
      .not.toContain('sl-publish-command"');
    expect(proScroll(state({ libraryId: LIBRARY_ID })))
      .not.toContain('data-publish-copy-command');
    expect(proScroll(state({ pullKey: PULL_KEY })))
      .not.toContain('sl-publish-command');
    expect(proScroll(state({ pullKey: PULL_KEY })))
      .not.toContain('data-publish-rotate');
    expect(proScroll(PUBLISHED)).toContain('sl-publish-command"');
  });

  /**
   * The message reports whichever action ran last, and both the footer's
   * Publish and this screen's Rotate key can set it, so it belongs after both
   * groups rather than inside either one.
   */
  it('puts the status line after both groups', () => {
    const markup = proScroll(PUBLISHED);
    expect(markup.indexOf('sl-publish-status'))
      .toBeGreaterThan(markup.lastIndexOf('sl-publish-group'));
  });

  it('tones the status line by status and leaves the body without one when silent', () => {
    const failed = proScroll(
      state({ status: 'error', message: 'Publishing needs an active Pro license.' }),
    );
    expect(failed).toContain('sl-publish-status is-error');
    expect(failed).toContain('Publishing needs an active Pro license.');

    expect(proScroll(PUBLISHED)).not.toContain('is-error');
    expect(proScroll(PUBLISHED))
      .toContain('Published. Developers get this version on their next pull.');

    expect(proScroll(state())).not.toContain('sl-publish-status');
  });

  it('escapes a message and a key rather than trusting them as markup', () => {
    const markup = proScroll(
      state({ status: 'error', message: 'Failed <b>badly</b> & loudly' }),
    );
    expect(markup).toContain('Failed &lt;b&gt;badly&lt;/b&gt; &amp; loudly');
    expect(markup).not.toContain('<b>badly</b>');
  });

  /** The publish action itself is the footer's, not the body's. */
  it('leaves the publish action to the footer', () => {
    for (const status of ALL_STATES) {
      expect(proScroll(state({ status }))).not.toContain('data-publish>');
      expect(proScroll(state({ status }))).not.toContain('data-publish ');
    }
  });
});

describe('publish screen footer', () => {
  it('names the act and the object it acts on', () => {
    const markup = proFooter(state());
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
      const markup = proFooter(state({ status }));
      expect(markup).toContain('data-publish disabled');
      expect(markup).toContain('Publishing…');
      expect(markup).not.toContain('Publish library');
    }
    for (const status of ['idle', 'done', 'error'] as const) {
      const markup = proFooter(state({ status }));
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
      const markup = proFooter(state({ status }));
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
    expect(proFooter(state({ status: 'collecting' })))
      .toContain('<strong>Collecting sources</strong>');
    expect(proFooter(state({ status: 'uploading' })))
      .toContain('<strong>Uploading library</strong>');
    for (const status of ['idle', 'done', 'error'] as const) {
      expect(proFooter(state({ status })))
        .not.toContain('sl-footer-progress');
    }
  });

  it('keeps the plugin voice: no em dashes anywhere on the screen', () => {
    const all = [
      publishHeaderMarkup(),
      ...ALL_STATES.map((status) => proScroll(state({ status }))),
      proScroll(PUBLISHED),
      ...ALL_STATES.map((status) => proFooter(state({ status }))),
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

describe('publish screen: rotate safety and missing key', () => {
  it('disables rotate while a publish is collecting or uploading', () => {
    for (const status of ['collecting', 'uploading'] as const) {
      const rotate = /<button[^>]*data-publish-rotate[^>]*>/.exec(proScroll(state({ ...PUBLISHED, status })))?.[0] ?? '';
      expect(rotate).toContain('disabled');
    }
    const idle = /<button[^>]*data-publish-rotate[^>]*>/.exec(proScroll(PUBLISHED))?.[0] ?? '';
    expect(idle).not.toContain('disabled');
  });

  it('is honest that rotation takes up to a minute to reach every developer', () => {
    expect(proScroll(PUBLISHED)).toContain('within about a minute');
    expect(proScroll(PUBLISHED)).not.toContain('invalidates');
  });

  it('shows the library id and rotate, but no command, when the key is not on this device', () => {
    const markup = proScroll(state({ libraryId: LIBRARY_ID, pullKey: null }));
    expect(markup).toContain(LIBRARY_ID);
    expect(markup).toContain('data-publish-rotate');
    expect(markup).not.toContain('data-publish-copy-command');
    expect(markup).not.toContain('SPEC_LAYER_KEY=');
    expect(markup).toContain('not on this device');
  });
});

/**
 * The paywall. Publishing is Pro-only on the server (`proCaller` in
 * packages/proxy/src/libraries.ts answers 401 to every other tier), so a free
 * plan seeing a working Publish button was an offer the product does not make:
 * it collected every component in the file, uploaded nothing, and reported the
 * refusal as an error line under the button it had just enabled.
 */
describe('publish screen on a free plan', () => {
  const lockedScroll = (s: PublishState) => publishScrollMarkup(s, true);
  const lockedFooter = (s: PublishState) => publishFooterMarkup(s, true);

  it('states the plan instead of promising a first publish', () => {
    const markup = lockedScroll(state());
    expect(markup).toContain('<h2>Pro plan required</h2>');
    expect(markup).toContain('Publishing is part of Pro.');
    // The unlocked screen's "the key appears here once it has run" is a promise
    // about a run that cannot happen on this plan.
    expect(markup).not.toContain('They appear here once it has run.');
    // What publishing sends is still worth reading before upgrading.
    expect(markup).toContain('<h2>What gets published</h2>');
  });

  it('offers no publish action anywhere on the screen', () => {
    for (const status of ALL_STATES) {
      const markup = lockedScroll(state({ status })) + lockedFooter(state({ status }));
      expect(markup).not.toContain('data-publish>');
      expect(markup).not.toContain('data-publish ');
      expect(markup).not.toContain('Publish library');
      expect(markup).not.toContain('Publishing…');
    }
  });

  /**
   * Two real actions, not one disabled Publish. A disabled primary says "not
   * right now" about work this plan will never do, and names nothing to wait
   * for. Order follows the Library footer: secondary first, primary last.
   */
  it('routes to the two ways out: a key you own, or the plan you do not', () => {
    const markup = lockedFooter(state());
    expect(markup).toContain('data-view="license"');
    expect(markup).toContain('Enter a license key');
    expect(markup).toContain('data-license-open="upgrade"');
    expect(markup).toContain('Upgrade to Pro');
    expect(markup).toContain('data-tone="primary"');
    expect(markup.indexOf('data-view="license"'))
      .toBeLessThan(markup.indexOf('data-license-open="upgrade"'));
    expect(markup).not.toContain('disabled');
    // One glyph each, and the external-link glyph is the License screen's own
    // signal that Upgrade leaves the panel.
    expect(markup).toContain(ICON_PATHS.key);
    expect(markup).toContain(ICON_PATHS.externalLink);
    expect(markup.split('<svg').length - 1).toBe(2);
  });

  /**
   * A lapsed Pro license still owns what it published, and pulling never
   * checked the license. Withholding the command would stop developers who are
   * already set up, so the key stays readable and only the Pro calls go.
   */
  it('keeps a key it already has readable, without the Pro-only rotate', () => {
    const markup = lockedScroll(PUBLISHED);
    expect(markup).toContain('<h2>Developer setup</h2>');
    expect(markup).toContain('data-publish-copy-command');
    expect(markup).toContain(
      `SPEC_LAYER_KEY=${PULL_KEY} npx spec-layer pull --id ${LIBRARY_ID}`,
    );
    expect(markup).not.toContain('data-publish-rotate');
    expect(markup).not.toContain('Rotate key');
    // The consequence line belongs to a control that is no longer there.
    expect(markup).not.toContain('Rotating cuts off everyone');
  });

  it('does not tell a locked device to rotate a key it cannot rotate', () => {
    const markup = lockedScroll(state({ libraryId: LIBRARY_ID, pullKey: null }));
    expect(markup).toContain(LIBRARY_ID);
    expect(markup).toContain('not on this device');
    expect(markup).toContain('Issuing a new key needs Pro.');
    expect(markup).not.toContain('Rotate the key to issue a new one.');
    expect(markup).not.toContain('data-publish-rotate');
    // No actions row left to draw around nothing.
    expect(markup).not.toContain('sl-publish-command-actions');
  });

  it('keeps the plugin voice: no em dashes anywhere on the locked screen', () => {
    const all = [
      ...ALL_STATES.map((status) => lockedScroll(state({ status }))),
      lockedScroll(PUBLISHED),
      ...ALL_STATES.map((status) => lockedFooter(state({ status }))),
    ].join('');
    expect(all).not.toContain('—');
  });
});

/**
 * Which plans see the paywall. 'loading' and 'unknown' are "the server has not
 * told us", and locking on those would demote a Pro user who is briefly
 * offline, which is the same call allowanceCopy makes for the header.
 */
describe('publishLocked', () => {
  it('locks a known free plan and nothing else', () => {
    expect(publishLocked({ kind: 'free', remaining: 8, limit: 10, resetsAt: '' })).toBe(true);
    expect(publishLocked({ kind: 'free', remaining: 0, limit: 10, resetsAt: '' })).toBe(true);
    expect(publishLocked({ kind: 'pro' })).toBe(false);
    expect(publishLocked({ kind: 'loading' })).toBe(false);
    expect(publishLocked({ kind: 'unknown', message: 'Plan status unavailable' })).toBe(false);
  });
});

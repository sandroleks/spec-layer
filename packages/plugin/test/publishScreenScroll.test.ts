// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { renderPublishScreen } from '../src/ui/screens/publish';
import { createPublishState } from '../src/ui/publish';
import type { ShellRefs } from '../src/ui/shell/shell';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Only the four refs the publish screen writes to. */
function refs(): ShellRefs {
  const screen = document.createElement('div');
  const pageHeader = document.createElement('div');
  const scroll = document.createElement('div');
  const footer = document.createElement('div');
  scroll.style.height = '100px';
  scroll.style.overflow = 'auto';
  document.body.append(screen, pageHeader, scroll, footer);
  return { screen, pageHeader, scroll, footer } as unknown as ShellRefs;
}

describe('renderPublishScreen scroll position', () => {
  it('resets the scroll on arrival and keeps it on a repaint of the same screen', () => {
    const r = refs();
    const state = { ...createPublishState(), libraryId: 'lib_aaaaaaaaaaaaaaaaaaaaaaaa', version: '1.0.0' };
    renderPublishScreen(r, state, { kind: 'hidden' });
    expect(r.scroll.scrollTop).toBe(0);
    r.scroll.scrollTop = 40;
    renderPublishScreen(r, state, { kind: 'hidden' });
    // happy-dom keeps scrollTop as set; a reset to 0 would show here.
    expect(r.scroll.scrollTop).toBe(40);
    r.screen.className = 'sl-screen sl-library-screen';
    r.scroll.scrollTop = 40;
    renderPublishScreen(r, state, { kind: 'hidden' });
    expect(r.scroll.scrollTop).toBe(0);
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { focusSelector, keepFocus } from '../src/ui/focusRestore';

beforeEach(() => { document.body.innerHTML = ''; });

const screen = (html: string): HTMLElement => {
  let root = document.getElementById('screen');
  if (!root) {
    root = document.createElement('div');
    root.id = 'screen';
    document.body.append(root);
  }
  root.innerHTML = html;
  return root;
};

describe('focusSelector', () => {
  it('prefers the id, then the data attributes, then the name', () => {
    screen('<button id="go">Go</button><button data-action="build" data-kind="doc">B</button><input name="version"><button>Bare</button>');
    const [go, build, input, bare] = document.querySelectorAll('#screen > *');
    expect(focusSelector(go)).toBe('#go');
    expect(focusSelector(build)).toBe('button[data-action="build"][data-kind="doc"]');
    expect(focusSelector(input)).toBe('input[name="version"]');
    expect(focusSelector(bare)).toBeNull();
    expect(focusSelector(document.body)).toBeNull();
  });
});

describe('keepFocus', () => {
  it('refocuses the rebuilt element when a repaint replaced the focused one', () => {
    screen('<button data-action="build">Build</button>');
    document.querySelector<HTMLButtonElement>('[data-action="build"]')!.focus();
    keepFocus(document, () => screen('<p>Busy</p><button data-action="build">Build</button>'));
    expect(document.activeElement?.getAttribute('data-action')).toBe('build');
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it('leaves focus that survived the repaint alone', () => {
    const outside = document.createElement('button');
    outside.id = 'header-button';
    document.body.append(outside);
    screen('<button data-action="build">Build</button>');
    outside.focus();
    keepFocus(document, () => screen('<button data-action="build">Build</button>'));
    expect(document.activeElement).toBe(outside);
  });

  it('does not take over focus the repaint itself moved', () => {
    screen('<button data-action="build">Build</button>');
    document.querySelector<HTMLButtonElement>('[data-action="build"]')!.focus();
    keepFocus(document, () => {
      screen('<button data-action="build">Build</button><input id="first-version">');
      document.querySelector<HTMLInputElement>('#first-version')!.focus();
    });
    expect(document.activeElement?.id).toBe('first-version');
  });

  it('does nothing when the element is gone after the repaint', () => {
    screen('<button data-action="build">Build</button>');
    document.querySelector<HTMLButtonElement>('[data-action="build"]')!.focus();
    keepFocus(document, () => screen('<p>Done</p>'));
    expect(document.activeElement).toBe(document.body);
  });
});

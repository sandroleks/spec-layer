/**
 * ui-vnext.ts — entry point for the new shell.
 *
 * The flag selects an entry point rather than branching inside ui.ts, so the
 * legacy UI and the new shell can never both run: the legacy module is not in
 * this bundle at all.
 *
 * Only "Generate component docs" is built. The other four rail destinations say
 * so rather than pretending to be empty screens.
 */

import type { MainToUi } from '../messages';
import type { GroupId, SectionId } from './docModel';
import type { ComponentScreenState, PluginView } from './viewModel/contracts';
import { allowanceState } from './viewModel/allowance';
import { mountShell, setActiveView, wireShellTheme, type ShellRefs } from './shell/shell';
import { renderAllowance } from './shell/header';
import {
  createComponentSelection,
  renderComponentScreen,
  type ComponentSelection,
} from './screens/component';
import {
  autoExtract,
  createDocFrame,
  createState,
  send,
  setAiEnabled,
  type BuildPresenter,
} from './actions';
import { effectiveAuth, fetchQuota } from './proxy';

const refs: ShellRefs = mountShell('component');
wireShellTheme(refs);

const state = createState();
const selection: ComponentSelection = createComponentSelection(state.aiEnabled);
let screen: ComponentScreenState = { kind: 'empty' };
let view: PluginView = 'component';

/**
 * Whether the first quota request has settled. `state.quota` is null both
 * before we ask and when the answer never arrived, and the header has to tell
 * those apart: one is a spinner, the other is "plan status unavailable".
 */
let quotaFetched = false;

/** The component name to keep on screen when a state change does not carry one. */
function currentName(): string {
  return 'componentName' in screen ? screen.componentName : '';
}

function paintAllowance(): void {
  renderAllowance(refs.header, allowanceState(state.quota, quotaFetched));
}

function paint(): void {
  if (view !== 'component') {
    refs.pageHeader.hidden = true;
    refs.footer.hidden = true;
    refs.scroll.innerHTML =
      '<div class="sl-empty-state"><strong>Not built yet</strong>' +
      '<p>This workflow still lives in the current plugin UI. It moves here next.</p></div>';
    return;
  }
  renderComponentScreen(refs, screen, selection);
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

let quotaSeq = 0;

async function refreshQuota(): Promise<void> {
  const seq = ++quotaSeq;
  const quota = await fetchQuota(
    effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
  );
  // A slower earlier request must not clobber a newer answer.
  if (seq !== quotaSeq) return;
  state.quota = quota;
  quotaFetched = true;
  paintAllowance();
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Reports a build through the screen's own status row and footer button. */
function presenter(): BuildPresenter {
  return {
    clear: () => {
      if (screen.kind === 'error' || screen.kind === 'success') {
        screen = { kind: 'ready', componentName: screen.componentName };
        paint();
      }
    },
    error: (message) => {
      screen = { kind: 'error', componentName: currentName(), message };
      paint();
    },
    info: () => {
      // The component screen learns about success from docFrameDone, which
      // carries whether the frame was replaced. An info line here would be a
      // second, less informed source for the same fact.
    },
    setBusy: (busy) => {
      if (!busy && screen.kind === 'building') {
        screen = { kind: 'ready', componentName: screen.componentName };
        paint();
      }
    },
    startProgress: () => {
      screen = { kind: 'building', componentName: currentName() };
      paint();
    },
    stopProgress: () => {
      /* The screen leaves 'building' via success, error, or setBusy(false). */
    },
  };
}

function build(): void {
  void createDocFrame(
    state,
    // Variant token picking has not moved to this screen yet, so no variant is
    // requested. The model treats an empty set as "none", not "all".
    { sections: new Set(selection.sections), variantIds: new Set<string>() },
    presenter(),
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function toggle<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const rail = target.closest<HTMLButtonElement>('[data-view]');
  if (rail?.dataset.view) {
    view = rail.dataset.view as PluginView;
    setActiveView(refs, view);
    paint();
    return;
  }

  const group = target.closest<HTMLButtonElement>('[data-group]');
  if (group?.dataset.group) {
    toggle(selection.expanded, group.dataset.group as GroupId);
    paint();
    return;
  }

  const anatomy = target.closest<HTMLButtonElement>('[data-anatomy]');
  if (anatomy?.dataset.anatomy) {
    selection.anatomyView = anatomy.dataset.anatomy as ComponentSelection['anatomyView'];
    state.anatomyView = selection.anatomyView;
    paint();
    return;
  }

  const measure = target.closest<HTMLButtonElement>('[data-measure]');
  if (measure?.dataset.measure) {
    const id = measure.dataset.measure as 'size' | 'padding' | 'spacing';
    // Never let the last chip off: an empty set falls back to all three in the
    // model, which would contradict what the UI is showing.
    if (!(selection.measureViews.size === 1 && selection.measureViews.has(id))) {
      toggle(selection.measureViews, id);
      state.measureViews = [...selection.measureViews];
    }
    paint();
    return;
  }

  if (target.closest('#sl-create')) build();
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  if (input.id === 'sl-ai-toggle') {
    selection.aiEnabled = input.checked;
    setAiEnabled(state, input.checked);
    paint();
    return;
  }

  const sectionId = input.dataset.section as SectionId | undefined;
  if (sectionId) {
    if (input.checked) selection.sections.add(sectionId);
    else selection.sections.delete(sectionId);
    paint();
  }
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

window.onmessage = (event: MessageEvent): void => {
  const msg = (event.data?.pluginMessage ?? null) as MainToUi | null;
  if (!msg) return;

  switch (msg.type) {
    case 'selection': {
      const node = msg.node;
      state.currentNode = node;
      state.currentFileKey = msg.fileKey;
      state.currentSpec = null;
      if (!node) {
        screen = { kind: 'empty' };
        paint();
        return;
      }
      screen = { kind: 'reading', componentName: node.name };
      paint();
      autoExtract(
        state,
        () => { /* the reading state is already painted */ },
        () => {
          screen = { kind: 'ready', componentName: node.name };
          paint();
        },
      );
      return;
    }

    case 'docFrameDone':
      screen = { kind: 'success', componentName: currentName(), replaced: msg.replaced };
      paint();
      // A build may have spent an AI use, so the header should stop showing a
      // stale count.
      void refreshQuota();
      return;

    case 'docFrameError':
      screen = { kind: 'error', componentName: currentName(), message: msg.message };
      paint();
      return;

    case 'licenseKey':
      state.licenseKey = msg.value;
      state.licenseInstanceId = msg.instanceId;
      // Re-probe rather than trusting a persisted verdict: a key may have been
      // renewed or lapsed since the last session.
      state.licenseActive = null;
      void refreshQuota();
      return;

    case 'userInfo':
      state.figmaUserId = msg.userId;
      void refreshQuota();
      return;

    case 'aiEnabled':
      state.aiEnabled = msg.value;
      selection.aiEnabled = msg.value;
      paint();
      return;

    default:
      // Every other message belongs to a workflow that has not moved here yet.
      return;
  }
};

paintAllowance();
paint();
send({ type: 'requestSelection' });

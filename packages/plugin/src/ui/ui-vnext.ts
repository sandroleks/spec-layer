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
  applyGroupBulk,
  componentDocSelection,
  unavailableSections,
} from './viewModel/componentScreen';
import {
  componentFacts,
  NO_FACTS,
  type ComponentFacts,
} from './viewModel/componentFacts';
import {
  beginOperation,
  createOperationGate,
  deferSelection,
  finishOperation,
} from './viewModel/operationGate';
import {
  autoExtract,
  createDocFrame,
  createState,
  downloadDoc,
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
let facts: ComponentFacts = NO_FACTS;
let selectionSeq = 0;
const operation = createOperationGate();
type SelectionMessage = Extract<MainToUi, { type: 'selection' }>;
let deferredSelection: SelectionMessage | null = null;

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
  renderComponentScreen(refs, screen, selection, facts);
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
function presenter(action: 'create' | 'download'): BuildPresenter {
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
    info: (message) => {
      // A download has no main-thread completion message, so this presenter is
      // the only place it can report success.
      screen = {
        kind: 'success',
        componentName: currentName(),
        replaced: false,
        message,
      };
      paint();
    },
    setBusy: (busy) => {
      if (!busy && screen.kind === 'building') {
        screen = { kind: 'ready', componentName: screen.componentName };
        paint();
      }
    },
    startProgress: () => {
      screen = { kind: 'building', componentName: currentName(), action };
      paint();
    },
    stopProgress: () => {
      /* The screen leaves 'building' via success, error, or setBusy(false). */
    },
  };
}

/** What a build or download documents, filtered to what this component can fill. */
function docSelection() {
  return componentDocSelection(
    selection.sections,
    selection.variantIds,
    facts,
  );
}

function build(): void {
  if (screen.kind === 'empty' || screen.kind === 'reading' || screen.kind === 'building') return;
  if (!beginOperation(operation)) return;
  void createDocFrame(state, docSelection(), presenter('create')).finally(() => {
    // Success remains busy until the main thread confirms the canvas work.
    if (screen.kind !== 'building') completeOperation();
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function toggle<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function paintAndFocus(selector: string): void {
  paint();
  document.querySelector<HTMLElement>(selector)?.focus();
}

function completeOperation(): void {
  const applyDeferred = finishOperation(operation);
  if (applyDeferred && deferredSelection) {
    const message = deferredSelection;
    deferredSelection = null;
    applySelection(message);
  }
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

  // Component controls are inert while an async build/download owns UiState.
  if (operation.active) return;

  const bulk = target.closest<HTMLButtonElement>('[data-group-bulk]');
  if (bulk?.dataset.groupBulk) {
    const groupId = bulk.dataset.groupBulk as GroupId;
    applyGroupBulk(
      selection.sections,
      groupId,
      bulk.dataset.on === 'true',
      unavailableSections(facts),
    );
    paintAndFocus(`[data-group-bulk="${groupId}"]`);
    return;
  }

  const group = target.closest<HTMLButtonElement>('[data-group]');
  if (group?.dataset.group) {
    const groupId = group.dataset.group as GroupId;
    toggle(selection.expanded, groupId);
    paintAndFocus(`[data-group="${groupId}"]`);
    return;
  }

  if (target.closest('[data-variants]')) {
    selection.variantsExpanded = !selection.variantsExpanded;
    paintAndFocus('[data-variants]');
    return;
  }

  const anatomy = target.closest<HTMLButtonElement>('[data-anatomy]');
  if (anatomy?.dataset.anatomy) {
    selection.anatomyView = anatomy.dataset.anatomy as ComponentSelection['anatomyView'];
    state.anatomyView = selection.anatomyView;
    paintAndFocus(`[data-anatomy="${selection.anatomyView}"]`);
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
    paintAndFocus(`[data-measure="${id}"]`);
    return;
  }

  if (target.closest('#sl-download')) {
    if (!beginOperation(operation)) return;
    void downloadDoc(state, docSelection(), presenter('download')).finally(completeOperation);
    return;
  }
  if (target.closest('#sl-create')) build();
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input || operation.active) return;

  if (input.id === 'sl-ai-toggle') {
    selection.aiEnabled = input.checked;
    setAiEnabled(state, input.checked);
    paintAndFocus('#sl-ai-toggle');
    return;
  }

  const variantId = input.dataset.variant;
  if (variantId) {
    if (input.checked) selection.variantIds.add(variantId);
    else selection.variantIds.delete(variantId);
    paintAndFocus(`[data-variant="${variantId}"]`);
    return;
  }

  const sectionId = input.dataset.section as SectionId | undefined;
  if (sectionId) {
    if (input.checked) selection.sections.add(sectionId);
    else selection.sections.delete(sectionId);
    paintAndFocus(`[data-section="${sectionId}"]`);
  }
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function applySelection(msg: SelectionMessage): void {
  const seq = ++selectionSeq;
  const node = msg.node;
  state.currentNode = node;
  state.currentFileKey = msg.fileKey;
  state.currentSpec = null;
  state.currentExtractedAt = '';
  state.renderedMd = '';
  state.generatedProse = null;
  state.generatedProseKeys = null;
  state.pendingAiNote = '';
  facts = node ? componentFacts(null, node.name) : NO_FACTS;
  selection.variantIds.clear();
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
      if (seq !== selectionSeq || state.currentNode?.id !== node.id) return;
      facts = componentFacts(state.currentSpec, node.name);
      selection.variantIds = new Set(facts.defaultVariantIds);
      if (facts.hasStates === true) selection.sections.add('states');
      if (facts.hasStates === false) selection.sections.delete('states');
      screen = { kind: 'ready', componentName: node.name };
      paint();
    },
  );
}

window.onmessage = (event: MessageEvent): void => {
  const msg = (event.data?.pluginMessage ?? null) as MainToUi | null;
  if (!msg) return;

  switch (msg.type) {
    case 'selection': {
      // Keep an async build/download on the component it started with. Once it
      // completes, apply the newest real selection message. The main thread
      // suppresses its own generated-frame selection.
      if (deferSelection(operation)) {
        deferredSelection = msg;
        return;
      }
      applySelection(msg);
      return;
    }

    case 'docFrameDone':
      {
        const note = state.pendingAiNote;
        const outcome = msg.replaced ? 'Docs replaced' : 'Docs created';
        screen = {
          kind: 'success',
          componentName: currentName(),
          replaced: msg.replaced,
          ...(note ? { message: `${outcome}. ${note}`, warning: true } : {}),
        };
        state.pendingAiNote = '';
      }
      paint();
      completeOperation();
      // A build may have spent an AI use, so the header should stop showing a
      // stale count.
      void refreshQuota();
      return;

    case 'docFrameError':
      screen = { kind: 'error', componentName: currentName(), message: msg.message };
      paint();
      completeOperation();
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

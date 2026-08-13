/**
 * ui-vnext.ts — entry point for the new shell.
 *
 * The flag selects an entry point rather than branching inside ui.ts, so the
 * legacy UI and the new shell can never both run: the legacy module is not in
 * this bundle at all.
 *
 * Each migrated screen renders through the shared shell while legacy-only
 * workflows stay explicitly unavailable until their production mapping lands.
 */

import { extract, ProseProxyError, specContentHash } from '@spec-layer/extractor';
import { SPEC_VERSION } from '@spec-layer/format';
import {
  THEME_PRESETS,
  matchPreset,
  parseBrandHex,
  type BrandTheme,
} from '../brandColors';
import type { LibraryEntry, MainToUi } from '../messages';
import type { GroupId, SectionId } from './docModel';
import type {
  ComponentScreenState,
  FoundationScreenState,
  LicenseState,
  PluginView,
} from './viewModel/contracts';
import { allowanceState } from './viewModel/allowance';
import { mountShell, setActiveView, wireShellTheme, type ShellRefs } from './shell/shell';
import { renderAllowance } from './shell/header';
import { setRailBadge } from './shell/sidebar';
import {
  createComponentSelection,
  renderComponentScreen,
  type ComponentSelection,
} from './screens/component';
import { renderFoundationScreen } from './screens/foundations';
import {
  fontMenuMarkup,
  renderSettingsScreen,
  type ColorField,
  type FontField,
} from './screens/settings';
import { computeMenuPlacement } from './fontPicker';
import { filterFamilies } from '../fonts';
import { renderLicenseScreen } from './screens/license';
import { renderLibraryScreen } from './screens/library';
import { globalSearchMarkup } from './screens/search';
import {
  applyGroupBulk,
  applyVariantBulk,
  componentDocSelection,
  sectionGroups,
  unavailableSections,
  variantBulkState,
  variantCountLabel,
} from './viewModel/componentScreen';
import {
  buildLibraryModel,
  libraryBadgeVisible,
  type LibraryDriftState,
  type LibraryFilter,
} from './viewModel/library';
import {
  buildSearchModel,
  nextSearchIndex,
  type SearchModel,
  type SearchResult,
} from './viewModel/search';
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
  currentFoundationSelection,
  currentFoundationSpec,
  currentGroupBriefs,
  downloadFromSource,
  downloadDoc,
  onFoundationChange,
  onFoundationMessage,
  onSelectionFoundation,
  onFoundationToggleAll,
  send,
  setAiEnabled,
  setBrandTheme,
  setLicenseKey,
  setFoundationGenerating,
  setFoundationHost,
  updateFromSource,
  type BuildPresenter,
} from './actions';
import { generateGroupDescriptions, resolveComponentImage } from './ai';
import { hasColorGroups } from './foundationState';
import {
  CHECKOUT_URL,
  MANAGE_SUB_URL,
  SITE_URL,
  STOREFRONT_URL,
  activateLicense as activateLicenseKey,
  deactivateLicense,
  effectiveAuth,
  fetchQuota,
  groupErrorCopy,
  isQuotaExhausted,
} from './proxy';

const refs: ShellRefs = mountShell('component');
wireShellTheme(refs);

const state = createState();
const selection: ComponentSelection = createComponentSelection(state.aiEnabled);
let screen: ComponentScreenState = { kind: 'empty' };
let foundationScreen: FoundationScreenState = { kind: 'loading' };
let view: PluginView = 'component';
let facts: ComponentFacts = NO_FACTS;
let selectionSeq = 0;
const operation = createOperationGate();
type SelectionMessage = Extract<MainToUi, { type: 'selection' }>;
let deferredSelection: SelectionMessage | null = null;
let foundationRequested = false;
let foundationRefreshing = false;
let foundationAiNote = '';
let settingsCustomMode = false;
let settingsColorError = '';
let settingsFontWarning = '';
let settingsLogoError = '';
let settingsFonts: string[] = [];
let settingsFontsRequested = false;
/**
 * The open font list, or null. `query` is what has been typed since it opened,
 * kept separate from the field's committed value so opening the list shows every
 * family rather than pre-filtering down to the one already chosen.
 */
let fontMenu: { field: FontField; query: string; activeIndex: number } | null = null;
let settingsCustomDraft: BrandTheme | null = null;
let licenseScreenState: LicenseState = 'checking';
let licenseInput = '';
let libraryEntries: LibraryEntry[] = [];
const libraryDrift = new Map<string, LibraryDriftState>();
const libraryBaseline = new Map<string, string>();
// docId → the specVersion stamped on its doc link (undefined on pre-0.2
// blobs). Checked before comparing hashes, since a hash comparison against a
// doc built by an older extractor is meaningless.
const librarySpecVersion = new Map<string, string | undefined>();
let libraryFilter: LibraryFilter = 'all';
let libraryExpandedDocId: string | null = null;
let libraryMenuDocId: string | null = null;
let libraryMenuRestore: HTMLElement | null = null;
let libraryRefreshing = false;
let libraryRequested = false;
let componentProgressTimer: ReturnType<typeof setInterval> | null = null;
let foundationProgressTimer: ReturnType<typeof setInterval> | null = null;

type LibraryUpdateOperation = {
  kind: 'update';
  queue: string[];
  currentDocId: string | null;
  completed: number;
  total: number;
  batch: boolean;
  confirmedOverwrite: Set<string>;
};
type LibraryDownloadOperation = {
  kind: 'download';
  currentDocId: string;
};
let libraryOperation: LibraryUpdateOperation | LibraryDownloadOperation | null = null;
let searchOpen = false;
let searchQuery = '';
let searchActiveIndex = 0;
let searchRestoreTarget: HTMLElement | null = null;

setFoundationHost({
  repaint: () => {
    if (view === 'foundations') paint();
  },
  setBusy: (busy) => {
    if (busy) foundationScreen = { kind: 'generating', done: 0, total: 0 };
  },
  startProgress: (messages) => {
    stopFoundationProgress();
    const phases = messages.length ? messages : ['Creating foundation frames'];
    let index = 0;
    const current = foundationScreen.kind === 'generating'
      ? foundationScreen
      : { kind: 'generating' as const, done: 0, total: 0 };
    foundationScreen = { ...current, phase: phases[index] };
    if (view === 'foundations') paint();
    if (phases.length > 1) {
      foundationProgressTimer = setInterval(() => {
        if (foundationScreen.kind !== 'generating') return;
        index = (index + 1) % phases.length;
        foundationScreen = { ...foundationScreen, phase: phases[index] };
        if (view === 'foundations') paint();
      }, 2600);
    }
  },
  stopProgress: stopFoundationProgress,
});

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

function nativeNotify(
  message: string,
  options: { error?: boolean; timeout?: number } = {},
): void {
  send({ type: 'notify', message, ...options });
}

function stopComponentProgress(): void {
  if (!componentProgressTimer) return;
  clearInterval(componentProgressTimer);
  componentProgressTimer = null;
}

function startComponentProgress(
  messages: string[],
  action: 'create' | 'download',
): void {
  stopComponentProgress();
  const phases = messages.length ? messages : ['Working'];
  let index = 0;
  screen = {
    kind: 'building',
    componentName: currentName(),
    action,
    phase: phases[index],
  };
  paint();
  if (phases.length > 1) {
    componentProgressTimer = setInterval(() => {
      if (screen.kind !== 'building') return;
      index = (index + 1) % phases.length;
      screen = { ...screen, phase: phases[index] };
      if (view === 'component') paint();
    }, 2600);
  }
}

function stopFoundationProgress(): void {
  if (!foundationProgressTimer) return;
  clearInterval(foundationProgressTimer);
  foundationProgressTimer = null;
}

function paintAllowance(): void {
  renderAllowance(refs.header, allowanceState(state.quota, quotaFetched));
}

function paint(): void {
  switch (view) {
    case 'component':
      renderComponentScreen(refs, screen, selection, facts);
      return;
    case 'foundations':
      renderFoundationScreen(
        refs,
        foundationScreen,
        currentFoundationSpec(),
        currentFoundationSelection(),
        foundationRefreshing,
      );
      return;
    case 'settings':
      renderSettingsScreen(refs, {
        theme: state.brandTheme,
        customMode: settingsCustomMode,
        logoAttached: Boolean(state.logoBase64),
        ...(settingsColorError ? { colorError: settingsColorError } : {}),
        ...(settingsFontWarning ? { fontWarning: settingsFontWarning } : {}),
        ...(settingsLogoError ? { logoError: settingsLogoError } : {}),
        fontMenuField: fontMenu?.field ?? null,
      });
      renderFontMenu();
      return;
    case 'library':
      {
        const model = currentLibraryModel();
        const update = libraryOperation?.kind === 'update' ? libraryOperation : null;
        const pendingChecks = model.allRows.some((row) => row.status === 'pending');
        const failedChecks = model.allRows.some((row) => row.status === 'unavailable');
        const checkTotal = [...libraryDrift.values()].length;
        const checkDone = [...libraryDrift.values()]
          .filter((status) => status !== 'pending').length;
        const progress = update
          ? {
              label: update.batch
                ? `Updating document ${Math.min(update.completed + 1, update.total)} of ${update.total}`
                : 'Updating documentation',
              current: update.completed,
              total: update.total,
            }
          : libraryOperation?.kind === 'download'
            ? {
                label: 'Preparing documentation',
              }
            : libraryRefreshing || pendingChecks
              ? {
                  label: libraryEntries.length === 0 ? 'Reading Library' : 'Checking source changes',
                  ...(checkTotal > 0 ? { current: checkDone, total: checkTotal } : {}),
                }
              : null;
        renderLibraryScreen(refs, {
          ...model,
          menuDocId: libraryMenuDocId,
          loading: (!libraryRequested || libraryRefreshing) && libraryEntries.length === 0,
          refreshing: libraryRefreshing || pendingChecks,
          checksIncomplete: failedChecks,
          updatingAll: Boolean(update?.batch),
          updatingDocId: update?.currentDocId ?? (
            libraryOperation?.kind === 'download'
              ? libraryOperation.currentDocId
              : null
          ),
          progress,
        });
      }
      return;
    case 'license': {
      const quota = state.quota;
      const limit = quota?.limit ?? 0;
      const remaining = quota?.remaining ?? Math.max(0, limit - (quota?.used ?? 0));
      renderLicenseScreen(refs, {
        state: licenseScreenState,
        licenseKey: state.licenseKey ?? '',
        input: licenseInput,
        remaining,
        limit,
        resetsAt: quota?.resetsAt ?? '',
      });
      return;
    }
  }
}

function navigateToView(
  next: PluginView,
  options: { refreshLibrary?: boolean } = {},
): void {
  view = next;
  closeFontMenu();
  setActiveView(refs, view);
  if (view === 'foundations') requestFoundations();
  if (view === 'library' && options.refreshLibrary !== false) refreshLibrary();
  if (view === 'settings' && !settingsFontsRequested) {
    settingsFontsRequested = true;
    send({ type: 'requestFonts' });
  }
  paint();
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

let quotaSeq = 0;

function resolvedLicenseState(): LicenseState {
  if (!state.licenseKey) return 'free';
  if (!state.quota) return 'unknown';
  if (state.quota.tier === 'pro') return 'pro';
  if (state.quota.licenseReason === 'unreachable') return 'unknown';
  if (state.quota.licenseReason === 'expired') return 'expired';
  return 'inactive';
}

async function refreshQuota(syncLicense = true): Promise<void> {
  const seq = ++quotaSeq;
  let quota = await fetchQuota(
    effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
  );
  let nextActive = state.licenseActive;
  if (state.licenseKey && state.licenseActive !== false && quota) {
    if (quota.tier === 'pro') {
      nextActive = true;
    } else if (quota.licenseReason !== 'unreachable') {
      const reason = quota.licenseReason;
      nextActive = false;
      const free = await fetchQuota(
        effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, false),
      );
      quota = free
        ? { ...free, licenseReason: reason }
        : {
            tier: 'free',
            used: 0,
            limit: null,
            remaining: null,
            resetsAt: '',
            licenseReason: reason,
          };
    }
  }
  // A slower earlier request must not clobber a newer answer.
  if (seq !== quotaSeq) return;
  state.quota = quota;
  state.licenseActive = nextActive;
  if (state.quota && !isQuotaExhausted(state.quota)) state.quotaExhausted = false;
  quotaFetched = true;
  if (syncLicense) licenseScreenState = resolvedLicenseState();
  paintAllowance();
  if (view === 'license') paint();
}

async function activateCurrentLicense(): Promise<void> {
  const key = licenseInput.trim();
  if (!key || licenseScreenState === 'checking') return;
  licenseScreenState = 'checking';
  paint();
  try {
    const knownInstance = key === state.licenseKey ? state.licenseInstanceId : null;
    let result = await activateLicenseKey(key, knownInstance);
    if (!result.valid && knownInstance) {
      result = await activateLicenseKey(key, null);
    }
    if (result.valid && result.status === 'active') {
      state.licenseActive = true;
      setLicenseKey(state, key, result.instanceId ?? knownInstance);
      licenseInput = key;
      await refreshQuota();
      return;
    }
    if (result.status === 'active') {
      licenseScreenState = 'device-limit';
    } else if (
      result.status === 'expired' ||
      result.status === 'inactive' ||
      result.status === 'disabled'
    ) {
      licenseScreenState = result.status;
    } else {
      licenseScreenState = 'invalid';
    }
  } catch {
    licenseScreenState = 'unreachable';
  }
  paint();
}

async function removeCurrentLicense(): Promise<void> {
  if (licenseScreenState === 'removing') return;
  licenseScreenState = 'removing';
  paint();
  if (state.licenseKey && state.licenseInstanceId) {
    await deactivateLicense(state.licenseKey, state.licenseInstanceId);
  }
  setLicenseKey(state, '', null);
  state.licenseActive = null;
  licenseInput = '';
  licenseScreenState = 'removed';
  paint();
  await refreshQuota(false);
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
      stopComponentProgress();
      nativeNotify(message, { error: true, timeout: 5000 });
      screen = currentName()
        ? { kind: 'ready', componentName: currentName() }
        : { kind: 'empty' };
      paint();
    },
    info: (message) => {
      // A download has no main-thread completion message, so the presenter
      // reports it through Figma's native notification surface.
      stopComponentProgress();
      nativeNotify(message);
      screen = { kind: 'ready', componentName: currentName() };
      paint();
    },
    setBusy: (busy) => {
      if (!busy && screen.kind === 'building') {
        stopComponentProgress();
        screen = { kind: 'ready', componentName: screen.componentName };
        paint();
      }
    },
    startProgress: (messages) => startComponentProgress(messages, action),
    stopProgress: stopComponentProgress,
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

function requestFoundations(): void {
  if (foundationRequested) return;
  foundationRequested = true;
  foundationScreen = { kind: 'loading' };
  paint();
  send({ type: 'requestFoundation' });
}

/**
 * requestFoundations() only ever fires once per session (its own guard
 * above) — a variable or collection added after that first load never
 * appears until the plugin is closed and reopened. This is the manual
 * re-fetch, wired to the footer's "Refresh sources" button the same way
 * refreshLibrary() backs Library's "Refresh library": it re-sends
 * requestFoundation without resetting the screen to a loading skeleton, so
 * the current list stays visible (and usable) while the button spins.
 */
function refreshFoundations(): void {
  foundationRequested = true;
  foundationRefreshing = true;
  paint();
  send({ type: 'requestFoundation' });
}

async function buildFoundations(): Promise<void> {
  const spec = currentFoundationSpec();
  const foundationSelection = currentFoundationSelection();
  if (!spec || !beginOperation(operation)) return;

  foundationAiNote = '';
  setFoundationGenerating(true);
  let groupDescriptions: Record<string, string> | undefined;
  const briefs = currentGroupBriefs();
  const hasIdentity = Boolean(state.licenseKey || state.figmaUserId);

  if (hasColorGroups(spec, foundationSelection) && hasIdentity && briefs?.groups.length) {
    try {
      groupDescriptions = await generateGroupDescriptions(
        briefs.collectionName,
        briefs.groups,
        effectiveAuth(
          state.licenseKey,
          state.licenseInstanceId,
          state.figmaUserId,
          state.licenseActive,
        ),
        (quota) => {
          state.quota = quota;
          quotaFetched = true;
          paintAllowance();
        },
      );
      if (Object.keys(groupDescriptions).length === 0) {
        foundationAiNote = 'AI descriptions came back empty.';
      }
    } catch (error) {
      const detail = error instanceof ProseProxyError
        ? groupErrorCopy(error.code)
        : 'The AI service could not be reached.';
      foundationAiNote = `AI descriptions were skipped. ${detail}`;
    }
  }

  send({
    type: 'renderFoundation',
    selection: foundationSelection,
    config: {
      includeDescriptions: true,
      aiNotes: Boolean(groupDescriptions && Object.keys(groupDescriptions).length > 0),
    },
    ...(groupDescriptions && Object.keys(groupDescriptions).length > 0
      ? { groupDescriptions }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function currentLibraryModel() {
  return buildLibraryModel(libraryEntries, {
    drift: libraryDrift,
    filter: libraryFilter,
    expandedDocId: libraryExpandedDocId,
  });
}

/**
 * The badge's last settled answer.
 *
 * Source checks resolve one doc at a time and a refresh clears them all first,
 * so `counts.updates` is not a fact until a pass finishes: read straight, it
 * takes the badge away at the start of every reload and then counts back up.
 * This holds the answer across that gap.
 */
let libraryHasUpdates = false;

function syncLibraryBadge(): void {
  const model = currentLibraryModel();
  libraryHasUpdates = libraryBadgeVisible({
    updates: model.counts.updates,
    checking: libraryRefreshing ||
      model.allRows.some((row) => row.status === 'pending'),
    previous: libraryHasUpdates,
  });
  setRailBadge(refs.sidebar, 'library', libraryHasUpdates);
}

function refreshLibrary(): void {
  libraryRequested = true;
  libraryRefreshing = true;
  libraryMenuDocId = null;
  libraryExpandedDocId = null;
  if (view === 'library') paint();
  send({ type: 'requestLibrary' });
}

function startLibraryDriftChecks(): void {
  libraryDrift.clear();
  libraryBaseline.clear();
  librarySpecVersion.clear();
  for (const entry of libraryEntries) {
    if (!entry.sourceExists) continue;
    if (entry.kind === 'foundation') {
      libraryDrift.set(
        entry.docId,
        entry.currentContentHash === undefined
          ? 'unavailable'
          : entry.currentContentHash === entry.storedContentHash
            ? 'inSync'
            : 'drifted',
      );
      continue;
    }
    libraryDrift.set(entry.docId, 'pending');
    libraryBaseline.set(entry.docId, entry.storedContentHash);
    librarySpecVersion.set(entry.docId, entry.specVersion);
    send({
      type: 'requestDrift',
      docId: entry.docId,
      sourceNodeId: entry.sourceNodeId,
    });
  }
  syncLibraryBadge();
}

function closeLibraryMenu(restoreFocus = false): void {
  libraryMenuDocId = null;
  if (view === 'library') paint();
  if (restoreFocus) {
    const restore = libraryMenuRestore;
    requestAnimationFrame(() => restore?.focus());
  }
  libraryMenuRestore = null;
}

function libraryPresenter(onError?: (message: string) => void): BuildPresenter {
  return {
    clear: () => {},
    error: (message) => {
      onError?.(message);
    },
    info: (message) => {
      nativeNotify(message);
    },
    setBusy: () => {},
    startProgress: () => {
      if (view === 'library') paint();
    },
    stopProgress: () => {},
  };
}

function libraryEntry(docId: string): LibraryEntry | undefined {
  return libraryEntries.find((entry) => entry.docId === docId);
}

function finishLibraryOperation(error = ''): void {
  const active = libraryOperation;
  if (!active) return;
  let message = '';
  if (active.kind === 'update') {
    message = error
      ? active.completed > 0
        ? `Updated ${active.completed} of ${active.total}. ${error}`
        : error
      : active.batch
        ? `Updated ${active.completed} ${active.completed === 1 ? 'document' : 'documents'}.`
        : 'Document updated.';
  } else if (error) {
    message = error;
  }
  if (message) nativeNotify(message, error ? { error: true, timeout: 5000 } : {});
  libraryOperation = null;
  completeOperation();
  if (view === 'library') paint();
  refreshLibrary();
}

function dispatchNextLibraryUpdate(): void {
  const active = libraryOperation;
  if (!active || active.kind !== 'update') return;
  const docId = active.queue.shift();
  if (!docId) {
    finishLibraryOperation();
    return;
  }
  const entry = libraryEntry(docId);
  if (!entry || !entry.sourceExists) {
    finishLibraryOperation('A source is no longer available, so the remaining updates stopped.');
    return;
  }
  active.currentDocId = docId;
  if (entry.kind === 'foundation') {
    send({ type: 'updateFoundationDoc', docId });
  } else {
    send({ type: 'requestDocSource', docId, intent: 'update' });
  }
  if (view === 'library') paint();
}

function startLibraryUpdates(docIds: string[], batch: boolean): void {
  if (docIds.length === 0 || operation.active) return;
  const edited = docIds.filter((docId) => libraryEntry(docId)?.selfEdited);
  if (
    edited.length > 0 &&
    !window.confirm(
      batch
        ? `${edited.length} selected ${edited.length === 1 ? 'document has' : 'documents have'} manual edits. Updating replaces those edits.`
        : 'You edited this frame by hand. Updating replaces those edits.',
    )
  ) {
    return;
  }
  if (!beginOperation(operation)) return;
  libraryOperation = {
    kind: 'update',
    queue: [...docIds],
    currentDocId: null,
    completed: 0,
    total: docIds.length,
    batch,
    confirmedOverwrite: new Set(edited),
  };
  dispatchNextLibraryUpdate();
}

function startLibraryDownload(docId: string): void {
  const entry = libraryEntry(docId);
  if (!entry || entry.kind !== 'component' || !entry.sourceExists || operation.active) return;
  if (!beginOperation(operation)) return;
  libraryOperation = { kind: 'download', currentDocId: docId };
  paint();
  send({ type: 'requestDocSource', docId, intent: 'download' });
}

function completeCurrentLibraryUpdate(): void {
  const active = libraryOperation;
  if (!active || active.kind !== 'update' || !active.currentDocId) return;
  active.completed += 1;
  active.currentDocId = null;
  dispatchNextLibraryUpdate();
}

// ---------------------------------------------------------------------------
// Global Search
// ---------------------------------------------------------------------------

function currentSearchModel(): SearchModel {
  return buildSearchModel(
    libraryEntries.map((entry) => ({
      docId: entry.docId,
      label: entry.label,
      sourceLabel: entry.sourceLabel,
    })),
    searchQuery,
    searchActiveIndex,
  );
}

function ensureLibraryLoaded(): void {
  if (libraryRequested || libraryRefreshing) return;
  libraryRequested = true;
  libraryRefreshing = true;
  send({ type: 'requestLibrary' });
}

function renderGlobalSearch(focusInput = false): void {
  const existing = refs.root.querySelector<HTMLElement>('[data-global-search-dialog]');
  if (!searchOpen) {
    existing?.remove();
    return;
  }
  const oldInput = existing?.querySelector<HTMLInputElement>('[data-global-search-input]');
  const hadInputFocus = document.activeElement === oldInput;
  const selectionStart = oldInput?.selectionStart ?? searchQuery.length;
  const markup = globalSearchMarkup(currentSearchModel(), {
    libraryLoading: libraryRefreshing && libraryEntries.length === 0,
  });
  if (existing) existing.outerHTML = markup;
  else refs.root.insertAdjacentHTML('beforeend', markup);
  const input = refs.root.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (input && (focusInput || hadInputFocus)) {
    input.focus();
    input.setSelectionRange(selectionStart, selectionStart);
  }
}

// ---------------------------------------------------------------------------
// Font picker
//
// The list is an overlay in the shell root, rendered and positioned here while
// screens/settings.ts owns its markup. It follows the global search palette
// below rather than fontPicker.ts's createFontPicker: that one binds listeners
// to its input and menu, which works against the legacy UI's static template
// but not here, where every paint replaces the screen's DOM. The one piece
// worth sharing is computeMenuPlacement, which is pure.
// ---------------------------------------------------------------------------

/**
 * Applies a colour chosen from a swatch's native picker.
 *
 * Deliberately never repaints. The picker is anchored to the very element a
 * paint would replace, and `input` fires continuously while dragging, so a
 * repaint per event would tear the picker out from under the pointer. Nothing
 * needs one either: the swatch renders its own value and the only other views of
 * this colour are the hex field and the error hint, both updated here by hand.
 * State is committed, so the next natural paint agrees.
 *
 * `commit` separates the drag from the release: persisting on every `input`
 * would write clientStorage on the host once per pointer move.
 */
function applySwatchColor(field: ColorField, raw: string, commit: boolean): void {
  const parsed = parseBrandHex(raw);
  if (!parsed) return; // A native picker cannot produce this, but it is free.
  const hex = document.querySelector<HTMLInputElement>(`[data-theme-field="${field}"]`);
  if (hex) hex.value = parsed;
  if (settingsColorError) {
    settingsColorError = '';
    const hint = document.querySelector<HTMLElement>('[data-settings-color-hint]');
    if (hint) hint.textContent = '';
  }
  if (!commit) return;
  setBrandTheme(state, { ...state.brandTheme, [field]: parsed });
  settingsCustomDraft = { ...state.brandTheme };
}

/** The rows the open list shows: the default row, then the filtered families. */
function fontMenuValues(): string[] {
  if (!fontMenu) return [];
  return ['', ...filterFamilies(settingsFonts, fontMenu.query)];
}

function fontInput(field: FontField): HTMLInputElement | null {
  return refs.root.querySelector<HTMLInputElement>(`[data-theme-font="${field}"]`);
}

function renderFontMenu(): void {
  const existing = refs.root.querySelector<HTMLElement>('[data-font-menu]');
  if (!fontMenu || view !== 'settings') {
    existing?.remove();
    return;
  }
  const markup = fontMenuMarkup({
    field: fontMenu.field,
    families: fontMenuValues().slice(1),
    activeIndex: fontMenu.activeIndex,
    loaded: settingsFonts.length > 0,
  });
  if (existing) existing.outerHTML = markup;
  else refs.root.insertAdjacentHTML('beforeend', markup);
  positionFontMenu();
  syncFontActiveRow();
}

function positionFontMenu(): void {
  const input = fontMenu && fontInput(fontMenu.field);
  const menu = refs.root.querySelector<HTMLElement>('.sl-font-menu');
  if (!input || !menu) return;
  const placement = computeMenuPlacement(
    input.getBoundingClientRect(),
    window.innerHeight,
  );
  menu.style.left = `${placement.left}px`;
  menu.style.width = `${placement.width}px`;
  menu.style.maxHeight = `${placement.maxHeight}px`;
  if (placement.openUp) {
    menu.style.top = 'auto';
    menu.style.bottom = `${placement.bottom}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${placement.top}px`;
  }
}

/** Moves the highlight without re-rendering, so typing keeps its caret. */
function syncFontActiveRow(): void {
  if (!fontMenu) return;
  const rows = refs.root.querySelectorAll<HTMLElement>('[data-font-index]');
  for (const row of rows) {
    const active = Number(row.dataset.fontIndex) === fontMenu.activeIndex;
    row.classList.toggle('is-active', active);
    row.setAttribute('aria-selected', String(active));
    if (active) row.scrollIntoView({ block: 'nearest' });
  }
  const input = fontInput(fontMenu.field);
  if (input) {
    input.setAttribute('aria-activedescendant', `sl-font-option-${fontMenu.activeIndex}`);
  }
}

function openFontMenu(field: FontField): void {
  // Opening on the committed value would filter the list down to that one
  // family, leaving no way to reach another. An empty query lists everything.
  const committed = fontInput(field)?.value.trim() ?? '';
  const index = committed
    ? Math.max(0, filterFamilies(settingsFonts, '').indexOf(committed) + 1)
    : 0;
  fontMenu = { field, query: '', activeIndex: index };
  renderFontMenu();
  const input = fontInput(field);
  if (input) input.setAttribute('aria-expanded', 'true');
}

function closeFontMenu(restoreFocus = false): void {
  if (!fontMenu) return;
  const field = fontMenu.field;
  fontMenu = null;
  refs.root.querySelector('[data-font-menu]')?.remove();
  const input = fontInput(field);
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restoreFocus) input.focus({ preventScroll: true });
  }
}

/** Applies a font choice. '' clears the field back to the default. */
function commitFont(field: FontField, value: string): void {
  const next = value.trim();
  setBrandTheme(state, { ...state.brandTheme, [field]: next || null });
  settingsCustomDraft = { ...state.brandTheme };
  settingsFontWarning = fontFallbackWarning(next);
  closeFontMenu();
  paintAndFocus(`[data-theme-font="${field}"]`);
}

/**
 * A family the host did not list will silently fall back to Inter in the frame,
 * so free-typed text still commits but says so. Only meaningful once the list
 * has arrived: before that, nothing can be checked against it.
 */
function fontFallbackWarning(value: string): string {
  const unknown =
    value !== '' &&
    value !== 'Inter' &&
    settingsFonts.length > 0 &&
    !settingsFonts.includes(value);
  return unknown
    ? 'Figma does not list Regular, Medium, and Bold styles for this font. The frame will fall back to Inter.'
    : '';
}

function openGlobalSearch(): void {
  if (searchOpen) return;
  if (libraryMenuDocId) closeLibraryMenu();
  closeFontMenu();
  searchRestoreTarget = refs.searchButton;
  searchOpen = true;
  searchQuery = '';
  searchActiveIndex = 0;
  ensureLibraryLoaded();
  renderGlobalSearch();
  requestAnimationFrame(() => {
    refs.root.querySelector<HTMLInputElement>('[data-global-search-input]')?.focus();
  });
}

function closeGlobalSearch(restoreFocus = true): void {
  if (!searchOpen) return;
  searchOpen = false;
  searchQuery = '';
  searchActiveIndex = 0;
  refs.root.querySelector('[data-global-search-dialog]')?.remove();
  if (restoreFocus) {
    const restore = searchRestoreTarget ?? refs.searchButton;
    requestAnimationFrame(() => restore.focus());
  }
  searchRestoreTarget = null;
}

function setSearchActiveIndex(index: number): void {
  const model = currentSearchModel();
  searchActiveIndex = model.results.length
    ? Math.min(Math.max(0, index), model.results.length - 1)
    : 0;
  const input = refs.root.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (input) {
    if (model.results.length) {
      input.setAttribute(
        'aria-activedescendant',
        `sl-global-search-result-${searchActiveIndex}`,
      );
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  for (
    const result of refs.root.querySelectorAll<HTMLButtonElement>('[data-search-index]')
  ) {
    const active = Number(result.dataset.searchIndex) === searchActiveIndex;
    result.classList.toggle('is-active', active);
    result.setAttribute('aria-selected', String(active));
  }
  refs.root.querySelector<HTMLElement>(
    `#sl-global-search-result-${searchActiveIndex}`,
  )?.scrollIntoView({ block: 'nearest' });
}

function activateSearchResult(result: SearchResult | undefined): void {
  if (!result) return;
  closeGlobalSearch();
  if (result.kind === 'workflow') {
    navigateToView(result.view);
    return;
  }
  libraryFilter = 'all';
  navigateToView('library', { refreshLibrary: false });
  send({ type: 'focusNode', nodeId: result.docId });
}

function trapSearchFocus(event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || !searchOpen) return false;
  const dialog = refs.root.querySelector<HTMLElement>('[data-global-search-dialog]');
  if (!dialog) return false;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
  if (focusable.length === 0) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function toggle<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function paintAndFocus(selector: string): void {
  const scrollTop = refs.scroll.scrollTop;
  paint();
  refs.scroll.scrollTop = scrollTop;
  document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
}

function syncVariantPicker(): void {
  const inputs = [
    ...refs.scroll.querySelectorAll<HTMLInputElement>('[data-variant]'),
  ];
  for (const input of inputs) {
    const selected = Boolean(input.dataset.variant && selection.variantIds.has(input.dataset.variant));
    input.checked = selected;
    input.closest('.sl-section-row')?.classList.toggle('is-selected', selected);
  }

  const count = refs.scroll.querySelector<HTMLElement>('[data-variant-count]');
  if (count) {
    count.textContent = variantCountLabel(
      inputs.filter((input) => input.checked).length,
      inputs.length,
    );
  }

  const bulk = refs.scroll.querySelector<HTMLInputElement>('[data-variants-bulk]');
  if (bulk) {
    const state = variantBulkState(
      selection.variantIds,
      inputs.flatMap((input) => input.dataset.variant ? [input.dataset.variant] : []),
    );
    bulk.checked = state.checked;
    bulk.indeterminate = state.mixed;
    bulk.dataset.mixed = String(state.mixed);
    bulk.setAttribute('aria-checked', state.mixed ? 'mixed' : String(state.checked));
    const label = state.checked ? 'Clear all variants' : 'Select all variants';
    bulk.setAttribute('aria-label', label);
    bulk.closest<HTMLLabelElement>('.sl-bulk-checkbox')?.setAttribute('title', label);
  }
}

function syncMeasurementOptions(): void {
  const only = selection.measureViews.size === 1
    ? [...selection.measureViews][0]
    : null;
  for (const button of refs.scroll.querySelectorAll<HTMLButtonElement>('[data-measure]')) {
    const id = button.dataset.measure as 'size' | 'padding' | 'spacing' | undefined;
    if (!id) continue;
    const selected = selection.measureViews.has(id);
    button.setAttribute('aria-pressed', String(selected));
    if (selected && only === id) {
      button.setAttribute('aria-disabled', 'true');
      button.title = 'At least one measurement view is required';
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('title');
    }
  }
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

  if (target.closest(`#${refs.searchButton.id}`)) {
    openGlobalSearch();
    return;
  }

  if (target.closest('[data-search-close]')) {
    closeGlobalSearch();
    return;
  }

  if (target.closest('[data-search-clear]')) {
    searchQuery = '';
    searchActiveIndex = 0;
    renderGlobalSearch(true);
    return;
  }

  const searchResult = target.closest<HTMLButtonElement>('[data-search-index]');
  if (searchResult?.dataset.searchIndex) {
    activateSearchResult(
      currentSearchModel().results[Number(searchResult.dataset.searchIndex)],
    );
    return;
  }

  const rail = target.closest<HTMLButtonElement>('[data-view]');
  if (rail?.dataset.view) {
    navigateToView(rail.dataset.view as PluginView);
    return;
  }

  if (target.closest(`#${refs.allowanceButton.id}`)) {
    navigateToView('license');
    return;
  }

  const libraryFilterButton = target.closest<HTMLButtonElement>('[data-library-filter]');
  if (libraryFilterButton?.dataset.libraryFilter) {
    libraryFilter = libraryFilterButton.dataset.libraryFilter as LibraryFilter;
    libraryExpandedDocId = null;
    libraryMenuDocId = null;
    paintAndFocus(`[data-library-filter="${libraryFilter}"]`);
    return;
  }

  if (target.closest('[data-library-refresh]')) {
    if (!operation.active) refreshLibrary();
    return;
  }

  if (target.closest('[data-library-update-all]')) {
    const model = currentLibraryModel();
    if (
      model.allRows.some((row) => row.status === 'pending' || row.status === 'unavailable')
    ) {
      nativeNotify(
        'Refresh the Library before updating so every source is checked.',
        { error: true, timeout: 4500 },
      );
      return;
    }
    startLibraryUpdates(
      model.allRows
        .filter((row) => row.status === 'updateAvailable')
        .map((row) => row.docId),
      true,
    );
    return;
  }

  const libraryDisclosure = target.closest<HTMLButtonElement>('[data-library-disclosure]');
  if (libraryDisclosure?.dataset.libraryDisclosure) {
    const docId = libraryDisclosure.dataset.libraryDisclosure;
    libraryExpandedDocId = libraryExpandedDocId === docId ? null : docId;
    paintAndFocus(`[data-library-disclosure="${docId}"]`);
    return;
  }

  const libraryMenu = target.closest<HTMLButtonElement>('[data-library-menu]');
  if (libraryMenu?.dataset.libraryMenu) {
    const docId = libraryMenu.dataset.libraryMenu;
    if (libraryMenuDocId === docId) {
      closeLibraryMenu(true);
    } else {
      libraryMenuDocId = docId;
      libraryMenuRestore = libraryMenu;
      paint();
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(
          `.sl-library-overflow-menu [data-doc-id="${docId}"]`,
        )?.focus();
      });
    }
    return;
  }

  if (target.closest('[data-library-menu-close]')) {
    closeLibraryMenu(true);
    return;
  }

  const libraryFrame = target.closest<HTMLButtonElement>('[data-library-open-frame]');
  if (libraryFrame?.dataset.libraryOpenFrame) {
    send({ type: 'focusNode', nodeId: libraryFrame.dataset.libraryOpenFrame });
    return;
  }

  const libraryAction = target.closest<HTMLButtonElement>('[data-library-action]');
  if (libraryAction?.dataset.libraryAction && libraryAction.dataset.docId) {
    const action = libraryAction.dataset.libraryAction;
    const docId = libraryAction.dataset.docId;
    const entry = libraryEntry(docId);
    closeLibraryMenu();
    switch (action) {
      case 'review':
        libraryExpandedDocId = libraryExpandedDocId === docId ? null : docId;
        paint();
        return;
      case 'update':
        startLibraryUpdates([docId], false);
        return;
      case 'open-frame':
        send({ type: 'focusNode', nodeId: docId });
        return;
      case 'open-source':
        if (entry?.sourceNodeId) {
          send({ type: 'focusNode', nodeId: entry.sourceNodeId });
        }
        return;
      case 'download':
        startLibraryDownload(docId);
        return;
      case 'detach':
        if (
          !operation.active &&
          window.confirm(
            'Detach this documentation? It stays on the canvas as a plain frame and stops tracking its source.',
          )
        ) {
          send({ type: 'detachDoc', docId });
        }
        return;
      case 'remove':
        if (
          !operation.active &&
          window.confirm('Remove this documentation frame from the canvas?')
        ) {
          send({ type: 'removeDoc', docId });
        }
        return;
      default:
        return;
    }
  }

  const licenseOpen = target.closest<HTMLButtonElement>('[data-license-open]');
  if (licenseOpen?.dataset.licenseOpen) {
    const urls: Record<string, string> = {
      upgrade: CHECKOUT_URL,
      manage: MANAGE_SUB_URL,
      renew: STOREFRONT_URL,
      support: SITE_URL,
    };
    const url = urls[licenseOpen.dataset.licenseOpen];
    if (url) send({ type: 'openBrowser', url });
    return;
  }

  if (target.closest('[data-license-remove]')) {
    void removeCurrentLicense();
    return;
  }

  if (target.closest('[data-license-retry]')) {
    licenseInput = state.licenseKey ?? '';
    licenseScreenState = 'inactive';
    paintAndFocus('[data-license-input]');
    return;
  }

  // Font list. Picking a row commits; the chevron toggles; clicking the input
  // opens but never closes, so a click to place the caret does not dismiss it.
  const fontOption = target.closest<HTMLElement>('[data-font-value]');
  if (fontOption && fontMenu) {
    commitFont(fontMenu.field, fontOption.dataset.fontValue ?? '');
    return;
  }

  const fontToggle = target.closest<HTMLElement>('[data-font-toggle]');
  if (fontToggle) {
    const field = fontToggle.dataset.fontToggle as FontField;
    if (fontMenu?.field === field) closeFontMenu(true);
    else {
      fontInput(field)?.focus({ preventScroll: true });
      openFontMenu(field);
    }
    return;
  }

  const fontOwnInput = target.closest<HTMLElement>('[data-theme-font]');
  if (fontOwnInput) {
    const field = fontOwnInput.dataset.themeFont as FontField;
    if (fontMenu?.field !== field) openFontMenu(field);
    return;
  }

  // Anything else outside the open list dismisses it, then falls through so the
  // click still does whatever it was for.
  if (fontMenu) closeFontMenu();

  if (target.closest('[data-theme-preset="__custom__"]')) {
    settingsColorError = '';
    settingsFontWarning = '';
    settingsCustomMode = true;
    settingsCustomDraft ??= { ...THEME_PRESETS[0].theme };
    setBrandTheme(state, { ...settingsCustomDraft });
    paintAndFocus('[data-theme-preset="__custom__"]');
    return;
  }

  const themeChoice = target.closest<HTMLButtonElement>('[data-theme-preset]');
  if (themeChoice?.dataset.themePreset) {
    settingsColorError = '';
    settingsFontWarning = '';
    const preset = THEME_PRESETS.find(
      (item) => item.name === themeChoice.dataset.themePreset,
    );
    if (!preset) return;
    settingsCustomMode = false;
    setBrandTheme(state, { ...preset.theme });
    paintAndFocus(`[data-theme-preset="${themeChoice.dataset.themePreset}"]`);
    return;
  }

  if (target.closest('[data-settings-logo-capture]')) {
    settingsLogoError = '';
    send({ type: 'captureLogo' });
    return;
  }

  if (target.closest('[data-settings-logo-remove]')) {
    settingsLogoError = '';
    send({ type: 'clearLogo' });
    return;
  }

  // Component and Foundation controls are inert while an async build/download
  // owns shared UiState.
  if (operation.active) return;

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

  const measure = target.closest<HTMLButtonElement>('[data-measure]');
  if (measure?.dataset.measure) {
    const id = measure.dataset.measure as 'size' | 'padding' | 'spacing';
    // Measurements is an included section, so at least one diagram must stay
    // selected. The final option declares that constraint before it is clicked.
    if (measure.getAttribute('aria-disabled') === 'true') return;
    toggle(selection.measureViews, id);
    state.measureViews = [...selection.measureViews];
    syncMeasurementOptions();
    return;
  }

  if (target.closest('#sl-download')) {
    if (!beginOperation(operation)) return;
    void downloadDoc(state, docSelection(), presenter('download')).finally(completeOperation);
    return;
  }
  if (target.closest('#sl-create')) build();

  if (target.closest('[data-foundation-refresh]')) {
    if (!operation.active) refreshFoundations();
    return;
  }

  if (target.closest('[data-foundation-bulk]')) {
    onFoundationToggleAll();
    paintAndFocus('[data-foundation-bulk]');
    return;
  }

  const foundationSource = target.closest<HTMLButtonElement>('[data-foundation-source]');
  if (foundationSource?.dataset.foundationSource) {
    const checked = foundationSource.getAttribute('aria-pressed') !== 'true';
    if (foundationSource.dataset.textStyles === 'true') {
      onFoundationChange({ kind: 'textStyles', checked });
    } else {
      onFoundationChange({
        kind: 'collection',
        collectionId: foundationSource.dataset.foundationSource,
        checked,
      });
    }
    paintAndFocus(
      `[data-foundation-source="${foundationSource.dataset.foundationSource}"]`,
    );
    return;
  }

  if (target.closest('#sl-foundation-create')) {
    void buildFoundations();
  }
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input || operation.active) return;

  // A swatch's picker closing is the commit. Still no repaint: some engines fire
  // `change` while the picker is open, and it is the picker's own element.
  const pickedSwatch = input.dataset.themeSwatch as ColorField | undefined;
  if (pickedSwatch) {
    applySwatchColor(pickedSwatch, input.value, true);
    return;
  }

  const colorField = input.dataset.themeField as ColorField | undefined;
  if (colorField) {
    const raw = input.value.trim();
    const parsed = raw ? parseBrandHex(raw) : null;
    if (raw && !parsed) {
      settingsColorError = 'Enter a 6-digit hex color, e.g. #0d2436.';
      const hint = document.querySelector<HTMLElement>('[data-settings-color-hint]');
      if (hint) hint.textContent = settingsColorError;
      return;
    }
    settingsColorError = '';
    setBrandTheme(state, {
      ...state.brandTheme,
      [colorField]: parsed,
    });
    settingsCustomDraft = { ...state.brandTheme };
    paintAndFocus(`[data-theme-field="${colorField}"]`);
    return;
  }

  const fontField = input.dataset.themeFont as
    | 'headingFont'
    | 'bodyFont'
    | undefined;
  if (fontField) {
    // Free-typed text commits here on blur or Enter, the same path a picked row
    // takes. commitFont owns the fallback warning so both agree.
    commitFont(fontField, input.value);
    return;
  }

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
    syncVariantPicker();
    input.focus({ preventScroll: true });
    return;
  }

  if (input.hasAttribute('data-variants-bulk')) {
    const variantIds = facts.variants.map((variant) => variant.nodeId);
    const bulk = variantBulkState(selection.variantIds, variantIds);
    applyVariantBulk(selection.variantIds, variantIds, !bulk.checked);
    syncVariantPicker();
    input.focus({ preventScroll: true });
    return;
  }

  const groupId = input.dataset.groupBulk as GroupId | undefined;
  if (groupId) {
    const unavailable = unavailableSections(facts);
    const groupState = sectionGroups(
      selection.sections,
      selection.expanded,
      selection.aiEnabled,
      unavailable,
    ).find((item) => item.id === groupId);
    if (!groupState) return;
    applyGroupBulk(
      selection.sections,
      groupId,
      groupState.included < groupState.total,
      unavailable,
    );
    paintAndFocus(`[data-group-bulk="${groupId}"]`);
    return;
  }

  const sectionId = input.dataset.section as SectionId | undefined;
  if (sectionId) {
    if (input.checked) selection.sections.add(sectionId);
    else selection.sections.delete(sectionId);
    paintAndFocus(`[data-section="${sectionId}"]`);
  }
});

document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.matches('[data-global-search-input]')) {
    searchQuery = input.value;
    searchActiveIndex = 0;
    renderGlobalSearch(true);
    return;
  }
  if (operation.active) return;
  if (input.matches('[data-license-input]')) {
    licenseInput = input.value;
    const activateButton = document.querySelector<HTMLButtonElement>('[data-license-activate]');
    if (activateButton) activateButton.disabled = !licenseInput.trim();
    if (
      licenseScreenState === 'invalid' ||
      licenseScreenState === 'disabled' ||
      licenseScreenState === 'device-limit' ||
      licenseScreenState === 'unreachable' ||
      licenseScreenState === 'removed'
    ) {
      licenseScreenState = 'free';
      paintAndFocus('[data-license-input]');
    }
    return;
  }
  // Dragging in a swatch's picker: mirror it into the hex field live, but do
  // not persist until the picker closes (see applySwatchColor).
  const draggedSwatch = input.dataset.themeSwatch as ColorField | undefined;
  if (draggedSwatch) {
    applySwatchColor(draggedSwatch, input.value, false);
    return;
  }

  // Typing filters the list rather than waiting for a commit on blur, which is
  // what a searchable field is for. Only the menu subtree re-renders, so the
  // caret stays where it is; the value itself still commits on change/Enter.
  const typedFont = input.dataset.themeFont as FontField | undefined;
  if (typedFont) {
    if (!fontMenu || fontMenu.field !== typedFont) {
      fontMenu = { field: typedFont, query: input.value, activeIndex: 0 };
    } else {
      fontMenu.query = input.value;
      fontMenu.activeIndex = 0;
    }
    renderFontMenu();
    return;
  }

  const colorField = input.dataset.themeField as ColorField | undefined;
  if (!colorField) return;

  // Typing a valid hex repaints, which is what carries the new value back into
  // the swatch beside it. Safe here: no picker is open while the field is typed.
  const parsed = parseBrandHex(input.value);
  if (!parsed) {
    settingsColorError = 'Enter a 6-digit hex color, e.g. #0d2436.';
    const hint = document.querySelector<HTMLElement>('[data-settings-color-hint]');
    if (hint) hint.textContent = settingsColorError;
    return;
  }
  settingsColorError = '';
  setBrandTheme(state, { ...state.brandTheme, [colorField]: parsed });
  settingsCustomDraft = { ...state.brandTheme };
  paintAndFocus(`[data-theme-field="${colorField}"]`);
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-license-form]')) return;
  event.preventDefault();
  void activateCurrentLicense();
});

document.addEventListener('keydown', (event) => {
  if (
    !event.repeat &&
    !event.isComposing &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'k'
  ) {
    event.preventDefault();
    if (searchOpen) closeGlobalSearch();
    else openGlobalSearch();
    return;
  }

  if (searchOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeGlobalSearch();
      return;
    }
    if (trapSearchFocus(event)) return;
    const input = event.target instanceof HTMLInputElement
      && event.target.matches('[data-global-search-input]');
    if (input) {
      const model = currentSearchModel();
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault();
        setSearchActiveIndex(
          nextSearchIndex(
            searchActiveIndex,
            event.key,
            model.results.length,
          ),
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        activateSearchResult(model.results[model.activeIndex]);
        return;
      }
    }
  }

  // Font field. ArrowDown opens a closed list, so the whole control is reachable
  // without a pointer. Enter takes the highlighted family; with nothing
  // highlighted it falls through to the field's own change, which commits the
  // typed text so an unlisted family stays possible.
  if (event.target instanceof HTMLInputElement && event.target.dataset.themeFont) {
    const field = event.target.dataset.themeFont as FontField;
    if (event.key === 'Escape' && fontMenu) {
      event.preventDefault();
      closeFontMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' && !fontMenu) {
      event.preventDefault();
      openFontMenu(field);
      return;
    }
    if (
      fontMenu &&
      (event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End')
    ) {
      event.preventDefault();
      fontMenu.activeIndex = nextSearchIndex(
        fontMenu.activeIndex,
        event.key,
        fontMenuValues().length,
      );
      syncFontActiveRow();
      return;
    }
    if (event.key === 'Enter' && fontMenu) {
      const values = fontMenuValues();
      if (fontMenu.activeIndex < values.length) {
        event.preventDefault();
        commitFont(field, values[fontMenu.activeIndex]);
        return;
      }
    }
    if (event.key === 'Tab' && fontMenu) closeFontMenu();
  }

  if (libraryMenuDocId) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLibraryMenu(true);
      return;
    }

    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      const menu = refs.root.querySelector<HTMLElement>('.sl-library-overflow-menu');
      const items = menu
        ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')]
        : [];
      if (items.length === 0) return;
      event.preventDefault();
      const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      items[nextSearchIndex(current, event.key, items.length)]?.focus();
    }
  }
});

function syncSearchPointer(target: EventTarget | null): void {
  if (!searchOpen || !(target instanceof Element)) return;
  const result = target.closest<HTMLElement>('[data-search-index]');
  if (!result?.dataset.searchIndex) return;
  setSearchActiveIndex(Number(result.dataset.searchIndex));
}

document.addEventListener('pointerover', (event) => {
  syncSearchPointer(event.target);
});

document.addEventListener('focusin', (event) => {
  syncSearchPointer(event.target);
});

refs.scroll.addEventListener('scroll', () => {
  // The font list is position: fixed against the input's viewport rect, so it
  // has to follow the panel rather than be dismissed by it: the field stays
  // visible while scrolling, unlike a row menu whose own row scrolls away.
  if (fontMenu) positionFontMenu();
  if (!libraryMenuDocId) return;
  libraryMenuDocId = null;
  libraryMenuRestore = null;
  refs.scroll.querySelector('.sl-library-menu-scrim')?.remove();
  refs.scroll.querySelector('.sl-library-overflow-menu')?.remove();
  refs.scroll.querySelector<HTMLButtonElement>('[data-library-menu][aria-expanded="true"]')
    ?.setAttribute('aria-expanded', 'false');
}, { passive: true });

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
  // Update the shared foundation BEFORE the deferred extraction below reads
  // it, so this selection's own extract() sees it rather than lagging one
  // selection behind. Absent when the main thread has no dump yet (or
  // building one failed) — extraction still proceeds, just without contrast.
  if (msg.foundation) onSelectionFoundation(msg.foundation);
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
      if (libraryOperation?.kind === 'update' && libraryOperation.currentDocId) {
        completeCurrentLibraryUpdate();
        void refreshQuota();
        return;
      }
      {
        stopComponentProgress();
        const note = state.pendingAiNote;
        const outcome = msg.replaced ? 'Docs replaced' : 'Docs created';
        screen = {
          kind: 'success',
          componentName: currentName(),
          replaced: msg.replaced,
        };
        nativeNotify(
          note ? `${outcome}. ${note}` : outcome,
          note ? { timeout: 5500 } : {},
        );
        state.pendingAiNote = '';
      }
      paint();
      completeOperation();
      // A build may have spent an AI use, so the header should stop showing a
      // stale count.
      void refreshQuota();
      return;

    case 'docFrameError':
      if (libraryOperation?.kind === 'update' && libraryOperation.currentDocId) {
        finishLibraryOperation(`Update failed: ${msg.message}`);
        return;
      }
      stopComponentProgress();
      nativeNotify(msg.message, { error: true, timeout: 5000 });
      screen = currentName()
        ? { kind: 'ready', componentName: currentName() }
        : { kind: 'empty' };
      paint();
      completeOperation();
      return;

    case 'licenseKey':
      state.licenseKey = msg.value;
      state.licenseInstanceId = msg.instanceId;
      licenseInput = msg.value ?? '';
      licenseScreenState = msg.value ? 'checking' : 'free';
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

    case 'brandTheme':
      state.brandTheme = msg.value;
      settingsCustomMode = matchPreset(msg.value) === null;
      if (settingsCustomMode) settingsCustomDraft = { ...msg.value };
      paint();
      return;

    case 'fontList':
      settingsFonts = msg.families;
      // The list is fetched on the first visit to Settings, so it usually
      // arrives while the user is already looking at the fields. Re-render the
      // open menu (it may have been showing the "no fonts" fallback) and
      // re-check any value typed before the list existed.
      settingsFontWarning = fontFallbackWarning(
        fontMenu ? fontInput(fontMenu.field)?.value.trim() ?? '' : '',
      );
      if (fontMenu) renderFontMenu();
      return;

    case 'logoCaptured':
      state.logoBase64 = msg.base64;
      settingsLogoError = '';
      paint();
      return;

    case 'logoCleared':
      state.logoBase64 = null;
      settingsLogoError = '';
      paint();
      return;

    case 'logoError':
      settingsLogoError = msg.message;
      paint();
      return;

    case 'componentImage':
      resolveComponentImage({ base64: msg.base64, mediaType: msg.mediaType });
      return;

    case 'componentImageError':
      // Fail open: AI writing continues from the structured component summary.
      resolveComponentImage(null);
      return;

    case 'foundation':
      onFoundationMessage(msg.dump);
      foundationScreen = { kind: 'ready' };
      foundationRefreshing = false;
      paint();
      return;

    case 'foundationError':
      foundationRequested = false;
      foundationRefreshing = false;
      foundationScreen = { kind: 'error', message: msg.message };
      paint();
      return;

    case 'foundationProgress':
      foundationScreen = {
        kind: 'generating',
        done: msg.done,
        total: msg.total,
        ...(foundationScreen.kind === 'generating' && foundationScreen.phase
          ? { phase: foundationScreen.phase }
          : {}),
      };
      paint();
      return;

    case 'foundationDone':
      // A docId belongs to a Library row update. The Library migration handles
      // that branch; this one owns only the bulk Foundation workflow.
      if (msg.docId) {
        if (
          libraryOperation?.kind === 'update' &&
          libraryOperation.currentDocId === msg.docId
        ) {
          completeCurrentLibraryUpdate();
          void refreshQuota();
        }
        return;
      }
      setFoundationGenerating(false);
      {
        const parts = [
          msg.created ? `${msg.created} created` : '',
          msg.replaced ? `${msg.replaced} updated` : '',
          foundationAiNote,
        ].filter(Boolean);
        nativeNotify(parts.join(' · ') || 'Foundation docs created');
      }
      foundationScreen = { kind: 'ready' };
      foundationAiNote = '';
      paint();
      completeOperation();
      void refreshQuota();
      return;

    case 'foundationFrameError':
      if (
        libraryOperation?.kind === 'update' &&
        libraryOperation.currentDocId &&
        libraryEntry(libraryOperation.currentDocId)?.kind === 'foundation'
      ) {
        finishLibraryOperation(`Update failed: ${msg.message}`);
        return;
      }
      setFoundationGenerating(false);
      nativeNotify(
        msg.created > 0
          ? `${msg.created} created before the build stopped. ${msg.message}`
          : msg.message,
        { error: true, timeout: 5500 },
      );
      foundationScreen = { kind: 'ready' };
      foundationAiNote = '';
      paint();
      completeOperation();
      return;

    case 'library':
      libraryRequested = true;
      libraryEntries = msg.entries;
      libraryMenuDocId = null;
      startLibraryDriftChecks();
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    case 'driftSource': {
      const baseline = libraryBaseline.get(msg.docId);
      if (baseline === undefined) return;
      // A pre-0.2 doc was produced by an extractor whose hash projection differs,
      // so comparing hashes would report drift for the wrong reason.
      if (librarySpecVersion.get(msg.docId) !== SPEC_VERSION) {
        libraryDrift.set(msg.docId, 'staleVersion');
      } else {
        try {
          const spec = extract(msg.node, { figmaFile: msg.fileKey });
          libraryDrift.set(
            msg.docId,
            specContentHash(spec) === baseline ? 'inSync' : 'drifted',
          );
        } catch {
          libraryDrift.set(msg.docId, 'unavailable');
        }
      }
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      if (view === 'library') paint();
      return;
    }

    case 'driftError':
      if (!libraryBaseline.has(msg.docId)) return;
      libraryDrift.set(msg.docId, 'unavailable');
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      if (view === 'library') paint();
      return;

    case 'docSource': {
      const active = libraryOperation;
      if (!active || active.currentDocId !== msg.docId) return;
      const src = {
        docId: msg.docId,
        node: msg.node,
        fileKey: msg.fileKey,
        config: msg.config,
      };
      if (active.kind === 'download') {
        let failed = false;
        void downloadFromSource(state, src, libraryPresenter((message) => {
          failed = true;
          nativeNotify(message, { error: true, timeout: 5000 });
        })).then(() => {
          if (
            failed ||
            libraryOperation?.kind !== 'download' ||
            libraryOperation.currentDocId !== msg.docId
          ) {
            if (failed && libraryOperation?.kind === 'download') {
              libraryOperation = null;
              completeOperation();
              if (view === 'library') paint();
            }
            return;
          }
          nativeNotify(`Downloaded ${msg.node.name || 'component'} documentation.`);
          libraryOperation = null;
          completeOperation();
          if (view === 'library') paint();
          void refreshQuota();
        });
        return;
      }

      if (msg.selfEdited && !active.confirmedOverwrite.has(msg.docId)) {
        if (!window.confirm('You edited this frame by hand. Updating replaces those edits.')) {
          finishLibraryOperation('Update canceled because the frame has newer manual edits.');
          return;
        }
        active.confirmedOverwrite.add(msg.docId);
      }
      let preparationError = '';
      void updateFromSource(state, src, libraryPresenter((message) => {
        preparationError = message;
      })).then((dispatched) => {
        if (!dispatched) {
          finishLibraryOperation(
            preparationError ||
            'The source could not be prepared, so the remaining updates stopped.',
          );
        }
      });
      return;
    }

    case 'docSourceError':
      if (
        libraryOperation &&
        libraryOperation.currentDocId === msg.docId
      ) {
        finishLibraryOperation(msg.message);
      }
      return;

    case 'docDetached':
    case 'docRemoved':
      nativeNotify(
        msg.type === 'docDetached'
          ? 'Documentation detached from its source.'
          : 'Documentation connection removed.',
      );
      libraryEntries = libraryEntries.filter((entry) => entry.docId !== msg.docId);
      libraryDrift.delete(msg.docId);
      libraryBaseline.delete(msg.docId);
      librarySpecVersion.delete(msg.docId);
      if (libraryExpandedDocId === msg.docId) libraryExpandedDocId = null;
      if (libraryMenuDocId === msg.docId) libraryMenuDocId = null;
      syncLibraryBadge();
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    default:
      return;
  }
};

paintAllowance();
paint();
send({ type: 'requestSelection' });

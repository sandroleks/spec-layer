/**
 * ui-vnext.ts — the plugin UI's only entry point.
 *
 * Every screen renders through the shared shell: this module owns the state and
 * the message plumbing, and each `screens/*` module owns its own markup.
 */

import {
  extract, specHashProjection, contentHash, EXTRACTOR_VERSION,
  type SpecHashProjection,
} from '@spec-layer/extractor';
import type { ProseV2 } from '@spec-layer/extractor';
import {
  THEME_PRESETS,
  matchPreset,
  parseBrandHex,
  type BrandTheme,
} from '../brandColors';
import type { DocSourceIntent, LibraryEntry, MainToUi } from '../messages';
import type { GroupId, OmittedSection, SectionId } from './docModel';
import {
  isPluginView,
  type ComponentScreenState,
  type FoundationScreenState,
  type LicenseState,
  type PluginView,
} from './viewModel/contracts';
import { allowanceState, publishAllowance } from './viewModel/allowance';
import { mountShell, setActiveView, wireShellTheme, type ShellRefs } from './shell/shell';
import { renderAllowance } from './shell/header';
import { setRailBadge } from './shell/sidebar';
import { confirmDialog } from './shell/confirmDialog';
import {
  createComponentSelection,
  MEASURE_LAST_VIEW_TITLE,
  renderComponentScreen,
  type ComponentSelection,
} from './screens/component';
import { renderFoundationScreen } from './screens/foundations';
import {
  SETTINGS_TABS,
  fontMenuMarkup,
  isSettingsTab,
  paintFontWarning,
  renderSettingsScreen,
  syncFontFieldExpanded,
  type ColorField,
  type FontField,
  type SettingsTab,
} from './screens/settings';
import { rovingIndex } from './viewModel/roving';
import { COMPONENT_FORMATS, isComponentFormat, type ComponentFormat } from '../componentFormat';
import { computeMenuPlacement } from './fontPicker';
import { filterFamilies } from '../fonts';
import { renderLicenseScreen } from './screens/license';
import { patchLibraryDrift, renderLibraryScreen, revealLibraryRow, type LibraryScreenPresentation } from './screens/library';
import { patchInitialVersion, renderPublishScreen } from './screens/publish';
import { renderHistoryScreen } from './screens/history';
import { globalSearchMarkup, patchGlobalSearch, setSearchActive } from './screens/search';
import {
  applyGroupBulk,
  applyVariantBulk,
  componentDocSelection,
  defaultIncludeHidden,
  sectionGroups,
  unavailableSections,
  variantBulkState,
  variantCountLabel,
} from './viewModel/componentScreen';
import {
  buildLibraryModel,
  isLibraryFilter,
  libraryBadgeVisible,
  libraryUpdateIntent,
  resolveLibraryChanges,
  type LibraryChangeResult,
  type LibraryDriftState,
  type LibraryFilter,
} from './viewModel/library';
import {
  buildSearchModel,
  nextSearchIndex,
  type SearchDocument,
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
  aiFailureNote,
  autoExtract,
  copyBriefFromSource,
  copyFoundationBrief,
  copyFoundationBriefForScope,
  createDocFrame,
  createState,
  currentFoundationSelection,
  currentFoundationSpec,
  currentGroupBriefs,
  foundationAiRequested,
  onFoundationChange,
  onFoundationMessage,
  setFoundationGroupDescriptions,
  onSelectionFoundation,
  nextPhaseIndex,
  omissionsMessage,
  withoutAiOmissions,
  onFoundationToggleAll,
  pluginBuild,
  resultOutcome,
  send,
  setAiEnabled,
  setBrandTheme,
  setComponentFormat,
  setLicenseKey,
  setFoundationGenerating,
  setFoundationHost,
  takeTopUpNote,
  topUpProseForRebuild,
  updateFromSource,
  type BuildPresenter,
} from './actions';
import { generateGroupDescriptions, resolveComponentImage } from './ai';
import {
  activateLicense as activateLicenseKey,
  deactivateLicense,
  effectiveAuth,
  fetchQuota,
  isQuotaExhausted,
  licenseExternalUrl,
  publishAuth,
} from './proxy';
import { copyText, renderManualCopyModal } from './clipboard';
import {
  agentSetupMessage,
  invalidatePublishProposal,
  isBump,
  onBumpChoice,
  onDownloadSkillClick,
  onInitialVersionInput,
  onNoteInput,
  onPublishClick,
  onPublishInfo,
  onPublishOpen,
  onPublishRecheck,
  onPublishSources,
  onPublishSourcesError,
  onRotateClick,
  publishState,
  setPublishHost,
  setupCommand,
  type PublishQuotaSnapshot,
} from './publish';
import {
  historyState,
  onHistoryOpen,
  onHistoryToggle,
  setHistoryHost,
} from './history';

const refs: ShellRefs = mountShell('component');
wireShellTheme(refs);

const state = createState();
const selection: ComponentSelection = createComponentSelection(state.aiEnabled);
let screen: ComponentScreenState = { kind: 'empty', waiting: true };
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
/**
 * The Settings tab on show. On a fresh launch of the plugin Settings opens
 * on Frames; within a session it reopens on the last tab chosen.
 */
let settingsTab: SettingsTab = 'frames';
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
/** A saved key's Check again is running, so the button reads Checking…. */
let licenseRechecking = false;
let licenseInput = '';
let libraryEntries: LibraryEntry[] = [];
/**
 * Whether each selected component already has a doc, as main reports after a
 * selection (`selectionDoc`). Keyed by component so an answer that arrives
 * while a build defers the selection is still there when it applies. A known
 * doc turns the footer's Create docs into Replace docs; unknown stays Create.
 */
const componentHasDoc = new Map<string, boolean>();
const currentHasDoc = (): boolean => {
  const id = state.currentNode?.id;
  return id ? componentHasDoc.get(id) === true : false;
};
const libraryDrift = new Map<string, LibraryDriftState>();
const libraryBaseline = new Map<string, string>();
// docId → the EXTRACTOR_VERSION stamped on its doc link (undefined on blobs
// written before the field existed). Checked before comparing hashes, since a
// hash comparison against a doc built by an older extractor is meaningless.
const libraryExtractorVersion = new Map<string, string | undefined>();
/** Per doc: whether its baseline was hashed with hidden-by-default parts included. */
const libraryIncludeHidden = new Map<string, boolean>();
// docId → the live SpecHashProjection computed during this pass's drift check,
// kept for every component row (not only drifted ones) so a row that drifts
// on the next refresh needs no second round trip. A few kilobytes per row.
const libraryLiveProjection = new Map<string, SpecHashProjection>();
// docId → change result for the current refresh pass. Cleared with the other
// library maps; a new pass starts every expansion from `pending` again.
const libraryChanges = new Map<string, LibraryChangeResult>();
let libraryFilter: LibraryFilter = 'all';
/**
 * Which of the Library's two screens is showing.
 *
 * Library-local rather than a sixth PluginView: the rail is a closed set of
 * five workflow destinations and sidebar.ts holds an exhaustive
 * Record<PluginView, IconName>, so a 'publish' view would have to claim a rail
 * slot beside Component, Foundations, and Library. Publishing is not their
 * peer, it is something you do to the library you are looking at. Keeping
 * `view` at 'library' also keeps the rail correctly highlighted for free.
 */
let libraryPane: 'list' | 'publish' | 'history' = 'list';
let libraryExpandedDocId: string | null = null;
/**
 * The row the global search palette last opened, marked in the list until the
 * user refreshes, changes filter, or leaves the Library. Search now lists
 * documents rather than rail destinations, so activating a result has to land
 * the user on a specific row in a list of many, not just on the screen.
 */
let libraryRevealDocId: string | null = null;
let libraryMenuDocId: string | null = null;
let libraryMenuRestore: HTMLElement | null = null;
let libraryRefreshing = false;
let libraryRequested = false;
/**
 * Why the last `requestLibrary` failed, or null. Cleared by the next
 * `library` reply and by `refreshLibrary` starting a new attempt.
 */
let libraryError: string | null = null;
/**
 * Whether the scan behind `libraryEntries` stopped partway (a `library`
 * reply with `incomplete: true`). Cleared by the next complete `library`
 * reply.
 */
let libraryReadIncomplete = false;
let publishInfoRequested = false;
let componentProgressTimer: ReturnType<typeof setInterval> | null = null;
let foundationProgressTimer: ReturnType<typeof setInterval> | null = null;

type LibraryUpdateOperation = {
  kind: 'update';
  /** Each row with the intent decided at start; see libraryUpdateIntent. */
  queue: Array<{ docId: string; intent: DocSourceIntent }>;
  currentDocId: string | null;
  completed: number;
  total: number;
  batch: boolean;
  confirmedOverwrite: Set<string>;
  /** Sections left out across this run, deduplicated by id and reason, so the
   *  completion message says which and why the way Create's does. Collected
   *  per document as each one finishes, because `state.lastOmitted` only ever
   *  holds the newest. */
  omitted: OmittedSection[];
  /** Failed-generation notes from any stale-version rebuild in this run,
   *  deduplicated by text, the way `omitted` is. Collected per document for
   *  the same reason: `state.pendingAiNote` only ever holds the newest. */
  aiNotes: string[];
};
/**
 * Copy for AI. Unlike an update, this never writes anything, so it carries no
 * queue/batch bookkeeping — just the one row it is reading, and the prose it
 * fetched first (requestDocProse) before asking for the source
 * (requestDocSource). `prose` is undefined until that first reply lands.
 */
type LibraryCopyOperation = {
  kind: 'copy';
  currentDocId: string;
  prose?: ProseV2 | null;
};
let libraryOperation: LibraryUpdateOperation | LibraryCopyOperation | null = null;
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
    // setFoundationGenerating always passes foundationBuildMessages, so the
    // lines are used as given.
    const phases = messages;
    let index = 0;
    const current = foundationScreen.kind === 'generating'
      ? foundationScreen
      : { kind: 'generating' as const, done: 0, total: 0 };
    foundationScreen = { ...current, phase: phases[index] };
    if (view === 'foundations') paint();
    if (phases.length > 1) {
      foundationProgressTimer = setInterval(() => {
        if (foundationScreen.kind !== 'generating') return;
        // Hold on the last line: a slow AI build must not cycle back to
        // "Reading this file’s variables and styles".
        const next = nextPhaseIndex(index, phases.length);
        if (next === null) {
          stopFoundationProgress();
          return;
        }
        index = next;
        foundationScreen = { ...foundationScreen, phase: phases[index] };
        if (view === 'foundations') paint();
      }, 2600);
    }
  },
  stopProgress: stopFoundationProgress,
});

setPublishHost({
  repaint: () => {
    if (view === 'library') paint();
  },
  send,
  // The publish response is the freshest statement of the updates allowance,
  // and the only one until the next quota fetch. It says nothing about AI
  // writing, so it never stands in for the quota the header reads: when no
  // quota has arrived it is kept on its own and the real numbers are fetched.
  onPublishQuota: (snapshot) => {
    publishSnapshot = snapshot;
    if (state.quota) {
      state.quota = { ...state.quota, publish: snapshot };
    } else {
      void refreshQuota(false);
    }
    if (view === 'library') paint();
  },
  // Publish and rotate successes are toasts; the screen itself shows only
  // errors, which need to stay on view.
  notify: (message) => nativeNotify(message),
});

setHistoryHost({
  repaint: () => {
    if (view === 'library' && libraryPane === 'history') paint();
  },
});

/**
 * Call after anything that could change what a publish would contain: a doc
 * created, updated, or rebuilt (including a render that fails after already
 * placing or replacing the doc on canvas); a Foundation build (including one
 * that fails partway, after some units already landed); a doc detached or
 * removed; a Library update batch finishing. Clears the stale proposal (see
 * `invalidatePublishProposal`'s own doc for the full invalidation contract,
 * including the in-flight generation guard) and, if the reader is looking at
 * the Publish screen right now, replaces the stale text with a fresh dry run
 * immediately instead of leaving it there until they happen to reopen
 * Publish (mirrors the re-entry `publishInfo` already does below). The one
 * exception is a screen showing an unread upload error (`status: 'error'`):
 * an unrelated change must not auto-start a dry run there, since that would
 * silently wipe the error message the reader has not acted on yet. The
 * proposal is still cleared either way, so a stale "Next version" cannot
 * survive under that error, but the fresh check itself waits for the
 * reader's own next action (Check again, or a publish).
 */
function invalidatePublishAfterChange(): void {
  invalidatePublishProposal();
  if (publishState().status === 'error') return;
  if (view === 'library' && libraryPane === 'publish') onPublishOpen();
}

/**
 * Whether the first quota request has settled. `state.quota` is null both
 * before we ask and when the answer never arrived, and the header has to tell
 * those apart: one is a spinner, the other is "plan status unavailable".
 */
let quotaFetched = false;

/**
 * The updates allowance the last publish response stated. Read by the publish
 * screen when no quota fetch has landed (or the last one failed); a fetched
 * quota's own `publish` field wins once it exists.
 */
let publishSnapshot: PublishQuotaSnapshot | null = null;

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
  action: 'create',
): void {
  stopComponentProgress();
  // createDocFrame always passes generatingMessages, so the lines are used as
  // given.
  const phases = messages;
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
      // Hold on the last line: a slow AI build must not cycle back to
      // "Looking at the component" after "Placing docs on the canvas".
      const next = nextPhaseIndex(index, phases.length);
      if (next === null) {
        stopComponentProgress();
        return;
      }
      index = next;
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
      renderComponentScreen(refs, screen, selection, facts, currentHasDoc());
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
        pluginVersion: pluginBuild(),
        tab: settingsTab,
        componentFormat: state.componentFormat,
        ...(settingsColorError ? { colorError: settingsColorError } : {}),
        ...(settingsFontWarning ? { fontWarning: settingsFontWarning } : {}),
        ...(settingsLogoError ? { logoError: settingsLogoError } : {}),
        fontMenuField: fontMenu?.field ?? null,
      });
      renderFontMenu();
      return;
    case 'library':
      {
        if (libraryPane === 'history') {
          renderHistoryScreen(refs, historyState());
          return;
        }
        if (libraryPane === 'publish') {
          renderPublishScreen(refs, publishState(), publishAllowance(state.quota?.publish ?? publishSnapshot), state.componentFormat);
          return;
        }
        renderLibraryScreen(refs, libraryPresentation());
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
        // A limit only the proxy can state: before its answer, offline, or
        // with no limit in the answer, there is no count to show.
        quotaKnown: quota !== null && quota.limit !== null,
        rechecking: licenseRechecking,
      });
      return;
    }
  }
}

/** The Library list's presentation, shared by the full paint and the per-row patch. */
function libraryPresentation(): LibraryScreenPresentation {
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
          ? `Updating doc ${Math.min(update.completed + 1, update.total)} of ${update.total}`
          : 'Updating this doc',
        current: update.completed,
        total: update.total,
      }
    : libraryRefreshing || pendingChecks
        ? {
            label: libraryEntries.length === 0 ? 'Finding docs in this file' : 'Checking for source changes',
            ...(checkTotal > 0 ? { current: checkDone, total: checkTotal } : {}),
          }
        : null;
  return {
    ...model,
    menuDocId: libraryMenuDocId,
    revealedDocId: libraryRevealDocId,
    error: libraryError,
    readIncomplete: libraryReadIncomplete,
    loading: (!libraryRequested || libraryRefreshing) && libraryEntries.length === 0,
    refreshing: libraryRefreshing || pendingChecks,
    checksIncomplete: failedChecks,
    updatingAll: Boolean(update?.batch),
    updatingDocId: update?.currentDocId ?? null,
    progress,
  };
}

/**
 * Repaint after one source check landed. Only the Library list cares: a
 * reply that arrived while the Publish or History pane was up used to
 * repaint that pane and drop focus from its inputs, for a change it does
 * not show.
 */
function paintLibraryDrift(): void {
  if (view !== 'library' || libraryPane !== 'list') return;
  if (!patchLibraryDrift(refs, libraryPresentation())) paint();
}

function navigateToView(
  next: PluginView,
  options: { refreshLibrary?: boolean } = {},
): void {
  view = next;
  closeFontMenu();
  if (view !== 'library') libraryRevealDocId = null;
  setActiveView(refs, view);
  if (view === 'foundations') requestFoundations();
  // Arriving at the Library always lands on the list. Leaving the publish
  // screen by the rail and coming back to a stale publish screen would hide
  // the documents behind a screen the user did not ask for again.
  if (view === 'library') libraryPane = 'list';
  // Never while a Library operation runs: the reply to refreshLibrary()
  // clears the drift maps a queued update was started from (and a Copy reads
  // the row it started on). A component or Foundation build takes the same
  // operation lock but reads none of that Library state, so it is no reason
  // to skip the read: skipping it on a first visit left the Library on its
  // loading skeleton with no request in flight to ever replace it.
  if (view === 'library' && options.refreshLibrary !== false && libraryOperation === null) refreshLibrary();
  if (view === 'library' && !publishInfoRequested) {
    publishInfoRequested = true;
    send({ type: 'requestPublishInfo' });
  }
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
  // The publish screen paints its updates line from the plan, and the first
  // quota answer usually lands after the panel has drawn a screen.
  if (view === 'license' || (view === 'library' && libraryPane === 'publish')) paint();
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

/**
 * Check again, for a saved key whose last check could not finish. It runs the
 * same check the plugin runs on launch. It used to switch the screen to the
 * inactive state instead, which told the user the key was not connected when
 * nothing had said so.
 */
async function recheckLicense(): Promise<void> {
  if (licenseRechecking) return;
  licenseRechecking = true;
  paint();
  try {
    await refreshQuota();
  } finally {
    licenseRechecking = false;
    // Back on the button when the check still could not finish; when it did,
    // the button is gone and there is nothing to focus.
    paintAndFocus('[data-license-retry]');
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Reports a build through the screen's own status row and footer button. */
function presenter(action: 'create'): BuildPresenter {
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

/**
 * Ask for the foundation dump when Library opens, if nothing has fetched it
 * yet, so a foundation row's Copy can build its brief without a round trip.
 *
 * Copy needs the dump, and the two things that normally supply it may both be
 * absent here: the Foundations tab may never have been opened, and the
 * 'selection' message only carries a dump when a COMPONENT is selected, so
 * opening the plugin with nothing selected leaves the UI with no spec at all.
 *
 * Reuses foundationRequested rather than adding a second flag. On success the
 * 'foundation' reply sets the Foundations screen to 'ready' as well, so
 * skipping its own request later is correct; on failure 'foundationError'
 * clears the flag, so navigating there re-requests and resets to loading.
 */
function prefetchFoundationsForCopy(): void {
  if (foundationRequested || currentFoundationSpec()) return;
  foundationRequested = true;
  send({ type: 'requestFoundation' });
}

async function buildFoundations(): Promise<void> {
  const spec = currentFoundationSpec();
  const foundationSelection = currentFoundationSelection();
  if (!spec || !beginOperation(operation)) return;

  foundationAiNote = '';
  setFoundationGenerating(true);
  let groupDescriptions: Record<string, string> | undefined;
  let collectionOverviews: Record<string, string> | undefined;
  const briefs = currentGroupBriefs();

  // One brief per selected collection (Task 13), so a collection of only
  // spacing tokens still gets its own overview even though it has no colour
  // groups to describe.
  if (briefs && foundationAiRequested(state, briefs)) {
    try {
      const draft = await generateGroupDescriptions(
        briefs,
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
      groupDescriptions = draft.descriptions;
      collectionOverviews = Object.keys(draft.overviews).length > 0 ? draft.overviews : undefined;
      if (Object.keys(groupDescriptions).length === 0 && !collectionOverviews) {
        foundationAiNote = 'AI writing returned nothing usable, so the AI descriptions were left out.';
      }
    } catch (error) {
      // The same notes a component build uses, worded for descriptions: the
      // quota with its limit and reset date, a lapsed license (which also
      // drops this session to the free plan), or the request's own failure.
      foundationAiNote = aiFailureNote(state, error, 'foundation');
    }
  }

  send({
    type: 'renderFoundation',
    selection: foundationSelection,
    config: {
      includeDescriptions: true,
      aiNotes: Boolean(groupDescriptions && Object.keys(groupDescriptions).length > 0),
      // No contrast toggle in this tab yet, so ask for the output an existing
      // doc already renders. main.ts threads this through to
      // buildFoundationFrame, so flipping it to true is all that is needed to
      // render the matrix; what is missing is the control that lets a user
      // choose. No task in the v2 plan added one, so this is the last mile of
      // the contrast feature and it is a product decision, not an oversight to
      // patch silently: turning it on unasked changes every foundation doc's
      // output for every user.
      includeContrast: false,
    },
    ...(groupDescriptions && Object.keys(groupDescriptions).length > 0
      ? { groupDescriptions }
      : {}),
    ...(collectionOverviews ? { collectionOverviews } : {}),
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
    changes: libraryChanges,
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
  libraryRevealDocId = null;
  libraryError = null;
  libraryLiveProjection.clear();
  libraryChanges.clear();
  if (view === 'library') paint();
  send({ type: 'requestLibrary' });
}

function startLibraryDriftChecks(): void {
  libraryDrift.clear();
  libraryBaseline.clear();
  libraryExtractorVersion.clear();
  libraryLiveProjection.clear();
  libraryChanges.clear();
  libraryIncludeHidden.clear();
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
    libraryExtractorVersion.set(entry.docId, entry.extractorVersion);
    libraryIncludeHidden.set(entry.docId, entry.includeHidden === true);
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

/**
 * Expand or collapse a row's change panel. Opening a row the pass has not
 * compared yet marks it pending and asks main for the stored baseline; the
 * `docBaseline` reply resolves it. Collapsing keeps the cached result.
 */
function toggleLibraryReview(docId: string): void {
  const opening = libraryExpandedDocId !== docId;
  libraryExpandedDocId = opening ? docId : null;
  if (opening && !libraryChanges.has(docId)) {
    libraryChanges.set(docId, { state: 'pending' });
    send({ type: 'requestDocBaseline', docId });
  }
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

/**
 * Copy for AI from the Selected component screen: the same brief a Library
 * row copies, built from the current selection. No document is read, so no
 * saved guidelines ride along and the caveat does not mention them.
 */
function copyCurrentComponent(): void {
  const node = state.currentNode;
  if (!node) return;
  void copyBriefFromSource(
    state,
    { node, fileKey: state.currentFileKey, ...(state.currentFileName ? { fileName: state.currentFileName } : {}) },
    null,
    copyPresenter(),
    { guidelinesNote: false },
  );
}

/**
 * Reports a Copy through Figma's native notification surface, same as any
 * other Library action. Unlike libraryPresenter, error() notifies directly
 * rather than routing through a caller-owned callback: Copy has no
 * "dispatched vs. not" distinction to resolve afterward, so there is nothing
 * for a callback to decide.
 */
function copyPresenter(): BuildPresenter {
  return {
    clear: () => {},
    error: (message) => nativeNotify(message, { error: true, timeout: 5000 }),
    info: (message) => nativeNotify(message),
    setBusy: () => {},
    startProgress: () => {},
    stopProgress: () => {},
  };
}

/**
 * Copy one Foundations row: a collection with all of its modes, the text
 * styles, or the effect styles. Reuses the Library row's scoped copy, which
 * widens a collection to every mode and its local dependency closure. modeIds
 * is a frame-only limit the copy ignores, so it is passed empty.
 */
function copyFoundationRow(id: string, kind: 'collection' | 'textStyles' | 'effectStyles'): void {
  if (kind === 'textStyles') {
    void copyFoundationBriefForScope({ target: 'textStyles' }, copyPresenter());
    return;
  }
  if (kind === 'effectStyles') {
    void copyFoundationBriefForScope({ target: 'effectStyles' }, copyPresenter());
    return;
  }
  const collection = currentFoundationSpec()?.collections.find((c) => c.id === id);
  if (!collection) {
    nativeNotify('That collection is no longer in this file. Nothing was copied.', { error: true, timeout: 5000 });
    return;
  }
  void copyFoundationBriefForScope(
    { target: 'collection', collectionId: collection.id, collectionName: collection.name, modeIds: [] },
    copyPresenter(),
  );
}

/**
 * End the Library's update or copy and say how it went.
 *
 * `error` is why the run ended early, if it did. It shows as an error unless
 * `canceled` says the user chose to stop, which is not a failure.
 */
function finishLibraryOperation(error = '', canceled = false): void {
  const active = libraryOperation;
  if (!active) return;
  let message = '';
  let omitted: OmittedSection[] = [];
  let aiNotes: string[] = [];
  if (active.kind === 'update') {
    message = error
      ? active.completed > 0
        ? `Updated ${active.completed} of ${active.total} docs. ${error}`
        : error
      : active.batch
        ? `Updated ${active.completed} ${active.completed === 1 ? 'doc' : 'docs'}.`
        : 'Doc updated.';
    // Same sentences the Create path appends, so a section the Library left
    // out is reported rather than silently missing from the frame. An AI note
    // explains the empty AI sections itself, so they are not listed again.
    if (!error && active.omitted.length) {
      omitted = state.quotaExhausted || active.aiNotes.length > 0
        ? withoutAiOmissions(active.omitted)
        : active.omitted;
      message = omissionsMessage(message, omitted);
    }
    // A failed rebuild top-up, reported the way Create reports its own
    // pendingAiNote: appended after the outcome (and any omissions).
    if (!error && active.aiNotes.length) {
      aiNotes = active.aiNotes;
      message = `${message} ${aiNotes.join(' ')}`;
    }
  } else if (error) {
    message = error;
  }
  state.lastOmitted = [];
  // Mirrors lastOmitted: whatever a rebuild's top-up left here belongs to
  // this operation and no other, so it must not survive to be misread by a
  // later, unrelated Library action. The normal path already drains this
  // slot per document (see the docSource handler below); this is the
  // backstop for an operation that aborts before that drain runs.
  state.pendingAiNote = '';
  if (message) {
    nativeNotify(
      message,
      error
        ? canceled ? { timeout: 5000 } : { error: true, timeout: 5000 }
        : (omitted.length || aiNotes.length) ? { timeout: 5500 } : {},
    );
  }
  // At least one doc actually changed (even a batch that then failed or was
  // canceled partway reports "Updated X of Y docs" for the X that landed), so
  // a proposal computed before this run started no longer describes the file.
  if (active.kind === 'update' && active.completed > 0) invalidatePublishAfterChange();
  libraryOperation = null;
  completeOperation();
  if (view === 'library') paint();
  refreshLibrary();
}

function dispatchNextLibraryUpdate(): void {
  const active = libraryOperation;
  if (!active || active.kind !== 'update') return;
  const next = active.queue.shift();
  if (!next) {
    finishLibraryOperation();
    return;
  }
  const { docId, intent } = next;
  const entry = libraryEntry(docId);
  if (!entry || !entry.sourceExists) {
    finishLibraryOperation('A doc’s source is no longer in this file, so the remaining updates stopped. Try again to update the rest.');
    return;
  }
  active.currentDocId = docId;
  if (entry.kind === 'foundation') {
    send({ type: 'updateFoundationDoc', docId });
  } else {
    // The intent was fixed when the run started: reading libraryDrift here
    // would lose a rebuild after a mid-run refresh cleared it.
    send({ type: 'requestDocSource', docId, intent });
  }
  if (view === 'library') paint();
}

/** The one-doc hand-edit confirm's title, shared by both places that ask. */
const HAND_EDIT_TITLE = 'Replace your edits to generated content?';

/**
 * The one-doc hand-edit confirm's body, shared by the row Update and the
 * docSource reply's own check so the two cannot drift. What survives an
 * Update is the writing sections, and only a component doc has them: a
 * foundation doc tags none, so there an Update replaces every edit.
 */
function handEditBody(foundation: boolean): string {
  const replaced = 'You edited generated content in this doc by hand. Updating replaces those edits.';
  return foundation ? replaced : `${replaced} Your text in the writing sections is kept.`;
}

/**
 * Update the given docs, one at a time.
 *
 * `batchLabel` is the label of the button that started a batch, so the
 * hand-edit confirm repeats the action the user chose: "Update all docs", or
 * "Rebuild docs" from the rebuild banner.
 */
async function startLibraryUpdates(
  docIds: string[],
  batch: boolean,
  batchLabel = 'Update all docs',
): Promise<void> {
  if (docIds.length === 0 || operation.active) return;
  const edited = docIds.filter((docId) => libraryEntry(docId)?.selfEdited);
  if (edited.length > 0) {
    const ok = await confirmDialog(batch
      ? {
          title: `Replace hand edits in ${edited.length} ${edited.length === 1 ? 'doc' : 'docs'}?`,
          body: `${edited.length} ${edited.length === 1 ? 'doc has' : 'docs have'} hand edits to generated content. Updating replaces those edits. In component docs, text in the writing sections is kept.`,
          confirmLabel: batchLabel,
        }
      : {
          title: HAND_EDIT_TITLE,
          body: handEditBody(libraryEntry(edited[0])?.kind === 'foundation'),
          confirmLabel: 'Update',
        });
    if (!ok) return;
  }
  if (!beginOperation(operation)) return;
  // Start from nothing: a Create earlier in this session (or an aborted
  // Library run) may have left a record behind, and it says nothing about
  // these documents.
  state.lastOmitted = [];
  state.pendingAiNote = '';
  libraryOperation = {
    kind: 'update',
    queue: docIds.map((docId) => ({ docId, intent: libraryUpdateIntent(libraryDrift.get(docId)) })),
    currentDocId: null,
    completed: 0,
    total: docIds.length,
    batch,
    confirmedOverwrite: new Set(edited),
    omitted: [],
    aiNotes: [],
  };
  dispatchNextLibraryUpdate();
}

function completeCurrentLibraryUpdate(): void {
  const active = libraryOperation;
  if (!active || active.kind !== 'update' || !active.currentDocId) return;
  active.completed += 1;
  active.currentDocId = null;
  // Fold in what this document left out and clear the slot, so the next
  // document in the queue (a foundation, which never sets it) cannot inherit
  // it. Deduplicated: a batch that leaves Keyboard out of every document says
  // so once.
  for (const o of state.lastOmitted) {
    if (!active.omitted.some((prev) => prev.id === o.id && prev.reason === o.reason)) active.omitted.push(o);
  }
  state.lastOmitted = [];
  // A stale-version rebuild's aiNotes entry, if any, was already taken from
  // state.pendingAiNote (and the slot cleared) at the docSource handler's
  // topUpProseForRebuild call site below, for exactly this document — not
  // read here, where any document's docFrameDone (rebuild or not) would
  // otherwise risk folding in a note left over from a different one.
  dispatchNextLibraryUpdate();
}

/**
 * Copy for AI.
 *
 * Component rows need a round trip: the brief needs both the stored prose and
 * the doc's source, so this asks for prose first (the doc's guidelines: the
 * stored blob merged with the canvas) and only sends requestDocSource once
 * the docProse reply lands and is stashed on the operation. The docSource
 * handler reads that prose back off, builds the brief, and clears the
 * operation on every exit.
 *
 * Foundation rows need none of that. The whole file's variables are already in
 * memory (the Library view asks for them on entry), and the doc's scope rode in
 * on its LibraryEntry, so the copy is synchronous. It deliberately does NOT
 * take the operation lock: there is nothing to wait for, and holding the lock
 * would block an unrelated Update behind an act that has already finished.
 */
function startLibraryCopy(docId: string): void {
  const entry = libraryEntry(docId);
  if (!entry) return;

  if (entry.kind === 'foundation') {
    // Withheld by canCopy, so this is a guard against a stale menu rather than
    // a path a user can reach by clicking.
    if (!entry.foundationScope) return;
    // Re-arm the fetch before delegating. A failed prefetch clears
    // foundationRequested but leaves the spec null, and nothing else on this
    // screen ever re-sends requestFoundation — without this, a failed read
    // makes copyFoundationBriefForScope's "try again in a moment" error
    // repeat forever. prefetchFoundationsForCopy's own guard makes this free
    // on the happy path and during an in-flight race, so it only does work
    // when there is actually nothing to retry with.
    if (!currentFoundationSpec()) prefetchFoundationsForCopy();
    void copyFoundationBriefForScope(entry.foundationScope, copyPresenter());
    return;
  }

  if (entry.kind !== 'component' || !entry.sourceExists || operation.active) return;
  if (!beginOperation(operation)) return;
  libraryOperation = { kind: 'copy', currentDocId: docId };
  paint();
  // Prose first: the brief needs it, and it is a cheap pluginData read.
  send({ type: 'requestDocProse', docId });
}

// ---------------------------------------------------------------------------
// Global Search
// ---------------------------------------------------------------------------

function searchDocuments(): SearchDocument[] {
  return libraryEntries.map((entry) => ({
    docId: entry.docId,
    kind: entry.kind,
    label: entry.label,
    sourceLabel: entry.sourceLabel,
    generatedAt: entry.generatedAt,
  }));
}

function currentSearchModel(): SearchModel {
  return buildSearchModel(searchDocuments(), searchQuery, searchActiveIndex);
}

function ensureLibraryLoaded(): void {
  if (libraryRefreshing) return;
  // The same guard navigateToView uses: a read landing mid-run would clear
  // the drift maps a running Library update was started from.
  if (libraryOperation !== null) return;
  // A prior request that came back with libraryError left libraryRequested
  // true without ever establishing anything, so it is not "already loaded"
  // in the sense this guard means: retry rather than leaving the palette
  // stuck on a read that failed before this screen ever opened.
  if (libraryRequested && libraryError === null) return;
  libraryRequested = true;
  libraryRefreshing = true;
  send({ type: 'requestLibrary' });
}

/**
 * Renders, or updates, the palette.
 *
 * Mounting is a one-shot insert; every render after that patches the mounted
 * DOM in place. The panel animates in, so replacing the layer on each
 * keystroke restarted that animation and the palette blinked once per typed
 * letter. Patching also means the live input element is never rebuilt, which
 * is what the caret and IME composition depend on.
 */
function renderGlobalSearch(focusInput = false): void {
  const existing = refs.root.querySelector<HTMLElement>('[data-global-search-dialog]');
  if (!searchOpen) {
    existing?.remove();
    return;
  }
  const model = currentSearchModel();
  const unreliable = libraryError !== null || libraryReadIncomplete;
  const options = {
    libraryLoading: libraryRefreshing && libraryEntries.length === 0,
    // Only when the read produced nothing at all: a file with docs on
    // screen is not "unreadable", however unreliable the read behind them.
    libraryUnreadable: unreliable && libraryEntries.length === 0,
    libraryReadUnreliable: unreliable,
  };
  if (!existing) {
    refs.root.insertAdjacentHTML('beforeend', globalSearchMarkup(model, options));
  } else {
    patchGlobalSearch(refs.root, model, options);
  }
  const input = refs.root.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (input && focusInput && document.activeElement !== input) {
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }
}

// ---------------------------------------------------------------------------
// Font picker
//
// The list is an overlay in the shell root, rendered and positioned here while
// screens/settings.ts owns its markup. It follows the same shape as the global
// search palette below: listeners live here rather than inside a self-contained
// component, because every paint replaces the screen's DOM and anything bound
// to its own elements would not survive that. fontPicker.ts keeps only
// computeMenuPlacement, which is pure.
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
  syncFontFieldExpanded(refs.root, fontMenu.field, true);
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
}

function closeFontMenu(restoreFocus = false): void {
  if (!fontMenu) return;
  const field = fontMenu.field;
  fontMenu = null;
  refs.root.querySelector('[data-font-menu]')?.remove();
  syncFontFieldExpanded(refs.root, field, false);
  const input = fontInput(field);
  if (input) {
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
    ? 'Figma doesn’t list Regular, Medium, and Bold styles for this font, so docs will use Inter. Pick a font from the list instead.'
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

/**
 * Moves the active pointer. The model clamps the index to the list it would
 * render, so the clamped value is read from it rather than recomputed here.
 * Hover and focus call this for every row the pointer crosses, so the same
 * index returns at once and a new one toggles two attributes in place; the
 * input keeps its focus and caret either way.
 */
function setSearchActiveIndex(index: number): void {
  const next = buildSearchModel(searchDocuments(), searchQuery, index).activeIndex;
  if (next === searchActiveIndex) return;
  searchActiveIndex = next;
  setSearchActive(refs.root, next);
  refs.root.querySelector<HTMLElement>(`#sl-global-search-result-${next}`)?.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens the picked document in the Library.
 *
 * The Library is where a document can be read, updated, copied, and opened on
 * canvas, so search hands off to the row rather than jumping the canvas
 * straight to the frame: the row's own Open action still does that, and it is
 * one click away once the user is here. The filter is reset because a result
 * the palette matched must not land on a filter that hides it.
 */
function activateSearchResult(result: SearchResult | undefined): void {
  if (!result) return;
  closeGlobalSearch(false);
  libraryFilter = 'all';
  libraryExpandedDocId = null;
  libraryRevealDocId = result.docId;
  navigateToView('library', { refreshLibrary: false });
  // After the paint navigateToView just did: focus belongs on the row now,
  // which is why closeGlobalSearch above was told not to restore it to the
  // header Search button.
  requestAnimationFrame(() => {
    if (view === 'library' && libraryPane === 'list') {
      revealLibraryRow(refs, result.docId);
    }
  });
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

/**
 * Cross between the Library's list and its publish screen.
 *
 * Not paintAndFocus: that restores the scrollTop it captured, which belongs to
 * the pane being left, so the screen being opened would arrive already
 * scrolled by an unrelated amount. Any open row menu is dropped too, since it
 * is positioned against a list that is about to stop being rendered.
 */
function setLibraryPane(next: 'list' | 'publish' | 'history', focusSelector: string): void {
  libraryPane = next;
  libraryMenuDocId = null;
  libraryMenuRestore = null;
  paint();
  document.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
}

function paintAndFocus(selector: string): void {
  const scrollTop = refs.scroll.scrollTop;
  paint();
  refs.scroll.scrollTop = scrollTop;
  document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
}

/**
 * Show one Settings tab and leave focus on it, where the click or the arrow
 * key already was. The panel starts at its top. Leaving Frames closes an open
 * font list, whose field is no longer drawn.
 */
function selectSettingsTab(next: SettingsTab): void {
  if (next !== 'frames') closeFontMenu();
  settingsTab = next;
  paint();
  refs.scroll.scrollTop = 0;
  document.querySelector<HTMLElement>(`[data-settings-tab="${next}"]`)?.focus({ preventScroll: true });
}

/** Take a component format from the Export tab, store it, and keep focus on
 *  the choice just made. Choosing the current one again changes nothing. */
function chooseComponentFormat(value: ComponentFormat): void {
  if (value !== state.componentFormat) setComponentFormat(state, value);
  paintAndFocus(`[data-component-format="${value}"]`);
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
    const bulkState = variantBulkState(
      selection.variantIds,
      inputs.flatMap((input) => input.dataset.variant ? [input.dataset.variant] : []),
    );
    bulk.checked = bulkState.checked;
    bulk.indeterminate = bulkState.mixed;
    bulk.dataset.mixed = String(bulkState.mixed);
    bulk.setAttribute('aria-checked', bulkState.mixed ? 'mixed' : String(bulkState.checked));
    const label = bulkState.checked ? 'Clear all variants' : 'Select all variants';
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
      button.title = MEASURE_LAST_VIEW_TITLE;
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
  const railView = rail?.dataset.view;
  if (railView && isPluginView(railView)) {
    // Re-selecting the Library re-runs no source checks: the list is what it
    // was, and Refresh library sits beside it for when a re-check is wanted.
    navigateToView(railView, { refreshLibrary: railView !== view });
    return;
  }

  // The empty states' shortcuts, on any screen. Their own attribute, not
  // data-view: setRailBadge finds the rail button by [data-view], and a second
  // match in the screen would make that lookup depend on DOM order.
  const emptyNav = target.closest<HTMLButtonElement>('[data-empty-nav]');
  const emptyView = emptyNav?.dataset.emptyNav;
  if (emptyView && isPluginView(emptyView)) {
    navigateToView(emptyView);
    // The button just clicked left with the screen it sat on, so focus would
    // fall to the body. The destination's rail item names where the reader
    // landed and survives every paint.
    refs.sidebar.querySelector<HTMLButtonElement>(`[data-view="${emptyView}"]`)?.focus({ preventScroll: true });
    return;
  }

  if (target.closest(`#${refs.allowanceButton.id}`)) {
    navigateToView('license');
    return;
  }

  const libraryFilterButton = target.closest<HTMLButtonElement>('[data-library-filter]');
  const filterValue = libraryFilterButton?.dataset.libraryFilter;
  if (filterValue && isLibraryFilter(filterValue)) {
    libraryFilter = filterValue;
    libraryExpandedDocId = null;
    libraryRevealDocId = null;
    libraryMenuDocId = null;
    paintAndFocus(`[data-library-filter="${libraryFilter}"]`);
    return;
  }

  if (target.closest('[data-library-refresh]')) {
    if (!operation.active) refreshLibrary();
    return;
  }

  const batchButton = target.closest('[data-library-update-all], [data-library-rebuild-all]');
  if (batchButton) {
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
    // "Update all docs" takes both kinds of drift, the same set the Updates
    // count and the button's enabled state already cover; it used to take
    // only source updates, so a Library whose only drift was a stale version
    // offered an enabled button that did nothing. The rebuild banner takes
    // only the stale rows. dispatchNextLibraryUpdate picks each row's intent.
    const rebuildOnly = batchButton.matches('[data-library-rebuild-all]');
    void startLibraryUpdates(
      model.allRows
        .filter((row) => row.status === 'rebuildNeeded'
          || (!rebuildOnly && row.status === 'updateAvailable'))
        .map((row) => row.docId),
      true,
      rebuildOnly ? 'Rebuild docs' : 'Update all docs',
    );
    return;
  }

  if (target.closest('[data-publish-open]')) {
    setLibraryPane('publish', '[data-publish-back]');
    onPublishOpen();
    return;
  }

  if (target.closest('[data-publish-back]')) {
    setLibraryPane('list', '[data-publish-open]');
    return;
  }

  if (target.closest('[data-publish-history]')) {
    setLibraryPane('history', '[data-history-back]');
    const { libraryId, pullKey } = publishState();
    void onHistoryOpen(libraryId, pullKey);
    return;
  }

  if (target.closest('[data-publish-recheck]')) {
    onPublishRecheck();
    // The button stays on screen while the check runs, marked aria-disabled
    // rather than disabled so it can still hold focus, but paint() still
    // replaces it with a fresh element, so focus needs restoring by selector
    // rather than being left where it was.
    paintAndFocus('[data-publish-recheck]');
    return;
  }

  if (target.closest('[data-history-back]')) {
    setLibraryPane('publish', '[data-publish-history]');
    return;
  }

  if (target.closest('[data-history-retry]')) {
    const { libraryId, pullKey } = publishState();
    void onHistoryOpen(libraryId, pullKey);
    return;
  }

  const historyDisclosure = target.closest<HTMLButtonElement>('[data-history-disclosure]');
  if (historyDisclosure?.dataset.historyDisclosure) {
    onHistoryToggle(historyDisclosure.dataset.historyDisclosure);
    return;
  }

  if (target.closest('[data-publish]')) {
    onPublishClick(
      publishAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId),
    );
    return;
  }

  if (target.closest('[data-publish-download]')) {
    onDownloadSkillClick(state.componentFormat);
    return;
  }

  // The download block's "Change this in Settings". The format is set there,
  // so this goes to that tab rather than drawing a second control here.
  const openSettings = target.closest<HTMLButtonElement>('[data-open-settings]');
  if (openSettings) {
    const tab = openSettings.dataset.openSettings ?? '';
    if (isSettingsTab(tab)) settingsTab = tab;
    navigateToView('settings');
    document.querySelector<HTMLElement>(`[data-settings-tab="${settingsTab}"]`)?.focus({ preventScroll: true });
    return;
  }

  if (target.closest('[data-publish-copy-command]')) {
    const { libraryId, pullKey } = publishState();
    if (libraryId && pullKey) {
      const command = setupCommand(libraryId, pullKey, state.componentFormat);
      void copyText(command).then((tier) => {
        if (tier === 'manual') renderManualCopyModal(command);
        else nativeNotify('Copied.');
      });
    }
    return;
  }

  if (target.closest('[data-publish-copy-agent]')) {
    const { libraryId, pullKey } = publishState();
    if (libraryId && pullKey) {
      const message = agentSetupMessage(libraryId, pullKey, state.componentFormat);
      void copyText(message).then((tier) => {
        if (tier === 'manual') renderManualCopyModal(message);
        else nativeNotify('Copied.');
      });
    }
    return;
  }

  if (target.closest('[data-publish-rotate]')) {
    const rotate = (): void => {
      void onRotateClick(
        publishAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId),
      );
    };
    // With the key on this device the screen shows its setup commands and
    // never states what rotating costs, so the confirm does. Without it, the
    // screen's own note already says so beside the button.
    if (!publishState().pullKey) {
      rotate();
      return;
    }
    void confirmDialog({
      title: 'Rotate the pull key?',
      body: 'The current pull key stops working for everyone within about a minute, '
        + 'and it can’t be restored. Developers need the new setup command to keep pulling.',
      confirmLabel: 'Rotate',
      cancelLabel: 'Cancel',
      tone: 'danger',
    }).then((ok) => {
      if (ok) rotate();
    });
    return;
  }

  const bumpButton = target.closest<HTMLButtonElement>('[data-publish-bump]');
  const bumpValue = bumpButton?.dataset.publishBump;
  if (bumpValue && isBump(bumpValue)) {
    onBumpChoice(bumpValue);
    return;
  }

  const libraryDisclosure = target.closest<HTMLButtonElement>('[data-library-disclosure]');
  if (libraryDisclosure?.dataset.libraryDisclosure) {
    const docId = libraryDisclosure.dataset.libraryDisclosure;
    toggleLibraryReview(docId);
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
        toggleLibraryReview(docId);
        paint();
        return;
      case 'update':
        void startLibraryUpdates([docId], false);
        return;
      case 'open-frame':
        send({ type: 'focusNode', nodeId: docId });
        return;
      case 'open-source':
        if (entry?.sourceNodeId) {
          send({ type: 'focusNode', nodeId: entry.sourceNodeId });
        }
        return;
      case 'copy':
        startLibraryCopy(docId);
        return;
      case 'detach':
        if (operation.active) return;
        void confirmDialog({
          title: 'Detach this doc?',
          body: 'It stays on the canvas but leaves the Library. Spec Layer stops tracking its source and can’t update it again.',
          confirmLabel: 'Detach',
        }).then((ok) => {
          if (ok && !operation.active) send({ type: 'detachDoc', docId });
        });
        return;
      case 'remove':
        if (operation.active) return;
        void confirmDialog({
          title: 'Delete this doc?',
          body: 'This deletes the doc’s Section and everything in it, and removes the doc from the Library.',
          confirmLabel: 'Delete',
          tone: 'danger',
        }).then((ok) => {
          if (ok && !operation.active) send({ type: 'removeDoc', docId });
        });
        return;
      default:
        return;
    }
  }

  const licenseOpen = target.closest<HTMLButtonElement>('[data-license-open]');
  if (licenseOpen?.dataset.licenseOpen) {
    const url = licenseExternalUrl(licenseOpen.dataset.licenseOpen);
    if (url) send({ type: 'openBrowser', url });
    return;
  }

  if (target.closest('[data-license-remove]')) {
    void removeCurrentLicense();
    return;
  }

  if (target.closest('[data-license-retry]')) {
    void recheckLicense();
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

  const settingsTabButton = target.closest<HTMLButtonElement>('[data-settings-tab]');
  const settingsTabId = settingsTabButton?.dataset.settingsTab;
  if (settingsTabId && isSettingsTab(settingsTabId)) {
    selectSettingsTab(settingsTabId);
    return;
  }

  const formatChoice = target.closest<HTMLButtonElement>('[data-component-format]');
  const formatValue = formatChoice?.dataset.componentFormat;
  if (formatValue && isComponentFormat(formatValue)) {
    chooseComponentFormat(formatValue);
    return;
  }

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

  if (target.closest('#sl-copy-component')) {
    copyCurrentComponent();
    return;
  }

  if (target.closest('#sl-create')) { build(); return; }

  if (target.closest('[data-foundation-refresh]')) {
    if (!operation.active) refreshFoundations();
    return;
  }

  if (target.closest('[data-foundation-bulk]')) {
    onFoundationToggleAll();
    paintAndFocus('[data-foundation-bulk]');
    return;
  }

  const foundationCopy = target.closest<HTMLButtonElement>('[data-foundation-copy]');
  if (foundationCopy?.dataset.foundationCopy) {
    const copyKind = foundationCopy.dataset.textStyles === 'true'
      ? 'textStyles'
      : foundationCopy.dataset.effectStyles === 'true'
        ? 'effectStyles'
        : 'collection';
    copyFoundationRow(foundationCopy.dataset.foundationCopy, copyKind);
    return;
  }

  const foundationSource = target.closest<HTMLButtonElement>('[data-foundation-source]');
  if (foundationSource?.dataset.foundationSource) {
    const checked = foundationSource.getAttribute('aria-pressed') !== 'true';
    if (foundationSource.dataset.textStyles === 'true') {
      onFoundationChange({ kind: 'textStyles', checked });
    } else if (foundationSource.dataset.effectStyles === 'true') {
      onFoundationChange({ kind: 'effectStyles', checked });
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

  if (target.closest('#sl-copy-foundation')) {
    void copyFoundationBrief(presenter('create'));
    return;
  }

  if (target.closest('#sl-foundation-create')) {
    void buildFoundations();
  }
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

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

  // From here down the controls belong to the component screen and read the
  // shared UiState an async build owns. Settings controls above are not
  // gated: a theme or font change during a build touches nothing it reads.
  if (operation.active) return;

  if (input.id === 'sl-ai-toggle') {
    selection.aiEnabled = input.checked;
    setAiEnabled(state, input.checked);
    paintAndFocus('#sl-ai-toggle');
    return;
  }

  if (input.hasAttribute('data-include-hidden')) {
    selection.includeHidden = input.checked;
    state.includeHidden = input.checked;
    input.focus({ preventScroll: true });
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
  const target = event.target;
  // The note is a textarea, so it never satisfies the HTMLInputElement guard
  // below. It repaints nothing itself (see onNoteInput's own comment), so it
  // is handled and returned before that guard narrows the type.
  if (target instanceof HTMLTextAreaElement && target.matches('[data-publish-note]')) {
    onNoteInput(target.value);
    return;
  }
  const input = target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.matches('[data-global-search-input]')) {
    searchQuery = input.value;
    searchActiveIndex = 0;
    renderGlobalSearch(true);
    return;
  }
  if (input.matches('[data-publish-initial-version]')) {
    onInitialVersionInput(input.value);
    // Validity shows beside the field, patched in place: a repaint here
    // rebuilt the <input> under the caret on every keystroke.
    patchInitialVersion(refs.scroll, input.value);
    return;
  }
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

  // Settings tab strip: the arrow keys move and select, Home and End jump to
  // the ends. Tab is left alone, so it leaves the strip for the panel.
  if (event.target instanceof HTMLElement && event.target.dataset.settingsTab) {
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    const current = ids.indexOf(event.target.dataset.settingsTab as SettingsTab);
    const next = rovingIndex(current, ids.length, event.key, 'horizontal');
    if (next !== null) {
      event.preventDefault();
      selectSettingsTab(ids[next]);
      return;
    }
  }

  // Component format radios: any arrow moves and checks, Home and End jump.
  if (event.target instanceof HTMLElement && event.target.dataset.componentFormat) {
    const current = COMPONENT_FORMATS.indexOf(event.target.dataset.componentFormat as ComponentFormat);
    const next = rovingIndex(current, COMPONENT_FORMATS.length, event.key, 'both');
    if (next !== null) {
      event.preventDefault();
      chooseComponentFormat(COMPONENT_FORMATS[next]);
      return;
    }
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
    return;
  }

  /*
   * Escape backs out of the publish screen.
   *
   * Last of the Escape handlers on purpose. The modal, global search, the font
   * menu, and an open row menu each claim Escape first and return, so this
   * only ever sees the key when nothing is layered over the screen. The row
   * menu cannot be open here anyway (setLibraryPane drops it), but ordering
   * this by luck rather than by structure is how that stops being true.
   */
  if (event.key === 'Escape' && view === 'library' && libraryPane === 'history') {
    event.preventDefault();
    setLibraryPane('publish', '[data-publish-history]');
    return;
  }
  if (event.key === 'Escape' && view === 'library' && libraryPane === 'publish') {
    event.preventDefault();
    setLibraryPane('list', '[data-publish-open]');
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
  // figma.root.name, readable only on the main thread, so it arrives on this
  // message or not at all.
  state.currentFileName = msg.fileName ?? '';
  state.currentSpec = null;
  state.currentExtractedAt = '';
  state.generatedProse = null;
  state.generatedProseKeys = null;
  state.pendingAiNote = '';
  facts = node ? componentFacts(null, node.name) : NO_FACTS;
  selection.variantIds.clear();
  // Update the shared foundation as soon as this selection's dump arrives, so
  // a later action for this component (Copy for AI, Update) reads the
  // current selection's foundation rather than one left over from the
  // previous selection. Absent when the main thread has no dump yet (or
  // building one failed), or when the panel already holds this exact dump:
  // the main thread sends a dump once per read, not on every selection (see
  // foundationPost.ts). Extraction still proceeds either way, and the
  // brief's token bindings simply omit resolved values until a foundation
  // dump arrives.
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
      // Per component, and only once facts exist: on when this component has
      // parts a boolean property hides, off when it has none. Seeded here
      // rather than in createComponentSelection because that runs before
      // extraction, when there is nothing to reveal.
      selection.includeHidden = defaultIncludeHidden(facts);
      state.includeHidden = selection.includeHidden;
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
        // Out of AI uses, or any other failed AI request: the note explains
        // the empty AI sections once, so they are not also listed one by one
        // as "nothing to show".
        const omittedToList = state.quotaExhausted || note
          ? withoutAiOmissions(state.lastOmitted)
          : state.lastOmitted;
        const outcome = omissionsMessage(resultOutcome(Boolean(msg.replaced)), omittedToList);
        screen = {
          kind: 'success',
          componentName: currentName(),
          replaced: msg.replaced,
        };
        // The component has a doc now, so the next Create replaces it.
        if (state.currentNode) componentHasDoc.set(state.currentNode.id, true);
        nativeNotify(
          note ? `${outcome} ${note}` : outcome,
          (note || state.lastOmitted.length) ? { timeout: 5500 } : {},
        );
        state.lastOmitted = [];
        state.pendingAiNote = '';
      }
      paint();
      completeOperation();
      // A build may have spent an AI use, so the header should stop showing a
      // stale count.
      void refreshQuota();
      // This doc's content (created, updated, or rebuilt) is part of what a
      // publish would send, so a proposal computed before this no longer
      // describes the file.
      invalidatePublishAfterChange();
      return;

    case 'docFrameError':
      if (libraryOperation?.kind === 'update' && libraryOperation.currentDocId) {
        finishLibraryOperation(`Couldn’t update this doc. (${msg.message})`);
        return;
      }
      stopComponentProgress();
      nativeNotify(msg.message, { error: true, timeout: 5000 });
      screen = currentName()
        ? { kind: 'ready', componentName: currentName() }
        : { kind: 'empty' };
      paint();
      completeOperation();
      // main.ts's renderDocFrame can fail after already committing the doc
      // to canvas (registering it and placing the Section, with only a
      // cosmetic tail such as focus/zoom left to fail), in which case this
      // is a real doc created or replaced, not a no-op, and this session
      // cannot tell which happened from the message alone. Invalidate either
      // way rather than risk a proposal computed before this now-changed
      // doc surviving as if it still described the file.
      invalidatePublishAfterChange();
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

    case 'componentFormat':
      state.componentFormat = msg.value;
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
      // Settings may be on show already; the warning line is patched rather
      // than repainted so an open list and a typed value are left alone.
      paintFontWarning(refs.root, settingsFontWarning);
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

    case 'selectionDoc':
      componentHasDoc.set(msg.nodeId, msg.hasDoc);
      if (view === 'component' && state.currentNode?.id === msg.nodeId) paint();
      return;

    case 'componentImage':
      resolveComponentImage({ base64: msg.base64, mediaType: msg.mediaType });
      return;

    case 'componentImageError':
      // Fail open: AI writing continues from the structured component summary.
      resolveComponentImage(null);
      return;

    case 'foundation':
      onFoundationMessage(msg.dump, msg.groupDescriptions);
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
      // Refresh the copy-time cache from what actually landed on canvas
      // before branching: both the bulk build and a single row's Update
      // (below) can change what the next Copy should carry.
      setFoundationGroupDescriptions(msg.groupDescriptions);
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
        // Nothing created or updated means the file changed after the list
        // was read: the selected sources are gone. Said even with an AI note,
        // which alone would leave the empty result unexplained.
        const outcome = [
          msg.created ? `Created ${msg.created} doc${msg.created === 1 ? '' : 's'}.` : '',
          msg.replaced ? `Updated ${msg.replaced} doc${msg.replaced === 1 ? '' : 's'}.` : '',
        ].filter(Boolean).join(' ')
          || 'No docs were created. The selected sources are no longer in this file. Refresh sources and try again.';
        nativeNotify(
          foundationAiNote ? `${outcome} ${foundationAiNote}` : outcome,
          foundationAiNote ? { timeout: 5500 } : {},
        );
      }
      foundationScreen = { kind: 'ready' };
      foundationAiNote = '';
      paint();
      completeOperation();
      void refreshQuota();
      // A Foundation doc's content is part of what a publish would send, so a
      // proposal computed before this build no longer describes the file.
      // Nothing landing (the sources were gone) changed nothing, so nothing
      // to invalidate.
      if (msg.created > 0 || msg.replaced > 0) invalidatePublishAfterChange();
      return;

    case 'foundationFrameError':
      if (
        libraryOperation?.kind === 'update' &&
        libraryOperation.currentDocId &&
        libraryEntry(libraryOperation.currentDocId)?.kind === 'foundation'
      ) {
        finishLibraryOperation(`Couldn’t update this doc. (${msg.message})`);
        return;
      }
      setFoundationGenerating(false);
      nativeNotify(
        msg.created > 0
          ? `Created ${msg.created} doc${msg.created === 1 ? '' : 's'}, then the build stopped. `
            + `Create docs again to finish. (${msg.message})`
          : msg.message,
        { error: true, timeout: 5500 },
      );
      foundationScreen = { kind: 'ready' };
      foundationAiNote = '';
      paint();
      completeOperation();
      // A build that stopped partway through may already have changed docs
      // on canvas before it failed: `msg.created` counts the new ones, but a
      // unit that rebuilt an existing doc replaced it without being counted
      // here, so this message cannot tell a failed rebuild of existing docs
      // from nothing landing. Invalidate either way, the way docFrameError
      // does; the cost of a build that changed nothing is one extra dry run.
      invalidatePublishAfterChange();
      return;

    case 'library':
      libraryRequested = true;
      libraryError = null;
      libraryReadIncomplete = msg.incomplete === true;
      libraryEntries = msg.entries;
      libraryMenuDocId = null;
      startLibraryDriftChecks();
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      // Fired from the reply rather than from navigateToView: requestLibrary
      // already runs a live foundation extraction on the main thread (for
      // drift) whenever a foundation doc exists, so a file with only
      // component docs no longer pays for a second full read of nothing.
      // This still lands well before a click: these are the same entries
      // that populate the rows a user must see before they can Copy one, and
      // prefetchFoundationsForCopy's own guard keeps it once-per-session
      // across repeat library loads.
      if (msg.entries.some((entry) => entry.kind === 'foundation')) {
        prefetchFoundationsForCopy();
      }
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    case 'driftSource': {
      const baseline = libraryBaseline.get(msg.docId);
      if (baseline === undefined) return;
      // A doc from an older extractor has a different hash projection, so
      // comparing hashes would report drift for the wrong reason.
      if (libraryExtractorVersion.get(msg.docId) !== EXTRACTOR_VERSION) {
        libraryDrift.set(msg.docId, 'staleVersion');
      } else {
        try {
          const spec = extract(msg.node, { figmaFile: msg.fileKey, ...(msg.fileName ? { figmaFileName: msg.fileName } : {}) });
          // One projection serves both the hash and the later diff, so the
          // live side of "Review detected changes" is the object that decided
          // the badge.
          const projection = specHashProjection(spec, {
            includeHidden: libraryIncludeHidden.get(msg.docId) === true,
          });
          libraryLiveProjection.set(msg.docId, projection);
          libraryDrift.set(
            msg.docId,
            contentHash(projection) === baseline ? 'inSync' : 'drifted',
          );
        } catch {
          libraryDrift.set(msg.docId, 'unavailable');
        }
      }
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      paintLibraryDrift();
      return;
    }

    case 'driftError':
      if (!libraryBaseline.has(msg.docId)) return;
      libraryDrift.set(msg.docId, 'unavailable');
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      paintLibraryDrift();
      return;

    case 'libraryError':
      // The read failed, so nothing this pass would have established is
      // known. The rows on screen are from the last successful read: their
      // checks did not run, so each says so rather than keeping a badge
      // this pass never confirmed, and the footer offers "Refresh to retry".
      // Refresh comes back because `libraryRefreshing` is what disabled it.
      libraryRequested = true;
      libraryRefreshing = false;
      libraryError = msg.message;
      // Not a partial success, so there is no honest "list may be missing
      // some docs" note to layer under the failure banner.
      libraryReadIncomplete = false;
      for (const entry of libraryEntries) libraryDrift.set(entry.docId, 'unavailable');
      // A driftSource/driftError reply still in flight from the pass that
      // failed would otherwise find its baseline and set a real badge next
      // to a banner that says this pass established nothing.
      libraryBaseline.clear();
      libraryChanges.clear();
      syncLibraryBadge();
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    case 'docBaseline': {
      // Only a reply this pass asked for and is still waiting on; a reply that
      // outlived a refresh would otherwise revive a cleared row.
      const waiting = libraryChanges.get(msg.docId);
      if (!waiting || waiting.state !== 'pending') return;
      libraryChanges.set(msg.docId, resolveLibraryChanges({
        baseline: msg.baseline,
        live: msg.live,
        liveProjection: libraryLiveProjection.get(msg.docId),
      }));
      if (view === 'library') paint();
      return;
    }

    case 'docProse': {
      const active = libraryOperation;
      if (!active || active.kind !== 'copy' || active.currentDocId !== msg.docId) return;
      active.prose = msg.prose;
      // DocSourceIntent has only ever had one value. The main thread never
      // branches on it — it only echoes it back on `docSource` — so 'update'
      // is sent here too; the docSource handler below tells Copy apart from
      // Update by `libraryOperation.kind`, not by this field.
      send({ type: 'requestDocSource', docId: msg.docId, intent: 'update' });
      return;
    }

    case 'docSource': {
      const active = libraryOperation;
      if (!active || active.currentDocId !== msg.docId) return;
      const src = {
        docId: msg.docId,
        node: msg.node,
        fileKey: msg.fileKey,
        ...(msg.fileName ? { fileName: msg.fileName } : {}),
        config: msg.config,
        prose: msg.prose,
      };
      if (active.kind === 'copy') {
        // Copy never asks about hand edits (msg.selfEdited) and never runs
        // updateFromSource: it only reads the source, builds the brief, and
        // clears the operation, whatever the outcome.
        const prose = active.prose ?? null;
        void copyBriefFromSource(state, src, prose, copyPresenter()).finally(() => {
          libraryOperation = null;
          completeOperation();
          if (view === 'library') paint();
        });
        return;
      }
      const runUpdate = (): void => {
        // updateFromSource reports through this callback before every false
        // return, so a refusal arrives with its own sentence. The backstop
        // below only keeps an empty one from reading as "Doc updated."
        let preparationError = '';
        // A stale-version rebuild tops up the sections the old prompt could
        // not write before the frame rebuilds; a plain update sends the
        // source's prose through untouched, exactly as before.
        void (async () => {
          let prose = src.prose;
          if (msg.intent === 'rebuild') {
            prose = await topUpProseForRebuild(state, src);
            // Take the note (if any) right here, for exactly the document
            // whose top-up just finished, and clear the shared slot in the
            // same step. Waiting until this document's own completion (or
            // reading it from any other document's) would risk reporting a
            // failure against the wrong document, or losing it if this whole
            // operation aborts before that later point ever runs.
            const note = takeTopUpNote(state);
            if (note && !active.aiNotes.includes(note)) active.aiNotes.push(note);
          }
          return updateFromSource(state, { ...src, prose }, libraryPresenter((message) => {
            preparationError = message;
          }));
        })().then((dispatched) => {
          if (!dispatched) finishLibraryOperation(preparationError || 'Couldn’t update this doc.');
        });
      };
      if (msg.selfEdited && !active.confirmedOverwrite.has(msg.docId)) {
        void confirmDialog({
          title: HAND_EDIT_TITLE,
          // docSource only ever serves component docs, so the writing
          // sections are always there to keep.
          body: handEditBody(false),
          confirmLabel: 'Update',
        }).then((ok) => {
          if (libraryOperation !== active) return; // the operation ended while the dialog was open
          if (!ok) {
            // The user's own choice, so it reads as a status, not an error.
            finishLibraryOperation('Update canceled. Your edits were kept.', true);
            return;
          }
          active.confirmedOverwrite.add(msg.docId);
          runUpdate();
        });
        return;
      }
      runUpdate();
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

    case 'publishSources':
      void onPublishSources(
        msg,
        publishAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId),
      );
      return;

    case 'publishSourcesError':
      onPublishSourcesError(msg.message);
      return;

    case 'publishInfo':
      onPublishInfo(msg);
      // The publish screen may be open already, drawn before the identity
      // landed. Re-enter so a published file gets its dry run and an
      // unpublished one its first-version field.
      if (view === 'library' && libraryPane === 'publish') onPublishOpen();
      return;

    case 'docDetached':
    case 'docRemoved':
      // The detached/removed doc might have been a foundation doc, so its
      // descriptions (if any) are gone from canvas: refresh the cache with
      // the fresh whole-canvas truth rather than leaving the pre-removal one
      // in place for the next Copy to serve.
      setFoundationGroupDescriptions(msg.groupDescriptions);
      nativeNotify(
        msg.type === 'docDetached'
          ? 'Doc detached. It stays on the canvas but no longer appears in the Library.'
          : 'Doc deleted.',
      );
      // A detached or deleted doc no longer counts as the component's doc:
      // Create would make a new one, not replace it.
      for (const entry of libraryEntries) {
        if (entry.docId === msg.docId && entry.sourceNodeId) componentHasDoc.set(entry.sourceNodeId, false);
      }
      libraryEntries = libraryEntries.filter((entry) => entry.docId !== msg.docId);
      libraryDrift.delete(msg.docId);
      libraryBaseline.delete(msg.docId);
      libraryExtractorVersion.delete(msg.docId);
      libraryLiveProjection.delete(msg.docId);
      libraryChanges.delete(msg.docId);
      if (libraryExpandedDocId === msg.docId) libraryExpandedDocId = null;
      if (libraryRevealDocId === msg.docId) libraryRevealDocId = null;
      if (libraryMenuDocId === msg.docId) libraryMenuDocId = null;
      syncLibraryBadge();
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      // The removed or detached doc is no longer part of what a publish
      // would send, so a proposal computed before this no longer describes
      // the file.
      invalidatePublishAfterChange();
      return;

    default:
      return;
  }
};

paintAllowance();
paint();
send({ type: 'requestSelection' });

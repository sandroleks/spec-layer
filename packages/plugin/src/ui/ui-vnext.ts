/**
 * The plugin UI's only entry point: this module owns the state and the message
 * plumbing, and each `screens/*` module owns its own markup.
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
import { keepFocus } from './focusRestore';
import { installErrorReporting } from './errorReporting';
import { renderAllowance } from './shell/header';
import { setRailBadge } from './shell/sidebar';
import { confirmDialog, type ConfirmDialogOptions } from './shell/confirmDialog';
import { planNext, replaceDialog, resultToast } from './syncDialog';
import { fileKeyFromUrl } from '../syncText';
import type { SyncScope } from '../syncFigma';
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
import { patchLibraryCheckLine, patchLibraryDrift, renderLibraryScreen, revealLibraryRow, type LibraryScreenPresentation } from './screens/library';
import { patchInitialVersion, renderPublishScreen } from './screens/publish';
import { renderHistoryScreen } from './screens/history';
import { globalSearchMarkup, patchGlobalSearch, setSearchActive } from './screens/search';
import {
  applyGroupBulk,
  applyVariantBulk,
  componentDocSelection,
  defaultIncludeHidden,
  failedBuildScreen,
  sectionGroups,
  selectionOutcome,
  unavailableSections,
  variantBulkState,
  variantCountLabel,
} from './viewModel/componentScreen';
import {
  buildLibraryModel,
  formatLibraryCheckedAt,
  initialLibraryDrift,
  libraryCheckedLabelChangesIn,
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
  draftToKeep,
  foundationAiRequested,
  onFoundationChange,
  onFoundationMessage,
  setFoundationGroupDescriptions,
  onSelectionFoundation,
  nextPhaseIndex,
  omissionsMessage,
  onFoundationToggleAll,
  pluginBuild,
  restoreDraft,
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
import { DriftQueue, libraryCarry, type LibraryCarry } from './libraryPass';
import { BlockWatch } from '../timing';

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
/** When a failed build's `error` screen last painted, for selectionOutcome's toast window. */
let failedBuildPaintedAt = 0;
let foundationRequested = false;
let foundationRefreshing = false;
let foundationAiNote = '';
let settingsCustomMode = false;
/** A fresh launch opens Settings on Frames; within a session it reopens on the last tab. */
let settingsTab: SettingsTab = 'frames';
let settingsColorError = '';
let settingsFontWarning = '';
let settingsLogoError = '';
/** Sync to Figma, as main last reported it. */
let syncOnUpdate = false;
let syncFileUrl: string | null = null;
let syncFileUrlError = '';
/** A run is planning, confirming or writing; one at a time. */
let syncBusy = false;
/** Components the confirmed run kept as edited, offered for replacing next. */
let syncPendingEdited: string[] = [];

/** Plan first, confirm, then write. Main plans again before it writes. */
function startSync(scope: SyncScope): void {
  if (syncBusy || operation.active) return;
  syncBusy = true;
  syncPendingEdited = [];
  paint();
  send({ type: 'requestSyncPlan', scope, replaceEdited: false });
}

function endSync(): void {
  syncBusy = false;
  syncPendingEdited = [];
  paint();
}

function offerReplace(scope: SyncScope, dialog: ConfirmDialogOptions): void {
  void confirmDialog(dialog).then((ok) => {
    if (ok) send({ type: 'applySync', scope, replaceEdited: true });
    else endSync();
  });
}

function saveSyncFileUrl(value: string): void {
  const trimmed = value.trim();
  if (trimmed !== '' && !fileKeyFromUrl(trimmed)) {
    syncFileUrlError = 'That is not a Figma file link. Copy it from Share, then Copy link.';
    paintAndFocus('#sl-sync-file-url');
    return;
  }
  syncFileUrlError = '';
  send({ type: 'setSyncFileUrl', value: trimmed });
}
let settingsFonts: string[] = [];
let settingsFontsRequested = false;
/**
 * The open font list, or null. `query` is what was typed since it opened, kept
 * apart from the committed value so opening the list shows every family.
 */
let fontMenu: { field: FontField; query: string; activeIndex: number } | null = null;
let settingsCustomDraft: BrandTheme | null = null;
let licenseScreenState: LicenseState = 'checking';
/** A saved key's Check again is running, so the button reads Checking…. */
let licenseRechecking = false;
let licenseInput = '';
let libraryEntries: LibraryEntry[] = [];
/**
 * Whether each selected component has a doc (`selectionDoc`), keyed by component
 * so an answer that lands while a build defers the selection survives. Only a
 * known doc turns Create docs into Replace docs.
 */
const componentHasDoc = new Map<string, boolean>();
const currentHasDoc = (): boolean => {
  const id = state.currentNode?.id;
  return id ? componentHasDoc.get(id) === true : false;
};
const libraryDrift = new Map<string, LibraryDriftState>();
const libraryBaseline = new Map<string, string>();
/** The current drift pass; see libraryPass.ts. */
const driftQueue = new DriftQueue();
let driftPassCounter = 0;
function newPassId(): string { return String(++driftPassCounter); }
/** A `requestLibrary { ifChanged }` probe awaiting its reply. */
let libraryProbeInFlight = false;
let libraryCheckedAt: number | null = null;
/** What the next `library` reply keeps instead of checking again; see libraryCarry. */
let pendingLibraryCarry: LibraryCarry | null = null;
/** The running pass kept results from this earlier check, so it ends no fresher. */
let libraryCarriedCheckedAt: number | null = null;
/** Wakes when the caption's label next changes, while the Library list shows. */
let libraryCheckedTimer: ReturnType<typeof setTimeout> | null = null;
/** The same `DRIFT_TIMING=1` build define main.ts reads; see build.mjs. */
declare const __DRIFT_TIMING__: boolean;
// `DRIFT_TIMING=1` only: logs each timer stall over 100ms (see timing.ts) as a
// plain string, so a copy out of Figma's console keeps every number.
const uiBlocks = __DRIFT_TIMING__
  ? new BlockWatch(() => Date.now(), 100, (ms, during) => {
    console.log(`[Spec Layer] timing ui blocked ${ms}ms during ${during.join(', ')}`);
  })
  : null;
if (__DRIFT_TIMING__ && uiBlocks) setInterval(() => uiBlocks.tick(50), 50);
// docId → the EXTRACTOR_VERSION on its doc link (undefined on older blobs). Checked
// first: a hash from a different extractor version cannot be compared.
const libraryExtractorVersion = new Map<string, string | undefined>();
/** Per doc: whether its baseline was hashed with hidden-by-default parts included. */
const libraryIncludeHidden = new Map<string, boolean>();
// docId → this pass's live SpecHashProjection, kept for every component row so
// a row that drifts on the next refresh needs no second round trip.
const libraryLiveProjection = new Map<string, SpecHashProjection>();
// docId → change result for this pass; a new pass starts every expansion at `pending`.
const libraryChanges = new Map<string, LibraryChangeResult>();
let libraryFilter: LibraryFilter = 'all';
/**
 * Which Library pane shows. Library-local, not a PluginView: the rail is a closed
 * set of destinations (sidebar.ts maps every PluginView to an icon), and
 * publishing is something you do to the library, not its peer.
 */
let libraryPane: 'list' | 'publish' | 'history' = 'list';
let libraryExpandedDocId: string | null = null;
/**
 * The row the search palette last opened, marked until the user refreshes,
 * changes filter, or leaves the Library.
 */
let libraryRevealDocId: string | null = null;
let libraryMenuDocId: string | null = null;
let libraryMenuRestore: HTMLElement | null = null;
let libraryRefreshing = false;
let libraryRequested = false;
/** Why the last `requestLibrary` failed; cleared by the next `library` reply or a refresh. */
let libraryError: string | null = null;
/** Whether the scan behind `libraryEntries` stopped partway (`incomplete: true`). */
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
  /** Groups this run's requests so main shares one read across them. */
  batchId: string;
  /** The Section ids this run's component rebuilds placed. */
  rebuilt: string[];
  /** Omitted or placeholder sections across the run, deduplicated by id and
   *  reason; collected per doc because `state.lastOmitted` holds only the newest. */
  omitted: OmittedSection[];
  /** Failed-generation notes from stale-version rebuilds, deduplicated by text;
   *  collected per doc because `state.pendingAiNote` holds only the newest. */
  aiNotes: string[];
};
/**
 * Copy for AI writes nothing, so it tracks only its row and the prose fetched
 * by requestDocProse before requestDocSource; `prose` is undefined until then.
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
        // Hold on the last line; a slow AI build must not cycle back to the first.
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
  // The freshest updates allowance, but silent on AI writing, so it never stands
  // in for the header's quota: with no quota yet it is kept apart and one fetched.
  onPublishQuota: (snapshot) => {
    publishSnapshot = snapshot;
    if (state.quota) {
      state.quota = { ...state.quota, publish: snapshot };
    } else {
      void refreshQuota(false);
    }
    if (view === 'library') paint();
  },
  // Successes are toasts; the screen shows only errors, which must stay on view.
  notify: (message) => nativeNotify(message),
});

setHistoryHost({
  repaint: () => {
    if (view === 'library' && libraryPane === 'history') paint();
  },
});

/**
 * Call after anything that could change what a publish contains: a doc created,
 * updated, rebuilt, detached or removed (even by a render that then fails), a
 * Foundation build (even partial), a Library update batch. Clears the stale
 * proposal (see invalidatePublishProposal) and re-runs the dry run if Publish
 * shows, except over an unread upload error, which a dry run would wipe.
 */
function invalidatePublishAfterChange(): void {
  invalidatePublishProposal();
  if (publishState().status === 'error') return;
  if (view === 'library' && libraryPane === 'publish') onPublishOpen();
}

/**
 * Whether the first quota request settled: a null `state.quota` reads as a
 * spinner before it and as "plan status unavailable" after.
 */
let quotaFetched = false;

/** The last publish response's updates allowance; a fetched quota's `publish` wins. */
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

installErrorReporting(window, {
  log: (message, detail) => console.error(message, detail),
  notify: (message) => nativeNotify(message, { error: true }),
  now: () => Date.now(),
});

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
      // Hold on the last line; a slow AI build must not cycle back to the first.
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
  // The component screen's exhausted note reads the same state; no other screen does.
  if (view === 'component') paint();
}

/** The screen the last paint drew; focus is carried only within one screen. */
let paintedView: PluginView | null = null;

/**
 * Repaints the current screen. On the same screen, keyboard focus survives a
 * rebuild the user did not ask for (focusRestore.ts); a screen change starts
 * fresh, and callers that move focus themselves still do so after this.
 */
function paint(): void {
  const sameScreen = paintedView === view;
  paintedView = view;
  if (sameScreen) keepFocus(document, paintScreen);
  else paintScreen();
}

function paintScreen(): void {
  switch (view) {
    case 'component':
      renderComponentScreen(
        refs, screen, selection, facts, currentHasDoc(),
        allowanceState(state.quota, quotaFetched),
      );
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
        syncOnUpdate,
        syncFileUrl,
        syncBusy,
        ...(syncFileUrlError ? { syncFileUrlError } : {}),
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
        // Only the proxy can state a limit; without one there is no count to show.
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
  // An Update run's progress floats above its footer buttons; a source check's
  // goes in the check line under the filters, so its start and end move no row.
  const progress = update
    ? {
        // No "doc 1 of 3": the bar already reads "0 of 3" while the first doc runs.
        label: update.batch ? 'Updating docs' : 'Updating this doc',
        current: update.completed,
        total: update.total,
      }
    : null;
  const checkProgress = libraryRefreshing || pendingChecks
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
    probing: libraryProbeInFlight,
    checksIncomplete: failedChecks,
    checkedLabel: formatLibraryCheckedAt(libraryCheckedAt),
    checkProgress,
    updatingAll: Boolean(update?.batch),
    updatingDocId: update?.currentDocId ?? null,
    progress,
  };
}

/** Repaint after a source check lands; list only, so Publish and History keep focus. */
function paintLibraryDrift(): void {
  if (view !== 'library' || libraryPane !== 'list') return;
  if (!patchLibraryDrift(refs, libraryPresentation())) paint();
}

/** Re-say "Checked 4 min ago" in place; the rows and the footer are left alone. */
function paintLibraryCaption(): void {
  if (view !== 'library' || libraryPane !== 'list') return;
  patchLibraryCheckLine(refs, libraryPresentation());
}

/**
 * Keep "Checked 4 min ago" honest while the list shows: one timeout for when the
 * label next changes, re-armed until it is a clock time. Call when the stamp moves.
 */
function syncLibraryCheckedTimer(): void {
  if (libraryCheckedTimer !== null) {
    clearTimeout(libraryCheckedTimer);
    libraryCheckedTimer = null;
  }
  if (view !== 'library' || libraryPane !== 'list') return;
  const wait = libraryCheckedLabelChangesIn(libraryCheckedAt);
  if (wait === null) return;
  // A little past the boundary, so the label has moved when it is read.
  libraryCheckedTimer = setTimeout(() => {
    libraryCheckedTimer = null;
    paintLibraryCaption();
    syncLibraryCheckedTimer();
  }, wait + 50);
}

function stampLibraryChecked(): void {
  libraryCheckedAt = libraryCarriedCheckedAt ?? Date.now();
  libraryCarriedCheckedAt = null;
  syncLibraryCheckedTimer();
}

function navigateToView(
  next: PluginView,
  options: { refreshLibrary?: boolean } = {},
): void {
  const arrived = view !== next;
  view = next;
  closeFontMenu();
  if (view !== 'library') libraryRevealDocId = null;
  setActiveView(refs, view);
  if (view === 'foundations') requestFoundations();
  // Arriving at the Library always lands on the list, never a stale Publish pane.
  if (view === 'library') libraryPane = 'list';
  // Never while a Library operation runs: the reply clears the drift maps a
  // queued update started from (and the row a Copy reads). A build's lock is no
  // reason to skip it, or a first visit stays on the loading skeleton.
  if (view === 'library' && options.refreshLibrary !== false && libraryOperation === null) checkLibrary();
  // An arrival that sends no probe must still resume a paused pass, or its rows
  // stay "Checking…" with nothing in flight. Only on arrival: a new pass id
  // while already here would throw away main's resolver memo mid-pass.
  else if (arrived && view === 'library' && !driftQueue.done()) {
    driftQueue.resume(newPassId());
    pumpDriftQueue();
  }
  if (view === 'library' && !publishInfoRequested) {
    publishInfoRequested = true;
    send({ type: 'requestPublishInfo' });
  }
  if (view === 'settings' && !settingsFontsRequested) {
    settingsFontsRequested = true;
    send({ type: 'requestFonts' });
  }
  const paintStarted = __DRIFT_TIMING__ ? Date.now() : 0;
  if (__DRIFT_TIMING__) uiBlocks?.doing(`ui paint ${next}`);
  paint();
  if (__DRIFT_TIMING__) {
    uiBlocks?.done();
    console.log(`[Spec Layer] timing ui navigate to ${next}, paint ${Date.now() - paintStarted}ms`);
  }
  syncLibraryCheckedTimer();
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
  // Publish paints its updates line from the plan, which usually lands after first paint.
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
 * Check again, for a saved key whose last check could not finish: the same
 * check the plugin runs on launch, never a jump to the inactive state.
 */
async function recheckLicense(): Promise<void> {
  if (licenseRechecking) return;
  licenseRechecking = true;
  paint();
  try {
    await refreshQuota();
  } finally {
    licenseRechecking = false;
    // Focus returns to the button if it still shows; otherwise there is none.
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
      // A failure before the canvas stays on the panel as a banner, like a
      // docFrameError; copies toast through copyPresenter instead.
      stopComponentProgress();
      screen = failedBuildScreen(currentName(), message);
      failedBuildPaintedAt = Date.now();
      paint();
    },
    info: (message) => {
      // A download has no completion message from main, so it toasts here.
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
 * The footer's Refresh sources: re-sends requestFoundation (otherwise once per
 * session) without the loading skeleton, so the list stays usable meanwhile.
 */
function refreshFoundations(): void {
  foundationRequested = true;
  foundationRefreshing = true;
  paint();
  send({ type: 'requestFoundation' });
}

/**
 * When Library opens, fetch the foundation dump if nothing has, so a foundation
 * row's Copy needs no round trip: the Foundations tab may never have opened, and
 * `selection` carries a dump only when a component is selected. Shares
 * foundationRequested: the `foundation` reply readies that screen too, and
 * `foundationError` clears the flag so a visit there re-requests.
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

  // One brief per selected collection, so a spacing-only collection still gets an overview.
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
      // The component build's failure notes, worded for descriptions.
      foundationAiNote = aiFailureNote(state, error, 'foundation');
    }
  }

  send({
    type: 'renderFoundation',
    selection: foundationSelection,
    config: {
      includeDescriptions: true,
      aiNotes: Boolean(groupDescriptions && Object.keys(groupDescriptions).length > 0),
      // No contrast toggle exists yet. main.ts renders the matrix when this is
      // true, but turning it on unasked would change every foundation doc, so
      // it waits for a product decision and a control.
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
 * The badge's last settled answer. A refresh clears every check first, so
 * `counts.updates` is not a fact until a pass finishes; read straight, the
 * badge would vanish at each reload and count back up.
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

function refreshLibrary(carry: LibraryCarry | null = null): void {
  pendingLibraryCarry = carry;
  libraryRequested = true;
  libraryRefreshing = true;
  libraryMenuDocId = null;
  libraryExpandedDocId = null;
  libraryRevealDocId = null;
  libraryError = null;
  libraryLiveProjection.clear();
  libraryChanges.clear();
  driftQueue.clear();
  if (view === 'library') paint();
  send({ type: 'requestLibrary' });
}

/**
 * Coming back to the Library from another rail tab. A first visit or a failed
 * read loads the list; otherwise main is asked whether the document changed, so
 * an unchanged file costs no extraction: `libraryUnchanged` resumes a paused
 * pass and `library` restarts one. Refresh library never routes here.
 *
 * While the probe is out, Update, Update all and Refresh are disabled
 * (`probing`): a dirty file answers with a full scan, which must not land
 * mid-update. No paint: the only caller, navigateToView, paints right after.
 */
function checkLibrary(): void {
  if (!libraryRequested || libraryError !== null) {
    refreshLibrary();
    return;
  }
  if (libraryProbeInFlight) return;
  libraryProbeInFlight = true;
  send({ type: 'requestLibrary', ifChanged: true });
}

function startLibraryDriftChecks(carry: LibraryCarry | null): void {
  libraryCarriedCheckedAt = carry?.checkedAt ?? null;
  libraryDrift.clear();
  libraryBaseline.clear();
  libraryExtractorVersion.clear();
  libraryLiveProjection.clear();
  libraryChanges.clear();
  libraryIncludeHidden.clear();
  for (const entry of libraryEntries) {
    const initial = initialLibraryDrift(entry, EXTRACTOR_VERSION);
    if (initial === null) continue;
    if (initial !== 'check') {
      libraryDrift.set(entry.docId, initial);
      continue;
    }
    libraryBaseline.set(entry.docId, entry.storedContentHash);
    libraryExtractorVersion.set(entry.docId, entry.extractorVersion);
    libraryIncludeHidden.set(entry.docId, entry.includeHidden === true);
    const carried = carry?.checks.get(entry.docId);
    if (carried) {
      libraryDrift.set(entry.docId, carried.status);
      if (carried.projection) libraryLiveProjection.set(entry.docId, carried.projection);
      continue;
    }
    libraryDrift.set(entry.docId, 'pending');
  }
  // Display order: the rows the user sees first settle first.
  const order = new Map(currentLibraryModel().allRows.map((row, index) => [row.docId, index] as const));
  const pendingIds = [...libraryDrift.entries()]
    .filter(([, status]) => status === 'pending')
    .map(([docId]) => docId)
    .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  driftQueue.start(newPassId(), pendingIds);
  syncLibraryBadge();
  pumpDriftQueue();
}

/**
 * Send the next source check if the Library shows and none is in flight. Not
 * sending while another view is up is the pause; the queue resumes on return.
 */
function pumpDriftQueue(): void {
  if (view !== 'library') return;
  const check = driftQueue.next();
  if (check === null) return;
  const entry = libraryEntries.find((candidate) => candidate.docId === check.docId);
  if (!entry) {
    driftQueue.settle(check.docId, check.passId);
    pumpDriftQueue();
    return;
  }
  send({ type: 'requestDrift', docId: check.docId, sourceNodeId: entry.sourceNodeId, passId: check.passId });
}

/**
 * One reply (result or error) landed. False when it answers no check in flight,
 * i.e. a pass a newer scan replaced, and the caller drops it. True advances the pass.
 */
function settleDriftCheck(docId: string, passId: string): boolean {
  if (!driftQueue.settle(docId, passId)) return false;
  if (driftQueue.done()) stampLibraryChecked();
  pumpDriftQueue();
  return true;
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
 * Expand or collapse a row's change panel. Opening an uncompared row asks main
 * for its baseline (`docBaseline` resolves it); collapsing keeps the result.
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
 * Copy for AI from the Selected component screen. No document is read, so no
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

/** Reports a Copy through native toasts; unlike libraryPresenter, errors notify directly. */
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
 * Copy one Foundations row through the Library's scoped copy, which widens a
 * collection to every mode and its dependency closure; `modeIds` is frame-only.
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
 * End the Library's update or copy and say how it went. `error` is why it ended
 * early; `canceled` marks a user stop, which is not shown as a failure.
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
    // Report omitted or placeholder sections the way Create does.
    if (!error && active.omitted.length) {
      omitted = active.omitted;
      message = omissionsMessage(message, omitted);
    }
    // A failed rebuild top-up, appended after any omissions as Create does.
    if (!error && active.aiNotes.length) {
      aiNotes = active.aiNotes;
      message = `${message} ${aiNotes.join(' ')}`;
    }
  } else if (error) {
    message = error;
  }
  state.lastOmitted = [];
  // Backstop for an operation that aborted before the docSource handler drained
  // this slot: a leftover note must not reach a later, unrelated action.
  state.pendingAiNote = '';
  if (message) {
    nativeNotify(
      message,
      error
        ? canceled ? { timeout: 5000 } : { error: true, timeout: 5000 }
        : (omitted.length || aiNotes.length) ? { timeout: 5500 } : {},
    );
  }
  // Any landed doc, even in a failed or canceled batch, outdates the proposal.
  if (active.kind === 'update' && active.completed > 0) invalidatePublishAfterChange();
  libraryOperation = null;
  completeOperation();
  if (view === 'library') paint();
  // The rescan keeps what this run did not change; see libraryCarry.
  refreshLibrary(libraryCarry({
    drift: libraryDrift,
    projections: libraryLiveProjection,
    checkedAt: libraryCheckedAt,
    rebuilt: active.kind === 'update' ? active.rebuilt : [],
  }));
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
    send({ type: 'updateFoundationDoc', docId, batchId: active.batchId });
  } else {
    // The intent was fixed when the run started: reading libraryDrift here
    // would lose a rebuild after a mid-run refresh cleared it.
    send({ type: 'requestDocSource', docId, intent, batchId: active.batchId });
  }
  if (view === 'library') paint();
}

const HAND_EDIT_TITLE = 'Replace your edits to generated content?';

/**
 * The one-doc hand-edit confirm's body, shared by the row Update and the
 * docSource check. Only a component doc has writing sections that survive.
 */
function handEditBody(foundation: boolean): string {
  const replaced = 'You edited generated content in this doc by hand. Updating replaces those edits.';
  return foundation ? replaced : `${replaced} Your text in the writing sections is kept.`;
}

/**
 * Update the given docs one at a time. `batchLabel` names the button that
 * started a batch, so the hand-edit confirm repeats the user's action.
 */
async function startLibraryUpdates(
  docIds: string[],
  batch: boolean,
  batchLabel = 'Update all docs',
): Promise<void> {
  // A probe's reply may be a full scan; it must not land mid-update.
  if (docIds.length === 0 || operation.active || libraryProbeInFlight) return;
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
  if (libraryProbeInFlight || !beginOperation(operation)) return;
  // Clear any record a Create or an aborted run left; it says nothing about these docs.
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
    batchId: newPassId(),
    rebuilt: [],
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
  // Fold in this doc's omissions and clear the slot so the next doc cannot
  // inherit them; deduplicated so a batch reports each once.
  for (const o of state.lastOmitted) {
    if (!active.omitted.some((prev) => prev.id === o.id && prev.reason === o.reason)) active.omitted.push(o);
  }
  state.lastOmitted = [];
  // aiNotes are taken at the docSource handler's topUpProseForRebuild call, for
  // exactly this doc; reading the slot here could fold in another doc's note.
  dispatchNextLibraryUpdate();
}

/**
 * Copy for AI. A component row asks for its prose (stored blob merged with the
 * canvas), then sends requestDocSource once docProse lands; the docSource
 * handler builds the brief and clears the operation on every exit.
 *
 * A foundation row copies synchronously from the in-memory variables and the
 * entry's scope, without the operation lock: holding it would block an
 * unrelated Update behind a copy that has already finished.
 */
function startLibraryCopy(docId: string): void {
  const entry = libraryEntry(docId);
  if (!entry) return;

  if (entry.kind === 'foundation') {
    // canCopy withholds this; it guards a stale menu.
    if (!entry.foundationScope) return;
    // Re-arm the fetch: a failed prefetch leaves the spec null and nothing else
    // here re-sends requestFoundation, so "try again in a moment" would repeat
    // forever. The prefetch's own guard makes this free otherwise.
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
  // As in navigateToView: a read mid-run would clear the update's drift maps.
  if (libraryOperation !== null) return;
  // A failed read is not "loaded": retry rather than leave the palette stuck.
  if (libraryRequested && libraryError === null) return;
  libraryRequested = true;
  libraryRefreshing = true;
  send({ type: 'requestLibrary' });
}

/**
 * Renders the palette once, then patches it in place: the panel animates in, so
 * replacing it per keystroke blinks it, and the caret and IME composition need
 * the live input to survive.
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
    // Only when the read produced nothing; docs on screen are not "unreadable".
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
// An overlay in the shell root whose markup settings.ts owns. Its listeners live
// here because every paint replaces the screen's DOM.
// ---------------------------------------------------------------------------

/**
 * Applies a colour from a swatch's native picker without repainting: the picker
 * is anchored to the element a paint would replace and `input` fires while
 * dragging, so the hex field and hint are updated by hand. `commit` marks the
 * release; persisting per `input` would write clientStorage per pointer move.
 */
function applySwatchColor(field: ColorField, raw: string, commit: boolean): void {
  const parsed = parseBrandHex(raw);
  if (!parsed) return;
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
 * A family the host did not list falls back to Inter in the frame, so typed text
 * commits but says so. Checked only once the list has arrived.
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
 * Moves the active pointer, clamped by the model. Hover and focus call this per
 * row crossed, so it patches attributes in place and the input keeps its caret.
 */
function setSearchActiveIndex(index: number): void {
  const next = buildSearchModel(searchDocuments(), searchQuery, index).activeIndex;
  if (next === searchActiveIndex) return;
  searchActiveIndex = next;
  setSearchActive(refs.root, next);
  refs.root.querySelector<HTMLElement>(`#sl-global-search-result-${next}`)?.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens the picked document's row in the Library rather than jumping the canvas;
 * the filter resets so it cannot hide the result.
 */
function activateSearchResult(result: SearchResult | undefined): void {
  if (!result) return;
  closeGlobalSearch(false);
  libraryFilter = 'all';
  libraryExpandedDocId = null;
  libraryRevealDocId = result.docId;
  navigateToView('library', { refreshLibrary: false });
  // Focus goes to the row, hence closeGlobalSearch(false) above.
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
 * Cross between the Library's panes. Not paintAndFocus: its saved scrollTop
 * belongs to the pane being left. An open row menu goes with the list.
 */
function setLibraryPane(next: 'list' | 'publish' | 'history', focusSelector: string): void {
  libraryPane = next;
  libraryMenuDocId = null;
  libraryMenuRestore = null;
  paint();
  document.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
  syncLibraryCheckedTimer();
}

function paintAndFocus(selector: string): void {
  const scrollTop = refs.scroll.scrollTop;
  paint();
  refs.scroll.scrollTop = scrollTop;
  document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
}

/** Leaving Frames closes an open font list, whose field is no longer drawn. */
function selectSettingsTab(next: SettingsTab): void {
  if (next !== 'frames') closeFontMenu();
  settingsTab = next;
  paint();
  refs.scroll.scrollTop = 0;
  document.querySelector<HTMLElement>(`[data-settings-tab="${next}"]`)?.focus({ preventScroll: true });
}

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
    // Re-selecting the Library sends nothing; see checkLibrary.
    navigateToView(railView, { refreshLibrary: railView !== view });
    return;
  }

  // Empty-state shortcuts use their own attribute: setRailBadge finds the rail
  // button by [data-view], and a second match would depend on DOM order.
  const emptyNav = target.closest<HTMLButtonElement>('[data-empty-nav]');
  const emptyView = emptyNav?.dataset.emptyNav;
  if (emptyView && isPluginView(emptyView)) {
    navigateToView(emptyView);
    // The clicked button left with its screen; the rail item survives paints.
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
    // Beside the disabled attribute: a probe's reply may start a pass itself.
    if (!operation.active && !libraryProbeInFlight) refreshLibrary();
    return;
  }

  const batchButton = target.closest('[data-library-update-all], [data-library-rebuild-all]');
  if (batchButton) {
    if (libraryProbeInFlight) return;
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
    // Update all takes both kinds of drift; the rebuild banner only stale rows.
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
    // aria-disabled, not disabled, so it holds focus; paint replaces the
    // element, so focus is restored by selector.
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

  // The download block's "Change this in Settings" opens the tab that owns the format.
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
    // With the key here the screen never states what rotating costs, so the
    // confirm does; without it, the screen's own note says so.
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
      case 'sync':
        if (entry?.sourceNodeId) startSync({ kind: 'source', sourceNodeId: entry.sourceNodeId });
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

  // Any other click dismisses the list and still does what it was for.
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

  if (target.closest('[data-sync-file-save]')) {
    const field = document.querySelector<HTMLInputElement>('#sl-sync-file-url');
    saveSyncFileUrl(field?.value ?? '');
    return;
  }

  if (target.closest('[data-sync-file-clear]')) {
    syncFileUrlError = '';
    send({ type: 'setSyncFileUrl', value: '' });
    return;
  }

  if (target.closest('[data-sync-all]')) {
    startSync({ kind: 'all' });
    return;
  }

  // Component and Foundation controls are inert while a build owns UiState.
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
    // At least one diagram stays selected; the last one is aria-disabled.
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
    void copyFoundationBrief(copyPresenter());
    return;
  }

  if (target.closest('#sl-foundation-create')) {
    void buildFoundations();
  }
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  if (input.id === 'sl-sync-on-update') {
    syncOnUpdate = input.checked;
    send({ type: 'setSyncOnUpdate', value: input.checked });
    paintAndFocus('#sl-sync-on-update');
    return;
  }

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
    // Typed text commits on blur or Enter through commitFont, like a picked row.
    commitFont(fontField, input.value);
    return;
  }

  // Below are component controls, which read the UiState a build owns; the
  // Settings controls above touch nothing a build reads.
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
  // The note is a textarea, so it is handled before the HTMLInputElement guard.
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
    // Patched in place; a repaint would rebuild the <input> under the caret.
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
  // A swatch drag mirrors live and persists on close; see applySwatchColor.
  const draggedSwatch = input.dataset.themeSwatch as ColorField | undefined;
  if (draggedSwatch) {
    applySwatchColor(draggedSwatch, input.value, false);
    return;
  }

  // Typing filters the list; only the menu re-renders, so the caret stays. The
  // value still commits on change or Enter.
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

  // A valid hex repaints to update the swatch; no picker is open while typing.
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

  if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'sl-sync-file-url') {
    event.preventDefault();
    saveSyncFileUrl(event.target.value);
    return;
  }

  // Font field: ArrowDown opens the list. Enter with no highlight falls through
  // to change, which commits typed text so an unlisted family stays possible.
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

  // Settings tabs: arrows move and select, Home and End jump; Tab leaves the strip.
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

  // Escape backs out of History and Publish. Last of the Escape handlers: every
  // overlay claims Escape first, so this runs only with nothing layered over.
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
  // The fixed font list follows its field; a row menu, whose row scrolls away,
  // is dismissed instead.
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
  // A failed build's banner survives reselecting the same component and toasts
  // when another selection replaces it unread. Decided here, the one place a
  // selection replaces the screen, so deferred and replayed ones agree.
  const outcome = selectionOutcome(
    screen.kind, state.currentNode?.id, node?.id, Date.now() - failedBuildPaintedAt,
  );
  if (outcome === 'toast' && screen.kind === 'error') {
    nativeNotify(screen.message, { error: true, timeout: 5000 });
  }
  const keepError = outcome === 'keep';
  const keptDraft = draftToKeep(state, node?.id);
  state.currentNode = node;
  state.currentFileKey = msg.fileKey;
  // figma.root.name is main-thread only, so it arrives here or not at all.
  state.currentFileName = msg.fileName ?? '';
  state.currentSpec = null;
  state.currentExtractedAt = '';
  state.generatedProse = null;
  state.generatedProseKeys = null;
  state.pendingAiNote = '';
  facts = node ? componentFacts(null, node.name) : NO_FACTS;
  selection.variantIds.clear();
  // Take this selection's foundation dump at once, so a later Copy or Update
  // reads it rather than the previous one. Absent when main has none or the
  // panel holds this dump (sent once per read, see foundationPost.ts); until
  // one arrives the brief's bindings omit resolved values.
  if (msg.foundation) onSelectionFoundation(msg.foundation);
  if (!node) {
    screen = { kind: 'empty' };
    paint();
    return;
  }
  // Same component: facts are re-read, but the error stays rather than
  // flashing `reading` and settling on `ready`.
  screen = keepError && screen.kind === 'error'
    ? { ...screen, componentName: node.name }
    : { kind: 'reading', componentName: node.name };
  paint();
  autoExtract(
    state,
    () => { /* the reading state is already painted */ },
    () => {
      if (seq !== selectionSeq || state.currentNode?.id !== node.id) return;
      restoreDraft(state, keptDraft);
      facts = componentFacts(state.currentSpec, node.name);
      selection.variantIds = new Set(facts.defaultVariantIds);
      // On only when a boolean property hides parts; seeded here because
      // createComponentSelection runs before extraction.
      selection.includeHidden = defaultIncludeHidden(facts);
      state.includeHidden = selection.includeHidden;
      if (facts.hasStates === true) selection.sections.add('states');
      if (facts.hasStates === false) selection.sections.delete('states');
      screen = keepError && screen.kind === 'error'
        ? { ...screen, componentName: node.name }
        : { kind: 'ready', componentName: node.name };
      paint();
    },
  );
}

const handleMainMessage = (event: MessageEvent): void => {
  const msg = (event.data?.pluginMessage ?? null) as MainToUi | null;
  if (!msg) return;

  switch (msg.type) {
    case 'selection': {
      // A build keeps the component it started with; the newest selection
      // applies when it completes. Main suppresses its own frame selection.
      if (deferSelection(operation)) {
        deferredSelection = msg;
        return;
      }
      applySelection(msg);
      return;
    }

    case 'docFrameDone':
      if (libraryOperation?.kind === 'update' && libraryOperation.currentDocId) {
        libraryOperation.rebuilt.push(msg.docId);
        completeCurrentLibraryUpdate();
        void refreshQuota();
        return;
      }
      {
        stopComponentProgress();
        const note = state.pendingAiNote;
        // Every omission is named, placeholders included; the AI note says why.
        const outcome = omissionsMessage(resultOutcome(Boolean(msg.replaced)), state.lastOmitted);
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
      // A build may have spent an AI use.
      void refreshQuota();
      invalidatePublishAfterChange();
      return;

    case 'docFrameError':
      if (libraryOperation?.kind === 'update' && libraryOperation.currentDocId) {
        finishLibraryOperation(`Couldn’t update this doc. (${msg.message})`);
        return;
      }
      stopComponentProgress();
      // The failure stays on the panel until the next Create or selection: a
      // toast is gone before the reader looks up. Create is the retry; a
      // deferred or replayed selection goes through applySelection.
      screen = failedBuildScreen(currentName(), msg.message);
      failedBuildPaintedAt = Date.now();
      paint();
      completeOperation();
      // renderDocFrame can fail after committing the doc to canvas, and this
      // message cannot say which, so invalidate either way.
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

    case 'syncSettings':
      syncOnUpdate = msg.onUpdate;
      syncFileUrl = msg.fileUrl;
      paint();
      return;

    case 'syncPlan': {
      const next = planNext(msg.plan);
      if (next.kind === 'toast') {
        nativeNotify(next.message, next.error ? { error: true } : {});
        endSync();
      } else if (next.kind === 'replace') {
        offerReplace(msg.scope, next.dialog);
      } else {
        const scope = msg.scope;
        const edited = next.edited;
        void confirmDialog(next.dialog).then((ok) => {
          if (!ok) { endSync(); return; }
          syncPendingEdited = edited;
          send({ type: 'applySync', scope, replaceEdited: false });
        });
      }
      return;
    }

    case 'syncDone': {
      const toast = resultToast(msg.result);
      nativeNotify(toast.message, toast.error ? { error: true } : {});
      if (!msg.replaceEdited && syncPendingEdited.length > 0) {
        const edited = syncPendingEdited;
        syncPendingEdited = [];
        offerReplace(msg.scope, replaceDialog(edited));
      } else {
        endSync();
      }
      return;
    }

    case 'syncError':
      nativeNotify(`Couldn’t sync to Figma: ${msg.message}`, { error: true });
      endSync();
      return;

    case 'brandTheme':
      state.brandTheme = msg.value;
      settingsCustomMode = matchPreset(msg.value) === null;
      if (settingsCustomMode) settingsCustomDraft = { ...msg.value };
      paint();
      return;

    case 'fontList':
      settingsFonts = msg.families;
      // Usually arrives with Settings on show: re-check any typed value and
      // re-render an open menu, which may show the "no fonts" fallback.
      settingsFontWarning = fontFallbackWarning(
        fontMenu ? fontInput(fontMenu.field)?.value.trim() ?? '' : '',
      );
      // Patched, not repainted, so an open list and a typed value are left alone.
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
      // Refresh the copy cache from what landed, for a bulk build or a row Update.
      setFoundationGroupDescriptions(msg.groupDescriptions);
      // A docId means a Library row update; otherwise the bulk Foundation build.
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
        // Nothing landed means the selected sources are gone; said even with an
        // AI note, which alone would leave the empty result unexplained.
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
      // A partial build may have replaced docs `msg.created` does not count, so
      // invalidate either way; the cost is one extra dry run.
      invalidatePublishAfterChange();
      return;

    case 'library':
      libraryProbeInFlight = false;
      libraryRequested = true;
      libraryError = null;
      libraryReadIncomplete = msg.incomplete === true;
      libraryEntries = msg.entries;
      libraryMenuDocId = null;
      startLibraryDriftChecks(pendingLibraryCarry);
      pendingLibraryCarry = null;
      // With no component docs there is no pass to wait for; this reply is the check.
      if (driftQueue.done()) stampLibraryChecked();
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      // Fired from the reply, not navigateToView: only a file with a foundation
      // doc needs the dump, and the prefetch's guard keeps it once per session.
      if (msg.entries.some((entry) => entry.kind === 'foundation')) {
        prefetchFoundationsForCopy();
      }
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    case 'libraryUnchanged':
      libraryProbeInFlight = false;
      // A pass paused by leaving resumes under a new pass id, so main's
      // resolver memo is not one from before the pause.
      if (!driftQueue.done()) {
        driftQueue.resume(newPassId());
        pumpDriftQueue();
      }
      // The probe held Update, Update all and Refresh disabled; give them back.
      paintLibraryDrift();
      return;

    case 'driftSource': {
      if (!settleDriftCheck(msg.docId, msg.passId)) return;
      const baseline = libraryBaseline.get(msg.docId);
      if (baseline === undefined) return;
      // A doc from an older extractor has a different hash projection, so
      // comparing hashes would report drift for the wrong reason.
      if (libraryExtractorVersion.get(msg.docId) !== EXTRACTOR_VERSION) {
        libraryDrift.set(msg.docId, 'staleVersion');
      } else {
        try {
          const started = __DRIFT_TIMING__ ? Date.now() : 0;
          const spec = extract(msg.node, { figmaFile: msg.fileKey, ...(msg.fileName ? { figmaFileName: msg.fileName } : {}) });
          // One projection serves the hash and the later diff, so "Review
          // detected changes" shows the object that decided the badge.
          const projection = specHashProjection(spec, {
            includeHidden: libraryIncludeHidden.get(msg.docId) === true,
          });
          libraryLiveProjection.set(msg.docId, projection);
          libraryDrift.set(
            msg.docId,
            contentHash(projection) === baseline ? 'inSync' : 'drifted',
          );
          if (__DRIFT_TIMING__) console.log(`[Spec Layer] drift hash timing ${msg.docId} ${Date.now() - started}ms`);
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
      if (!settleDriftCheck(msg.docId, msg.passId)) return;
      if (!libraryBaseline.has(msg.docId)) return;
      libraryDrift.set(msg.docId, 'unavailable');
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      paintLibraryDrift();
      return;

    case 'libraryError':
      // A failed read establishes nothing: each row says its check did not run
      // rather than keeping an unconfirmed badge, and Refresh comes back.
      libraryRequested = true;
      libraryRefreshing = false;
      // So a paused pass has nothing to resume.
      driftQueue.clear();
      pendingLibraryCarry = null;
      libraryProbeInFlight = false;
      libraryError = msg.message;
      // Not a partial success, so no "may be missing some docs" note.
      libraryReadIncomplete = false;
      for (const entry of libraryEntries) libraryDrift.set(entry.docId, 'unavailable');
      // A reply still in flight from the failed pass must not find a baseline.
      libraryBaseline.clear();
      libraryChanges.clear();
      syncLibraryBadge();
      if (view === 'library') paint();
      if (searchOpen) renderGlobalSearch();
      return;

    case 'docBaseline': {
      // Only a reply this pass still awaits; a stale one would revive a cleared row.
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
      // Main only echoes the intent; docSource tells Copy from Update by
      // `libraryOperation.kind`, so 'update' is sent here too.
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
        // Copy only reads: no hand-edit confirm, no update, always clears the operation.
        const prose = active.prose ?? null;
        void copyBriefFromSource(state, src, prose, copyPresenter()).finally(() => {
          libraryOperation = null;
          completeOperation();
          if (view === 'library') paint();
        });
        return;
      }
      const runUpdate = (): void => {
        // updateFromSource reports each refusal through this callback; the
        // backstop below keeps an empty one from reading as "Doc updated."
        let preparationError = '';
        // A stale-version rebuild first tops up the sections the old prompt
        // could not write; a plain update sends the source's prose untouched.
        void (async () => {
          let prose = src.prose;
          if (msg.intent === 'rebuild') {
            prose = await topUpProseForRebuild(state, src);
            // Take the note now, for exactly this doc, and clear the slot, so it
            // cannot be reported against another doc or lost to an abort.
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
          // docSource serves only component docs, which have writing sections.
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
      // Publish may already show, drawn before the identity landed; re-enter
      // for the dry run or the first-version field.
      if (view === 'library' && libraryPane === 'publish') onPublishOpen();
      return;

    case 'docDetached':
    case 'docRemoved':
      // It may have been a foundation doc, so refresh the copy cache from the canvas.
      setFoundationGroupDescriptions(msg.groupDescriptions);
      nativeNotify(
        msg.type === 'docDetached'
          ? 'Doc detached. It stays on the canvas but no longer appears in the Library.'
          : 'Doc deleted.',
      );
      // Create would now make a new doc, not replace this one.
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
      invalidatePublishAfterChange();
      return;

    default:
      return;
  }
};

/** `DRIFT_TIMING=1` only: how long the UI held its thread for each message. */
function timedMainMessage(event: MessageEvent): void {
  const type = (event.data?.pluginMessage as { type?: string } | undefined)?.type ?? 'unknown';
  const started = Date.now();
  uiBlocks?.doing(`ui ${type}`);
  try {
    handleMainMessage(event);
  } finally {
    uiBlocks?.done();
    const ms = Date.now() - started;
    if (ms >= 30) console.log(`[Spec Layer] timing ui ${type} took ${ms}ms`);
  }
}

/**
 * No source check: Figma posts main-thread replies from another
 * https://www.figma.com window, not `window.parent` (where `send()` posts,
 * actions.ts), so `event.source === window.parent` drops every reply. Any source
 * or origin check needs a Figma run first (CodeQL js/missing-origin-check).
 */
window.onmessage = __DRIFT_TIMING__ ? timedMainMessage : handleMainMessage;

paintAllowance();
paint();
send({ type: 'requestSelection' });

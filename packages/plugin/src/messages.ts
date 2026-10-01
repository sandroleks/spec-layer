import type {
  SerializedNode, SerializedFoundation, FoundationSelection, FoundationScope, ProseV2,
  SpecHashProjection, FoundationUnitContent,
} from '@spec-layer/extractor';
import type { BrandTheme } from './brandColors';
import type { ComponentFormat } from './componentFormat';
import type { DocFrameModel } from './ui/docModel';
import type { DocConfig, FoundationConfig, DocBaseline } from './docLink';
import type { FoundationIconKind } from './foundationIcon';

/** `update` refreshes the generated lane; `rebuild` is a stale-version rebuild
 *  that may first ask the model for empty sections. Echoed on `docSource`. */
export type DocSourceIntent = 'update' | 'rebuild';

export interface LibraryEntry {
  docId: string;
  kind: 'component' | 'foundation';
  /** Component: the component name. Foundation: "Foundations · Semantic". */
  label: string;
  componentName: string;
  pageName: string;
  sourceLabel: string;
  /** Last successful generation time, from the doc link. */
  generatedAt: number;
  /** '' for foundation docs, which have no source node. */
  sourceNodeId: string;
  sourceExists: boolean;
  selfEdited: boolean;
  storedContentHash: string;
  /** Component rows only: the EXTRACTOR_VERSION that produced this doc. Absent
   *  on older blobs, which the UI treats as stale rather than comparing hashes. */
  extractorVersion?: string;
  /** Component rows only, so drift hashes the same anatomy the baseline was
   *  computed over. Absent reads as false. */
  includeHidden?: boolean;
  /** Foundation rows only: the live hash for this scope. Absent when the live
   *  extraction failed; the row must then not read as drifted. */
  currentContentHash?: string;
  /** Foundation rows only. Only main can read the doc's scope (pluginData), so
   *  the glyph travels with the entry. */
  foundationIcon?: FoundationIconKind;
  /** Foundation rows only: the scope, retargeted to the live collection id.
   *  Copy reads only `target` and `collectionId`; `group` and `modeIds` are
   *  frame limits. Absent from older main threads, so Copy is withheld rather
   *  than guessed. */
  foundationScope?: FoundationScope;
}

/** One component's live source for a publish. `name` is the live node's name,
 *  not the doc's possibly stale label. */
export interface PublishComponentSource {
  docId: string;
  name: string;
  node: SerializedNode;
  prose: ProseV2 | null;
}

export type MainToUi =
  | { type: 'selection'; node: SerializedNode | null; fileKey: string;
      /** `figma.root.name`, which only main can read. Absent means the brief
       *  omits `file_name`. */
      fileName?: string;
      /** Best effort: absent when the dump failed or is not fetched yet, and
       *  the brief's bindings then omit resolved values. */
      foundation?: SerializedFoundation }
  | { type: 'licenseKey'; value: string | null; instanceId: string | null }
  | { type: 'userInfo'; userId: string | null }
  | { type: 'aiEnabled'; value: boolean }
  | { type: 'componentFormat'; value: ComponentFormat }
  | { type: 'brandTheme'; value: BrandTheme }
  | { type: 'fontList'; families: string[] }
  | { type: 'logoCaptured'; base64: string }
  | { type: 'logoCleared' }
  | { type: 'logoError'; message: string }
  | { type: 'componentImage'; base64: string; mediaType: string }
  | { type: 'componentImageError'; message: string }
  /** `docId` is the Section the build placed, a new id whenever it replaced a doc. */
  | { type: 'docFrameDone'; frameName: string; replaced: boolean; docId: string }
  | { type: 'docFrameError'; message: string }
  /** `incomplete` (always `true`) only when the scan failed partway: the rows
   *  are real but docs may be missing, and the self-heal prune did not run. */
  | { type: 'library'; entries: LibraryEntry[]; incomplete?: true }
  /** Reply when the scan failed with no rows; with rows it replies `library`
   *  with `incomplete`. */
  | { type: 'libraryError'; message: string }
  /** Reply to `ifChanged` when nothing changed. The UI keeps its rows and
   *  resumes a paused pass. */
  | { type: 'libraryUnchanged' }
  /** Follows a `selection`, so the selection never waits on the registry scan. */
  | { type: 'selectionDoc'; nodeId: string; hasDoc: boolean }
  /** `groupDescriptions` is the whole-canvas merge re-derived after the change.
   *  Always present, `{}` included: the UI overwrites its cache with it. */
  | { type: 'docDetached'; docId: string; groupDescriptions: Record<string, Record<string, string>> }
  | { type: 'docRemoved'; docId: string; groupDescriptions: Record<string, Record<string, string>> }
  /** specContentHash excludes `fileName`, so drift is unaffected by it. Both
   *  replies echo the pass id so the UI can drop one that outlived its pass
   *  (ui/libraryPass.ts). */
  | { type: 'driftSource'; docId: string; passId: string; node: SerializedNode; fileKey: string; fileName?: string }
  | { type: 'driftError'; docId: string; passId: string }
  /** `prose` is the canvas read back through its editorial tags, the stored
   *  DOC_PROSE_KEY blob filling gaps. Update builds from it, never regenerates. */
  | { type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; fileName?: string; config: DocConfig; selfEdited: boolean; prose: ProseV2 | null; intent: DocSourceIntent }
  | { type: 'docSourceError'; docId: string; message: string }
  /** `groupDescriptions` merges every foundation doc's stored descriptions on
   *  canvas, keyed by collection name then folder path; absent when none has
   *  any. */
  | { type: 'foundation'; dump: SerializedFoundation; groupDescriptions?: Record<string, Record<string, string>> }
  | { type: 'foundationError'; message: string }
  | { type: 'foundationProgress'; done: number; total: number }
  /** Reply for both foundation build paths: `docId` is set only by
   *  `updateFoundationDoc`. The UI must branch on it, not its own in-flight
   *  flag, or a bulk reply is read as a pending row's.
   *
   *  `groupDescriptions` is re-read after every touched Section is stamped,
   *  since the send-time map can exceed what was persisted. The UI replaces
   *  its cache with it outright, `{}` included. */
  | { type: 'foundationDone'; created: number; replaced: number; docId?: string;
      groupDescriptions: Record<string, Record<string, string>> }
  | { type: 'foundationFrameError'; message: string; created: number }
  | { type: 'docProse'; docId: string; prose: ProseV2 | null }
  /** `baseline` is null when the Section is gone or unlinked, or its baseline
   *  is missing, unparsable, or no longer matches the link's contentHash.
   *  Foundation links only: `live` is the current unitContent whose hash made
   *  the badge, null when the scope no longer resolves or the read failed. */
  | { type: 'docBaseline'; docId: string; baseline: DocBaseline | null; live?: FoundationUnitContent | null }
  /** Everything a publish needs, in one pass. Components are deduped so two
   *  docs of one source publish once; `skipped` says why. */
  | { type: 'publishSources'; foundation: SerializedFoundation | null;
      groupDescriptions: Record<string, Record<string, string>>;
      components: PublishComponentSource[];
      skipped: Array<{ name: string; reason: string }>;
      fileKey: string; fileName: string;
      /** Read in the same round trip, so a publish can never outrun the
       *  `publishInfo` reply and mint a duplicate library. */
      publishInfo: PublishInfo }
  | { type: 'publishSourcesError'; message: string }
  /** Nulls when the file was never published; `pullKey` null when this device
   *  lacks it. */
  | ({ type: 'publishInfo' } & PublishInfo);

/** The id lives in the file (root plugin data); the pull key is a secret, so
 *  it lives per user in clientStorage. `publishedAt` is ISO, null when the
 *  publishing build did not record it. */
export interface PublishInfo {
  libraryId: string | null;
  pullKey: string | null;
  publishedAt: string | null;
  /** Semver as the proxy last reported it. Null before the first versioned
   *  publish, or when the publishing build did not record it. */
  version: string | null;
}

/** Both drift hashes, so main picks the one each doc's `includeHidden` needs.
 *  Keyed by source node: two docs of one source are both stamped. */
export interface PublishStampComponent {
  sourceNodeId: string;
  hashes: { visible: string; hidden: string };
}

export type UiToMain =
  | { type: 'requestSelection' }
  | { type: 'notify'; message: string; error?: boolean; timeout?: number }
  | { type: 'openBrowser'; url: string }
  | { type: 'setLicenseKey'; value: string; instanceId: string | null }
  | { type: 'setAiEnabled'; value: boolean }
  | { type: 'setComponentFormat'; value: ComponentFormat }
  | { type: 'setBrandTheme'; value: BrandTheme }
  | { type: 'requestFonts' }
  | { type: 'captureLogo' }
  | { type: 'clearLogo' }
  | { type: 'requestComponentImage'; nodeId: string }
  /** `extractorVersion` produced `contentHash`, so drift can tell "content
   *  changed" from "extractor changed". `prose` is stored so Copy need not
   *  regenerate; absent without AI. `baseline` is the projection `contentHash`
   *  hashed, stored under DOC_BASELINE_KEY for the Library diff; main never
   *  recomputes it. `docId` names the doc an Update replaces; Create omits it. */
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; extractorVersion: string; config: DocConfig; prose?: ProseV2; baseline: SpecHashProjection; docId?: string }
  | { type: 'requestDocProse'; docId: string }
  /** Lazy, sent only when a drifted row expands, to keep `library` lean. */
  | { type: 'requestDocBaseline'; docId: string }
  /** `ifChanged`: scan only if a `nodechange` arrived since the last scan,
   *  else reply `libraryUnchanged`. Absent, the scan always runs. */
  | { type: 'requestLibrary'; ifChanged?: true }
  | { type: 'focusNode'; nodeId: string }
  | { type: 'detachDoc'; docId: string }
  | { type: 'removeDoc'; docId: string }
  /** Main keeps one resolver memo per `passId`, shared by every doc in a
   *  Library check. The UI starts a new id per scan and per resume. */
  | { type: 'requestDrift'; docId: string; sourceNodeId: string; passId: string }
  /** As `passId`, for an update run: one resolver memo, and one Foundation read
   *  and contrast report. */
  | { type: 'requestDocSource'; docId: string; intent: DocSourceIntent; batchId?: string }
  | { type: 'requestFoundation' }
  /** `groupDescriptions` is keyed `collectionId|folder`, since two collections
   *  can share a folder name. Main stores each unit's own keys on its doc. */
  | { type: 'renderFoundation'; selection: FoundationSelection; config: FoundationConfig;
      groupDescriptions?: Record<string, string>;
      /** Keyed by collection id; each collection doc stores its own as
       *  `collectionOverview`. */
      collectionOverviews?: Record<string, string> }
  | { type: 'updateFoundationDoc'; docId: string; batchId?: string }
  | { type: 'requestPublishSources' }
  | { type: 'requestPublishInfo' }
  | { type: 'setPublishInfo'; libraryId: string; pullKey: string }
  /** Ignored when `libraryId` is not the file's, so a slow reply for a dropped
   *  library cannot label the new one. */
  | { type: 'setPublishedAt'; libraryId: string; publishedAt: string }
  /** After a versioned publish: record version and date, stamp every covered
   *  doc and repaint its pill. `foundation` is the published dump, null when
   *  the bundle had none. Ignored like `setPublishedAt`. */
  | { type: 'stampPublished'; libraryId: string; version: string; publishedAt: string;
      components: PublishStampComponent[]; foundation: SerializedFoundation | null }
  /** After the server says the library is gone, so the next publish creates. */
  | { type: 'clearPublishInfo' };

import type { SerializedNode, SerializedFoundation, FoundationSelection, ProseDrafts } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { BrandTheme } from './brandColors';
import type { DocFrameModel } from './ui/docModel';
import type { DocConfig, FoundationConfig } from './docLink';
import type { FoundationIconKind } from './foundationIcon';

/** Why the UI asked for a doc's source: to rebuild the frame in place (Update)
 *  or to save the spec as a bare .md (Download). The main thread echoes it back
 *  on `docSource` so the UI dispatches to the right handler. */
export type DocSourceIntent = 'update';

export interface LibraryEntry {
  docId: string;
  /** Which document type this row is. Absent on no rows: always written. */
  kind: 'component' | 'foundation';
  /** Row label. Component: the component name. Foundation: "Foundations · Semantic". */
  label: string;
  componentName: string;
  pageName: string;
  /** Honest location/source copy for the compact Library identity row. */
  sourceLabel: string;
  /** Last successful generation time, copied from the persisted doc link. */
  generatedAt: number;
  /** '' for foundation docs, which have no source node. */
  sourceNodeId: string;
  sourceExists: boolean;
  selfEdited: boolean;
  storedContentHash: string;
  /** Component rows only: the EXTRACTOR_VERSION that produced this doc, copied
   *  from its doc link. Absent on every blob written before the field existed,
   *  which the UI treats as stale rather than comparing hashes against it. */
  extractorVersion?: string;
  /** Foundation rows only: the live hash for this scope, for drift comparison.
   *  Component rows resolve drift separately via requestDrift. Absent when the
   *  live extraction failed, in which case the row must not read as drifted. */
  currentContentHash?: string;
  /** Foundation rows only: which source glyph the row gets, so a Library row
   *  and the Foundations picker row for the same source look the same. Only the
   *  main thread can answer it — the doc's scope lives in its pluginData — so it
   *  travels with the entry rather than being re-derived in the UI. Absent on
   *  component rows. */
  foundationIcon?: FoundationIconKind;
}

export type MainToUi =
  | { type: 'selection'; node: SerializedNode | null; fileKey: string; fileKeySource: FileKeySource;
      /** The Figma file's name (`figma.root.name`), which only the main thread
       *  can read. It rides this message so the brief can name the file it came
       *  from instead of showing only an opaque key. Optional: a caller with no
       *  name omits it, and the brief omits `file_name` in turn. */
      fileName?: string;
      /** The file's variables/styles, best-effort — absent when the dump
       *  failed to build or hasn't been fetched yet, in which case the
       *  selection still works, and the component brief's token bindings
       *  simply omit resolved values until a foundation dump arrives. */
      foundation?: SerializedFoundation }
  | { type: 'licenseKey'; value: string | null; instanceId: string | null }
  | { type: 'userInfo'; userId: string | null }
  | { type: 'aiEnabled'; value: boolean }
  | { type: 'brandTheme'; value: BrandTheme }
  | { type: 'fontList'; families: string[] }
  | { type: 'logoCaptured'; base64: string }
  | { type: 'logoCleared' }
  | { type: 'logoError'; message: string }
  | { type: 'componentImage'; base64: string; mediaType: string }
  | { type: 'componentImageError'; message: string }
  | { type: 'docFrameDone'; frameName: string; replaced: boolean }
  | { type: 'docFrameError'; message: string }
  | { type: 'library'; entries: LibraryEntry[] }
  /** `groupDescriptions` is the whole-canvas merge, re-derived AFTER the
   *  detach/remove landed, not carried over from any earlier reply. Always
   *  present (possibly `{}`) rather than omitted-when-empty like the
   *  `foundation` message below: the UI must overwrite its copy-time cache
   *  with this value even when it is empty, since "this doc's descriptions
   *  are gone" is exactly the fact an omitted field could not carry. */
  | { type: 'docDetached'; docId: string; groupDescriptions: Record<string, Record<string, string>> }
  | { type: 'docRemoved'; docId: string; groupDescriptions: Record<string, Record<string, string>> }
  /** `fileName` travels with `fileKey` here for the same reason as on
   *  `selection`: every extract() call site should be able to name the file.
   *  Drift itself is unaffected, since specContentHash excludes the name. */
  | { type: 'driftSource'; docId: string; node: SerializedNode; fileKey: string; fileName?: string }
  | { type: 'driftError'; docId: string }
  | { type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; fileName?: string; config: DocConfig; selfEdited: boolean; intent: DocSourceIntent }
  | { type: 'docSourceError'; docId: string; message: string }
  /** `groupDescriptions` merges every foundation doc link's stored group
   *  descriptions found on canvas, keyed by collection name then folder path.
   *  Absent when no foundation doc carries any (including every file with no
   *  foundation doc at all). Read by copyFoundationBrief, never generated
   *  from this dump's tokens themselves. */
  | { type: 'foundation'; dump: SerializedFoundation; groupDescriptions?: Record<string, Record<string, string>> }
  | { type: 'foundationError'; message: string }
  | { type: 'foundationProgress'; done: number; total: number }
  /** Reply for BOTH foundation build paths. `docId` is what tells them apart:
   *  set only by `updateFoundationDoc` (one My Library row), absent on the
   *  Foundations tab's bulk `renderFoundation`. The UI must branch on this and
   *  not on its own in-flight flag, or a bulk reply arriving while a row Update
   *  is pending gets read as that row's.
   *
   *  `groupDescriptions` is the whole-canvas merge re-read after every Section
   *  this build touched already has its final `groupDescriptions` stamped in
   *  (a build's own send-time map can be a strict superset of what actually
   *  got persisted per unit, so this reply is the only truthful source). The
   *  UI must replace its copy-time cache with this value outright, even when
   *  it is `{}` — this is what fixes generate-then-copy in the same session
   *  without a manual "Refresh sources". */
  | { type: 'foundationDone'; created: number; replaced: number; docId?: string;
      groupDescriptions: Record<string, Record<string, string>> }
  | { type: 'foundationFrameError'; message: string; created: number }
  | { type: 'docProse'; docId: string; prose: ProseDrafts | null };

export type UiToMain =
  | { type: 'requestSelection' }
  | { type: 'notify'; message: string; error?: boolean; timeout?: number }
  | { type: 'openBrowser'; url: string }
  | { type: 'setLicenseKey'; value: string; instanceId: string | null }
  | { type: 'setAiEnabled'; value: boolean }
  | { type: 'setBrandTheme'; value: BrandTheme }
  | { type: 'requestFonts' }
  | { type: 'captureLogo' }
  | { type: 'clearLogo' }
  | { type: 'requestComponentImage'; nodeId: string }
  /** `extractorVersion` is the EXTRACTOR_VERSION that produced `contentHash`,
   *  stamped onto the persisted doc link so a later drift check can tell
   *  "content changed" apart from "extractor changed". Always sent: every UI
   *  build knows its own EXTRACTOR_VERSION. */
  /** `prose` is the generated guidelines this build used, stored beside the doc
   *  link so a later Copy can include them without paying to regenerate. Absent
   *  when the build ran without AI. */
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; extractorVersion: string; config: DocConfig; prose?: ProseDrafts }
  | { type: 'requestDocProse'; docId: string }
  | { type: 'requestLibrary' }
  | { type: 'focusNode'; nodeId: string }
  | { type: 'detachDoc'; docId: string }
  | { type: 'removeDoc'; docId: string }
  | { type: 'requestDrift'; docId: string; sourceNodeId: string }
  | { type: 'requestDocSource'; docId: string; intent: DocSourceIntent }
  | { type: 'requestFoundation' }
  /** `groupDescriptions` is keyed `collectionId|folder`, because two collections
   *  in one build can hold a folder of the same name. The main thread filters
   *  each unit's own keys out of it and stores them on that doc. */
  | { type: 'renderFoundation'; selection: FoundationSelection; config: FoundationConfig;
      groupDescriptions?: Record<string, string> }
  | { type: 'updateFoundationDoc'; docId: string };

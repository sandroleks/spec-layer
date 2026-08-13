import type { SerializedNode, SerializedFoundation, FoundationSelection } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { BrandTheme } from './brandColors';
import type { DocFrameModel } from './ui/docModel';
import type { DocConfig, FoundationConfig } from './docLink';
import type { FoundationIconKind } from './foundationIcon';

/** Why the UI asked for a doc's source: to rebuild the frame in place (Update)
 *  or to save the spec as a bare .md (Download). The main thread echoes it back
 *  on `docSource` so the UI dispatches to the right handler. */
export type DocSourceIntent = 'update' | 'download';

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
  /** Component rows only: the extractor format that produced this doc, copied
   *  from its doc link. Absent on every blob written before spec_version 0.2,
   *  which the UI treats as stale rather than comparing hashes against it. */
  specVersion?: string;
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
  | { type: 'selection'; node: SerializedNode | null; fileKey: string; fileKeySource: FileKeySource }
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
  | { type: 'docDetached'; docId: string }
  | { type: 'docRemoved'; docId: string }
  | { type: 'driftSource'; docId: string; node: SerializedNode; fileKey: string }
  | { type: 'driftError'; docId: string }
  | { type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; config: DocConfig; selfEdited: boolean; intent: DocSourceIntent }
  | { type: 'docSourceError'; docId: string; message: string }
  | { type: 'foundation'; dump: SerializedFoundation }
  | { type: 'foundationError'; message: string }
  | { type: 'foundationProgress'; done: number; total: number }
  /** Reply for BOTH foundation build paths. `docId` is what tells them apart:
   *  set only by `updateFoundationDoc` (one My Library row), absent on the
   *  Foundations tab's bulk `renderFoundation`. The UI must branch on this and
   *  not on its own in-flight flag, or a bulk reply arriving while a row Update
   *  is pending gets read as that row's. */
  | { type: 'foundationDone'; created: number; replaced: number; docId?: string }
  | { type: 'foundationFrameError'; message: string; created: number };

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
  /** `specVersion` is the extractor format (`SPEC_VERSION`) that produced
   *  `contentHash`, stamped onto the persisted doc link so a later drift
   *  check can tell "content changed" apart from "extractor changed". Always
   *  sent: every UI build knows its own SPEC_VERSION. */
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; specVersion: string; config: DocConfig }
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

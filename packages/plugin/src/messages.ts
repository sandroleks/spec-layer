import type { SerializedNode } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { DocFrameModel } from './ui/docModel';

export type MainToUi =
  | { type: 'selection'; node: SerializedNode | null; fileKey: string; fileKeySource: FileKeySource }
  | { type: 'docsEndpoint'; value: string | null }
  // `value` is the stored override (for the settings input); `effectiveFileKey`
  // is the key computed by the main thread (figma.fileKey, falling back to the
  // override) — the UI displays/uses it and never re-derives precedence.
  | { type: 'fileKeyOverride'; value: string | null; effectiveFileKey: string; fileKeySource: FileKeySource }
  // -----------------------------------------------------------------------
  // Bulk export stream — sent in response to 'requestExportAll'.
  // exportAllScanning is posted FIRST, before the (potentially slow) whole-file
  // enumeration (loadAllPagesAsync + findAllWithCriteria), so the UI can show
  // activity during a phase that would otherwise be silent.
  // exportAllStart carries the authoritative fileKey (main-thread computed)
  // so the UI can use it even when no component is currently selected.
  // exportComponent uses 1-based index (1 … total).
  // -----------------------------------------------------------------------
  | { type: 'exportAllScanning' }
  | { type: 'exportAllStart'; total: number; fileKey: string; skippedAtoms: number }
  | { type: 'exportComponent'; index: number; total: number; node: SerializedNode }
  | { type: 'exportAllDone' }
  | { type: 'exportAllError'; message: string }
  | { type: 'anthropicKey'; value: string | null }
  | { type: 'componentImage'; base64: string; mediaType: string }
  | { type: 'componentImageError'; message: string }
  | { type: 'docFrameDone'; frameName: string }
  | { type: 'docFrameError'; message: string };

export type UiToMain =
  | { type: 'requestSelection' }
  | { type: 'setDocsEndpoint'; value: string }
  | { type: 'setFileKeyOverride'; value: string | null }
  | { type: 'notify'; message: string }
  | { type: 'openBrowser'; url: string }
  | { type: 'requestExportAll'; includeAtoms: boolean }
  | { type: 'setAnthropicKey'; value: string | null }
  | { type: 'requestComponentImage'; nodeId: string }
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string };

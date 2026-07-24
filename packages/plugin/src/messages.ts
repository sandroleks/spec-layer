import type { SerializedNode } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { BrandTheme } from './brandColors';
import type { DocFrameModel } from './ui/docModel';
import type { DocConfig } from './docLink';

/** Why the UI asked for a doc's source: to rebuild the frame in place (Update)
 *  or to save the spec as a bare .md (Download). The main thread echoes it back
 *  on `docSource` so the UI dispatches to the right handler. */
export type DocSourceIntent = 'update' | 'download';

export interface LibraryEntry {
  docId: string;
  componentName: string;
  pageName: string;
  sourceNodeId: string;
  sourceExists: boolean;
  selfEdited: boolean;
  storedContentHash: string;
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
  | { type: 'docSourceError'; docId: string; message: string };

export type UiToMain =
  | { type: 'requestSelection' }
  | { type: 'notify'; message: string }
  | { type: 'openBrowser'; url: string }
  | { type: 'setLicenseKey'; value: string; instanceId: string | null }
  | { type: 'setAiEnabled'; value: boolean }
  | { type: 'setBrandTheme'; value: BrandTheme }
  | { type: 'requestFonts' }
  | { type: 'captureLogo' }
  | { type: 'clearLogo' }
  | { type: 'requestComponentImage'; nodeId: string }
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; config: DocConfig }
  | { type: 'requestLibrary' }
  | { type: 'focusNode'; nodeId: string }
  | { type: 'detachDoc'; docId: string }
  | { type: 'removeDoc'; docId: string }
  | { type: 'requestDrift'; docId: string; sourceNodeId: string }
  | { type: 'requestDocSource'; docId: string; intent: DocSourceIntent };

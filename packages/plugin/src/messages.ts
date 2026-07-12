import type { SerializedNode } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { BrandTheme } from './brandColors';
import type { DocFrameModel } from './ui/docModel';
import type { DocConfig } from './docLink';

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
  | { type: 'docFrameDone'; frameName: string }
  | { type: 'docFrameError'; message: string };

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
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; config: DocConfig };

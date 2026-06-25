import type { SerializedNode } from '@spec-layer/extractor';
import type { FileKeySource } from './fileKey';
import type { BrandColors } from './brandColors';
import type { DocFrameModel } from './ui/docModel';

export type MainToUi =
  | { type: 'selection'; node: SerializedNode | null; fileKey: string; fileKeySource: FileKeySource }
  | { type: 'anthropicKey'; value: string | null }
  | { type: 'aiEnabled'; value: boolean }
  | { type: 'brandColors'; value: BrandColors }
  | { type: 'componentImage'; base64: string; mediaType: string }
  | { type: 'componentImageError'; message: string }
  | { type: 'docFrameDone'; frameName: string }
  | { type: 'docFrameError'; message: string };

export type UiToMain =
  | { type: 'requestSelection' }
  | { type: 'notify'; message: string }
  | { type: 'openBrowser'; url: string }
  | { type: 'setAnthropicKey'; value: string | null }
  | { type: 'setAiEnabled'; value: boolean }
  | { type: 'setBrandColors'; value: BrandColors }
  | { type: 'requestComponentImage'; nodeId: string }
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string };

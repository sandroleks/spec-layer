/** A Figma node serialized by the plugin main thread. Pure JSON. */
export interface SerializedNode {
  id: string;
  name: string;
  type: string; // COMPONENT_SET | COMPONENT | INSTANCE | FRAME | TEXT | ...
  visible: boolean;
  children?: SerializedNode[];
  /** Present on COMPONENT_SET (or standalone COMPONENT). */
  propertyDefinitions?: Record<string, PropertyDefinition>;
  /** Variable bindings, resolved to token names: e.g. { property: "fills", token: "md.sys.color.primary" } */
  bindings?: TokenRef[];
  /** True when a paint is hardcoded (no variable/style) — feeds the gaps report. */
  hasUnboundPaint?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID fill (set only when hasUnboundPaint). */
  unboundFill?: string;
  /** For INSTANCE nodes: the main component's name and key. */
  mainComponent?: { name: string; key: string };
  /** Stable component key (COMPONENT/COMPONENT_SET only). */
  key?: string;
  /** Auto-layout/shape values for this node, when present. */
  layout?: LayoutInfo;
}

export interface PropertyDefinition {
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

export interface TokenRef {
  property: string; // fills | strokes | itemSpacing | cornerRadius | ...
  token: string;    // resolved variable or style name
}

/** Auto-layout and shape values captured from the Figma node (only values > 0 are present). */
export interface LayoutInfo {
  mode?: 'HORIZONTAL' | 'VERTICAL';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  cornerRadius?: number;
}

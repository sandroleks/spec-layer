/** A Figma node serialized by the plugin main thread. Pure JSON. */
export interface SerializedNode {
  id: string;
  name: string;
  type: string; // COMPONENT_SET | COMPONENT | INSTANCE | FRAME | TEXT | ...
  visible: boolean;
  children?: SerializedNode[];
  /** Present on COMPONENT_SET (or standalone COMPONENT). */
  propertyDefinitions?: Record<string, PropertyDefinition>;
  /** Variable and style bindings with the identity Figma stated for each:
   *  e.g. { property: "fills", id: "VariableID:7", name: "md.sys.color.primary",
   *  kind: "variable", remote: false }. */
  bindings?: TokenRef[];
  /** True when a paint is hardcoded (no variable/style) — feeds the gaps report. */
  hasUnboundPaint?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID fill (set only when hasUnboundPaint). */
  unboundFill?: string;
  /** True when a stroke paint is hardcoded (no variable/style). */
  hasUnboundStroke?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID stroke (set only when hasUnboundStroke). */
  unboundStroke?: string;
  /** True when a GRADIENT_* or IMAGE fill carries no style. */
  hasUnboundGradient?: boolean;
  /** True when the node has effects but no effect style and no bound effect. */
  hasUnboundEffect?: boolean;
  /** Node opacity when it is not 1 (hand-set or bound). */
  opacity?: number;
  /** For INSTANCE nodes: the main component's name and key. */
  mainComponent?: { name: string; key: string };
  /** Stable component key (COMPONENT/COMPONENT_SET only). */
  key?: string;
  /** Auto-layout/shape values for this node, when present. */
  layout?: LayoutInfo;
  /** TEXT nodes only: font size/weight, kept for a future WCAG contrast
   *  threshold lookup (see contrast.ts's requiredRatio). No current reader. */
  text?: { fontSize?: number; fontWeight?: number };
}

export interface PropertyDefinition {
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

/** What kind of Figma resource a binding names. A closed set: `getStyleByIdAsync`
 *  can also return a GRID style, but no node property this file reads produces a
 *  grid binding, so a grid style never becomes a TokenRef. */
export type RefKind = 'variable' | 'paint-style' | 'text-style' | 'effect-style';

/**
 * A resolved reference to one Figma resource, with everything Figma stated
 * about it. Shared by node bindings (TokenRef), minimized rules (TokenRule) and
 * per-field effect bindings, so all three answer the same questions the same way.
 */
export interface RefIdentity {
  /** Figma id. Drives resolution. Never emitted: the brief's rule is that
   *  internal ids stay inside. */
  id: string;
  /** Display and join identity, as `token` was. */
  name: string;
  kind: RefKind;
  /** Figma's own answer (Variable.remote / PublishableMixin.remote), not
   *  inferred from a failed lookup. */
  remote: boolean;
  /** Variables only. */
  collectionId?: string;
}

/** A binding on one node: an identity plus the property it is bound to. */
export interface TokenRef extends RefIdentity {
  property: string; // fills | strokes | itemSpacing | cornerRadius | ...
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

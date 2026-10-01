import type { EffectLayer } from './effects';

/** A Figma node serialized by the plugin main thread. Pure JSON. */
export interface SerializedNode {
  id: string;
  name: string;
  type: string; // COMPONENT_SET | COMPONENT | INSTANCE | FRAME | TEXT | ...
  visible: boolean;
  /** Raw key (with `#id` suffix) from `componentPropertyReferences.visible`,
   *  so the main thread can address the property exactly when configuring an
   *  instance; clean it with `cleanPropName` before showing it. */
  visibleProperty?: string;
  children?: SerializedNode[];
  /** Present on COMPONENT_SET (or standalone COMPONENT). */
  propertyDefinitions?: Record<string, PropertyDefinition>;
  /** e.g. { property: "fills", id: "VariableID:7", name: "md.sys.color.primary",
   *  kind: "variable", remote: false }. */
  bindings?: TokenRef[];
  /** A paint is hardcoded (no variable/style); feeds the gaps report. */
  hasUnboundPaint?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID fill (set only when hasUnboundPaint). */
  unboundFill?: string;
  hasUnboundStroke?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID stroke (set only when hasUnboundStroke). */
  unboundStroke?: string;
  /** A GRADIENT_* or IMAGE fill carries no style. */
  hasUnboundGradient?: boolean;
  /** Effects with no effect style and no bound effect. */
  hasUnboundEffect?: boolean;
  /** What an unbound-effect gap is made of. Excluded from specContentHash,
   *  same contract as rawValues. */
  effects?: EffectLayer[];
  /** Node opacity when it is not 1 (hand-set or bound). */
  opacity?: number;
  /** For INSTANCE nodes: the main component's name and key. */
  mainComponent?: { name: string; key: string };
  /** Stable component key (COMPONENT/COMPONENT_SET only). */
  key?: string;
  /** COMPONENT or COMPONENT_SET root only. Rendered on canvas, so hashed.
   *  Absent when empty. */
  description?: string;
  /** Absent when there are none. */
  documentationLinks?: string[];
  layout?: LayoutInfo;
  /** TEXT nodes only, for a future WCAG threshold lookup (contrast.ts's
   *  requiredRatio). No current reader. */
  text?: { fontSize?: number; fontWeight?: number };
}

export interface PropertyDefinition {
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

/** A closed set: `getStyleByIdAsync` can return a GRID style, but no property
 *  read here produces a grid binding. */
export type RefKind = 'variable' | 'paint-style' | 'text-style' | 'effect-style';

/** A resolved reference to one Figma resource, shared by TokenRef, TokenRule
 *  and per-field effect bindings. */
export interface RefIdentity {
  /** Figma id; drives resolution. Never emitted by the legacy component-v4 brief. */
  id: string;
  /** Display and join identity. */
  name: string;
  kind: RefKind;
  /** Figma's own answer (`remote`), never inferred from a failed lookup. */
  remote: boolean;
  /** Variables only. */
  collectionId?: string;
}

export interface TokenRef extends RefIdentity {
  property: string; // fills | strokes | itemSpacing | cornerRadius | ...
}

/** Only values > 0 are present. */
export interface LayoutInfo {
  mode?: 'HORIZONTAL' | 'VERTICAL';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  cornerRadius?: number;
}

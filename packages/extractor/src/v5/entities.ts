/**
 * The artifact's typed entities (spec §6, §7, §8, §11, §12, §13). The schema,
 * validator, normalizer and every consumer share these declarations, so the
 * compiler keeps them in agreement. Optional metadata stays absent when Figma
 * exposes no truthful value.
 */
import type {
  CanonicalValue, ColorValue, DimensionValue, TokenType, TypedValue,
} from './value';

/** §6: id is identity, name and path are source text, and a generated code
 *  name may sit beside them but never replace them. */
export interface EntityIdentity {
  id: string;
  name: string;
  path: string[];
  suggested_code_name?: string;
}

export interface ModeV5 { id: string; name: string; order: number }

export interface PublicationState { published: boolean; hidden_from_publishing: boolean }

export interface SourceState {
  remote: boolean;
  library_file_id: string | null;
  library_name: string | null;
  modified_at: string | null;
}

export type LifecycleStatus = 'active' | 'deprecated' | 'archived';
export interface LifecycleState { status: LifecycleStatus; replacement_id: string | null }

export interface CollectionV5 extends EntityIdentity {
  default_mode_id: string;
  modes: ModeV5[];
  publication?: PublicationState;
  source?: SourceState;
}

export interface TokenV5 extends EntityIdentity {
  collection_id: string;
  type: TokenType;
  /** Required, and an empty string is a legal value: §8.2 distinguishes "has no
   *  description" from "the field was not exported". */
  description: string;
  scopes: string[];
  /** Figma's per-platform code syntax keyed by platform (`WEB`, `ANDROID`,
   *  `iOS`), absent when none is declared. A cross-check for a code
   *  identifier, never the source of a name. Schema 5.1.0. */
  code_syntax?: Record<string, string>;
  publication?: PublicationState;
  lifecycle?: LifecycleState;
  /** Keyed by MODE ID, never by mode display name. §7. */
  values: Record<string, CanonicalValue>;
}

/** §11: a style property keeps its binding and its resolved value, so a
 *  consumer generates from the value while a differ still sees a binding move. */
export interface StyleProperty {
  source:
    | { kind: 'literal' }
    | { kind: 'alias'; target_id: string | null; target_path: string[] };
  resolved: TypedValue | null;
}

export interface TypographyStyleV5 extends EntityIdentity {
  description: string;
  publication?: PublicationState;
  source?: SourceState;
  lifecycle?: LifecycleState;
  properties: {
    font_family: StyleProperty;
    font_weight: StyleProperty;
    font_size: StyleProperty;
    line_height: StyleProperty;
    letter_spacing: StyleProperty;
    paragraph_spacing: StyleProperty;
    paragraph_indent: StyleProperty;
    text_case: string;
    text_decoration: string;
  };
}

export type EffectKind = 'drop_shadow' | 'inner_shadow' | 'layer_blur' | 'background_blur';

export interface EffectV5 {
  type: EffectKind;
  visible: boolean;
  /** Shadows expose a blend mode; Figma blur effects do not. */
  blend_mode?: string;
  color?: ColorValue;
  offset_x?: DimensionValue;
  offset_y?: DimensionValue;
  blur?: DimensionValue;
  spread?: DimensionValue;
  show_behind_node?: boolean;
}

/** §12: a scalar variable and the composite property it drives. `property` is
 *  a path like `effects[0].offset_y`. */
export interface StyleBinding { property: string; token_id: string }

export interface EffectStyleV5 extends EntityIdentity {
  /** The mode the values were read under, or null for a file with no variable
   *  modes. Stated, not implied, as token values are keyed by mode id. */
  mode_id: string | null;
  effects: EffectV5[];
  bindings?: StyleBinding[];
  publication?: PublicationState;
  source?: SourceState;
  lifecycle?: LifecycleState;
}

/** `styles` is `complete` only for a file with no typography or effect styles.
 *  Otherwise `partial` or `unavailable` (`completenessOf` in
 *  `fromFoundation.ts`), each cause named by a root diagnostic:
 *  METADATA_UNAVAILABLE (Figma exposes no publication state, lifecycle or
 *  consuming mode for existing styles; always `partial`),
 *  SOURCE_PARTIALLY_UNAVAILABLE (one style kind failed to read; `partial`, or
 *  `unavailable` when both failed), or EXPORT_SCOPED (a collection scope is
 *  `unavailable`; a style-family scope is `partial` or `unavailable` by whether
 *  that family's read succeeded). The schema's `completeness.styles` agrees. */
export type Completeness = 'complete' | 'partial' | 'unavailable';

/**
 * What this export was able to read, and why the content hash covers more than
 * the payload: a silent read failure and a read that found nothing yield the
 * same collections, tokens and styles, so hashing this block keeps them apart.
 * Machine-readable because the prose diagnostic stays out of the hash (a reword
 * must not change identity). `unavailable_sources` holds stable ids or library
 * names sorted by code unit, so two exports failing on one library agree byte
 * for byte.
 */
export interface ExtractionCompleteness {
  collections: Completeness;
  styles: Completeness;
  unavailable_sources: string[];
}

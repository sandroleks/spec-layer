/**
 * The artifact's typed entities — spec §6, §7, §8, §11, §12, §13.
 *
 * Concrete types, not `unknown[]`. The schema, the validator, the normalizer
 * and every consumer share exactly these declarations, which is the only way
 * the four can be kept in agreement by the compiler rather than by discipline.
 *
 * Typography and effect entities are populated by the direct Foundation
 * exporter. The optional metadata stays absent when Figma exposes no truthful
 * value for it.
 */
import type {
  CanonicalValue, ColorValue, DimensionValue, TokenType, TypedValue,
} from './value';

/** §6 — id is identity, name and path are source text, and a generated code
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
  publication?: PublicationState;
  lifecycle?: LifecycleState;
  /** Keyed by MODE ID, never by mode display name. §7. */
  values: Record<string, CanonicalValue>;
}

/** §11 — a style property keeps its binding AND its resolved value, so a
 *  consumer can generate from the resolved value while a differ can still see
 *  that the binding moved. */
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

/** §12 — the explicit relationship between a scalar variable and the composite
 *  property it drives. `property` is a path like `effects[0].offset_y`. */
export interface StyleBinding { property: string; token_id: string }

export interface EffectStyleV5 extends EntityIdentity {
  /** The mode this style's values were read under, or null for a file with no
   *  variable modes. Stated rather than implied, for the same reason token
   *  values are keyed by mode id. */
  mode_id: string | null;
  effects: EffectV5[];
  bindings?: StyleBinding[];
  publication?: PublicationState;
  source?: SourceState;
  lifecycle?: LifecycleState;
}

export type Completeness = 'complete' | 'partial' | 'unavailable';

/**
 * What this export was actually able to read — and the reason the content hash
 * covers more than the payload.
 *
 * A read failure, an unavailable library, or a permission error is NOT
 * derivable from the data that survived: an export that silently failed to read
 * a library and one that read it and found nothing produce the same
 * `collections`, `tokens` and `styles`, and would hash identically. Hashing
 * this block is what makes those two exports different artifacts.
 *
 * Machine-readable on purpose. The prose diagnostic that accompanies a failure
 * stays OUT of the hash -- rewording a message must not change an artifact's
 * identity -- so the fact has to be carried in a form a reword cannot touch.
 *
 * `unavailable_sources` holds stable ids or library names, sorted by code unit,
 * so two exports failing on the same library agree byte for byte.
 */
export interface ExtractionCompleteness {
  collections: Completeness;
  styles: Completeness;
  unavailable_sources: string[];
}

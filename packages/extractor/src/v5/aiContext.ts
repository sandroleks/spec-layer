/**
 * Compact Foundation Context for an AI coding agent.
 *
 * FoundationArtifactV5 is the audit/interchange contract: stable ids, segmented
 * paths, typed value envelopes, complete alias provenance, diagnostics prose,
 * and derived statistics are intentionally explicit. That makes it excellent
 * for validation and diffing, but expensive clipboard context.
 *
 * This module is a presentation projection of an already-finished artifact.
 * It keeps the facts an implementation agent needs, uses human-readable names
 * for references, and points back to the canonical artifact with its semantic
 * content hash. It is not a second interchange contract and must never feed a
 * semantic hash or a canvas drift hash.
 */
import type { FoundationArtifactV5 } from './canonical';
import { compareCodeUnits } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, LifecycleState, PublicationState,
  StyleProperty, TokenV5, TypographyStyleV5,
} from './entities';
import type {
  AliasReference, CanonicalValue, ResolutionStep, TokenType, TypedValue,
} from './value';

type AiScalar = string | number | boolean | null;
type AiValue = AiScalar | AiValue[] | { [key: string]: AiValue | undefined };

export interface FoundationAiContext {
  spec_layer: {
    kind: 'foundation';
    version: 5;
    profile: 'ai';
    content_hash: string;
    source: { provider: 'figma'; file_name?: string };
  };
  completeness: FoundationArtifactV5['completeness'];
  collections: FoundationAiCollection[];
  styles: {
    typography: AiValue[];
    effects: AiValue[];
  };
  issue_counts?: Record<string, Record<string, number>>;
  guidelines?: Record<string, Record<string, string>>;
}

export interface FoundationAiCollection {
  name: string;
  source_id?: string;
  suggested_code_name?: string;
  publication?: PublicationState;
  source?: { remote: boolean; library_name?: string };
  default_mode: string;
  modes: string[];
  tokens: FoundationAiToken[];
}

export interface FoundationAiToken {
  name: string;
  source_id?: string;
  suggested_code_name?: string;
  type: TokenType;
  description?: string;
  scopes?: string[];
  publication?: PublicationState;
  lifecycle?: { status: LifecycleState['status']; replacement?: string };
  values: Record<string, AiValue>;
}

interface ProjectionIndex {
  collectionById: Map<string, CollectionV5>;
  tokenById: Map<string, TokenV5>;
  collectionLabelById: Map<string, string>;
  tokenLabelById: Map<string, string>;
  entityLabelById: Map<string, string>;
  modeLabelByCollectionAndId: Map<string, Map<string, string>>;
  ambiguousEntityIds: Set<string>;
}

/** Prefer source names, add ids only to duplicate names, then fall back to an
 * id-first label for the whole namespace if a source name itself imitates the
 * generated suffix. The last branch is what makes map keys provably unique. */
function readableLabels<T>(
  items: T[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = nameOf(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const preferred = items.map((item) => {
    const id = idOf(item);
    const name = nameOf(item);
    return [id, counts.get(name) === 1 ? name : `${name} [${id}]`] as const;
  });
  if (new Set(preferred.map(([, label]) => label)).size === preferred.length) {
    return new Map(preferred);
  }
  return new Map(items.map((item) => [
    idOf(item), `[${idOf(item)}] ${nameOf(item)}`,
  ]));
}

function buildIndex(artifact: FoundationArtifactV5): ProjectionIndex {
  const collectionById = new Map(artifact.collections.map((collection) => [collection.id, collection]));
  const tokenById = new Map(artifact.tokens.map((token) => [token.id, token]));
  const collectionLabelById = readableLabels(
    artifact.collections, ({ id }) => id, ({ name }) => name,
  );
  const ambiguousEntityIds = new Set<string>();
  for (const collection of artifact.collections) {
    if (collectionLabelById.get(collection.id) !== collection.name) {
      ambiguousEntityIds.add(collection.id);
    }
  }

  const tokenLabelById = new Map<string, string>();
  for (const collection of artifact.collections) {
    const tokens = artifact.tokens.filter((token) => token.collection_id === collection.id);
    const localLabels = readableLabels(tokens, ({ id }) => id, ({ name }) => name);
    const collectionLabel = collectionLabelById.get(collection.id) ?? collection.name;
    for (const token of tokens) {
      const tokenLabel = localLabels.get(token.id) ?? token.name;
      if (tokenLabel !== token.name) ambiguousEntityIds.add(token.id);
      tokenLabelById.set(token.id, `${collectionLabel}/${tokenLabel}`);
    }
  }

  const entityLabelById = new Map(tokenLabelById);
  const addStyleLabels = (
    kind: string,
    styles: Array<TypographyStyleV5 | EffectStyleV5>,
  ): void => {
    const labels = readableLabels(styles, ({ id }) => id, ({ name }) => name);
    for (const style of styles) {
      const label = labels.get(style.id) ?? style.name;
      if (label !== style.name) ambiguousEntityIds.add(style.id);
      entityLabelById.set(style.id, `${kind}/${label}`);
    }
  };
  addStyleLabels('Typography', artifact.styles.typography);
  addStyleLabels('Effects', artifact.styles.effects);

  const modeLabelByCollectionAndId = new Map<string, Map<string, string>>();
  for (const collection of artifact.collections) {
    modeLabelByCollectionAndId.set(collection.id, readableLabels(
      collection.modes, ({ id }) => id, ({ name }) => name,
    ));
  }

  return {
    collectionById, tokenById, collectionLabelById,
    tokenLabelById, entityLabelById, modeLabelByCollectionAndId,
    ambiguousEntityIds,
  };
}

function compactTypedValue(value: TypedValue, expectedType?: TokenType): AiValue {
  let compact: AiValue;
  switch (value.type) {
    case 'color':
      compact = value.alpha === 1 && value.channels === undefined
        ? value.hex
        : {
            hex: value.hex,
            ...(value.alpha !== 1 ? { alpha: value.alpha } : {}),
            ...(value.channels ? { channels: [...value.channels] } : {}),
          };
      break;
    case 'dimension':
    case 'duration':
      compact = { number: value.number, unit: value.unit };
      break;
    case 'cubic_bezier':
      compact = [...value.value];
      break;
    case 'number':
    case 'string':
    case 'boolean':
    case 'font_family':
      compact = value.value;
      break;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
  return expectedType !== undefined && value.type !== expectedType
    ? { type: value.type, value: compact }
    : compact;
}

function referenceLabel(reference: AliasReference, index: ProjectionIndex): string {
  if (reference.target_id !== null) {
    const local = index.tokenLabelById.get(reference.target_id);
    if (local !== undefined) return local;
  }
  const path = reference.target_path.length > 0
    ? reference.target_path.join('/')
    : reference.target_id ?? '<unknown target>';
  return reference.source_library_name
    ? `${reference.source_library_name}/${path}`
    : path;
}

function stepLabel(step: ResolutionStep, index: ProjectionIndex): string {
  const token = index.tokenById.get(step.token_id);
  if (token === undefined) return `${step.token_id} @ ${step.mode_id}`;
  const tokenLabel = index.tokenLabelById.get(token.id) ?? token.name;
  const modeLabel = index.modeLabelByCollectionAndId
    .get(token.collection_id)?.get(step.mode_id) ?? step.mode_id;
  return `${tokenLabel} @ ${modeLabel}`;
}

function compactCanonicalValue(
  value: CanonicalValue,
  expectedType: TokenType,
  index: ProjectionIndex,
): AiValue {
  if (value.kind === 'literal') return compactTypedValue(value.value, expectedType);
  if (value.kind === 'missing') return { missing: value.reason };

  const chain = value.resolved.chain.map((step) => stepLabel(step, index));
  const firstStep = value.resolved.chain[0];
  const alias = firstStep !== undefined && firstStep.token_id === value.reference.target_id
    ? stepLabel(firstStep, index)
    : referenceLabel(value.reference, index);
  return {
    alias,
    ...(value.resolved.status === 'resolved'
      ? { resolved: compactTypedValue(value.resolved.value, expectedType) }
      : { unresolved: value.resolved.reason }),
    ...(chain.length > 1 || (value.resolved.status === 'unresolved' && chain.length > 0)
      ? { chain }
      : {}),
  };
}

function compactLifecycle(
  lifecycle: LifecycleState | undefined,
  index: ProjectionIndex,
): FoundationAiToken['lifecycle'] | undefined {
  if (lifecycle === undefined) return undefined;
  const replacement = lifecycle.replacement_id === null
    ? undefined
    : index.entityLabelById.get(lifecycle.replacement_id) ?? lifecycle.replacement_id;
  return { status: lifecycle.status, ...(replacement ? { replacement } : {}) };
}

function compactToken(
  token: TokenV5,
  collection: CollectionV5,
  index: ProjectionIndex,
): FoundationAiToken {
  const modeLabels = index.modeLabelByCollectionAndId.get(collection.id) ?? new Map();
  const values: Record<string, AiValue> = {};
  for (const [modeId, value] of Object.entries(token.values)) {
    values[modeLabels.get(modeId) ?? modeId] = compactCanonicalValue(value, token.type, index);
  }
  const lifecycle = compactLifecycle(token.lifecycle, index);
  return {
    name: token.name,
    ...(index.ambiguousEntityIds.has(token.id) ? { source_id: token.id } : {}),
    ...(token.suggested_code_name ? { suggested_code_name: token.suggested_code_name } : {}),
    type: token.type,
    ...(token.description.length > 0 ? { description: token.description } : {}),
    ...(token.scopes.length > 0 ? { scopes: token.scopes } : {}),
    ...(token.publication ? { publication: token.publication } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    values,
  };
}

function compactStyleProperty(property: StyleProperty, index: ProjectionIndex): AiValue {
  if (property.source.kind === 'literal') {
    return property.resolved === null
      ? { missing: 'source_unavailable' }
      : { type: property.resolved.type, value: compactTypedValue(property.resolved) };
  }
  const path = property.source.target_path.join('/');
  const target = property.source.target_id === null
    ? path || '<unknown target>'
    : (index.tokenLabelById.get(property.source.target_id) ?? path)
      || property.source.target_id;
  return {
    alias: target,
    ...(property.resolved === null
      ? { unresolved: 'target_not_found' }
      : { resolved: { type: property.resolved.type, value: compactTypedValue(property.resolved) } }),
  };
}

function styleIdentity(
  style: TypographyStyleV5 | EffectStyleV5,
  index: ProjectionIndex,
): Record<string, AiValue | undefined> {
  const lifecycle = compactLifecycle(style.lifecycle, index);
  return {
    name: style.name,
    ...(index.ambiguousEntityIds.has(style.id) ? { source_id: style.id } : {}),
    ...(style.suggested_code_name ? { suggested_code_name: style.suggested_code_name } : {}),
    ...(style.publication ? { publication: {
      published: style.publication.published,
      hidden_from_publishing: style.publication.hidden_from_publishing,
    } } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function compactTypography(
  style: TypographyStyleV5,
  index: ProjectionIndex,
): AiValue {
  return {
    ...styleIdentity(style, index),
    ...(style.description.length > 0 ? { description: style.description } : {}),
    properties: {
      font_family: compactStyleProperty(style.properties.font_family, index),
      font_weight: compactStyleProperty(style.properties.font_weight, index),
      font_size: compactStyleProperty(style.properties.font_size, index),
      line_height: compactStyleProperty(style.properties.line_height, index),
      letter_spacing: compactStyleProperty(style.properties.letter_spacing, index),
      paragraph_spacing: compactStyleProperty(style.properties.paragraph_spacing, index),
      paragraph_indent: compactStyleProperty(style.properties.paragraph_indent, index),
      text_case: style.properties.text_case,
      text_decoration: style.properties.text_decoration,
    },
  };
}

function compactEffect(style: EffectStyleV5, index: ProjectionIndex): AiValue {
  const modeMatches = [...index.collectionById.values()].flatMap((collection) => {
    const label = index.modeLabelByCollectionAndId.get(collection.id)?.get(style.mode_id ?? '');
    return label === undefined ? [] : [label];
  });
  const mode = style.mode_id === null
    ? null
    : modeMatches.length === 1 ? modeMatches[0] : style.mode_id;
  return {
    ...styleIdentity(style, index),
    mode,
    effects: style.effects.map((effect) => ({
      type: effect.type,
      visible: effect.visible,
      blend_mode: effect.blend_mode,
      ...(effect.color ? { color: compactTypedValue(effect.color, 'color') } : {}),
      ...(effect.offset_x ? { offset_x: compactTypedValue(effect.offset_x, 'dimension') } : {}),
      ...(effect.offset_y ? { offset_y: compactTypedValue(effect.offset_y, 'dimension') } : {}),
      ...(effect.blur ? { blur: compactTypedValue(effect.blur, 'dimension') } : {}),
      ...(effect.spread ? { spread: compactTypedValue(effect.spread, 'dimension') } : {}),
      ...(effect.show_behind_node !== undefined ? { show_behind_node: effect.show_behind_node } : {}),
    })),
    ...(style.bindings && style.bindings.length > 0
      ? { bindings: Object.fromEntries(style.bindings.map((binding) => [
          binding.property,
          index.tokenLabelById.get(binding.token_id) ?? binding.token_id,
        ])) }
      : {}),
  };
}

function issueCounts(artifact: FoundationArtifactV5): Record<string, Record<string, number>> | undefined {
  const bySeverity = new Map<string, Map<string, number>>();
  for (const finding of artifact.diagnostics) {
    const byCode = bySeverity.get(finding.severity) ?? new Map<string, number>();
    byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
    bySeverity.set(finding.severity, byCode);
  }
  if (bySeverity.size === 0) return undefined;
  return Object.fromEntries([...bySeverity].sort(([a], [b]) => compareCodeUnits(a, b)).map(
    ([severity, byCode]) => [severity, Object.fromEntries(
      [...byCode].sort(([a], [b]) => compareCodeUnits(a, b)),
    )],
  ));
}

/** Build the deterministic, clipboard-sized projection of a canonical v5 artifact. */
export function foundationAiContext(artifact: FoundationArtifactV5): FoundationAiContext {
  const index = buildIndex(artifact);
  const tokensByCollection = new Map<string, TokenV5[]>();
  for (const token of artifact.tokens) {
    const tokens = tokensByCollection.get(token.collection_id) ?? [];
    tokens.push(token);
    tokensByCollection.set(token.collection_id, tokens);
  }

  const collections = artifact.collections.map((collection): FoundationAiCollection => {
    const tokens = tokensByCollection.get(collection.id) ?? [];
    const modeLabels = index.modeLabelByCollectionAndId.get(collection.id) ?? new Map();
    return {
      name: collection.name,
      ...(index.ambiguousEntityIds.has(collection.id) ? { source_id: collection.id } : {}),
      ...(collection.suggested_code_name
        ? { suggested_code_name: collection.suggested_code_name }
        : {}),
      ...(collection.publication ? { publication: collection.publication } : {}),
      ...(collection.source ? { source: {
        remote: collection.source.remote,
        ...(collection.source.library_name === null
          ? {}
          : { library_name: collection.source.library_name }),
      } } : {}),
      default_mode: modeLabels.get(collection.default_mode_id) ?? collection.default_mode_id,
      modes: collection.modes.map((mode) => modeLabels.get(mode.id) ?? mode.name),
      tokens: tokens.map((token) => compactToken(token, collection, index)),
    };
  });

  const counts = issueCounts(artifact);
  return {
    spec_layer: {
      kind: 'foundation',
      version: 5,
      profile: 'ai',
      content_hash: artifact.spec_layer.export.content_hash,
      source: {
        provider: 'figma',
        ...(artifact.spec_layer.source.file_name === null
          ? {}
          : { file_name: artifact.spec_layer.source.file_name }),
      },
    },
    completeness: artifact.completeness,
    collections,
    styles: {
      typography: artifact.styles.typography.map((style) => compactTypography(style, index)),
      effects: artifact.styles.effects.map((style) => compactEffect(style, index)),
    },
    ...(counts ? { issue_counts: counts } : {}),
    ...(artifact.guidelines
      ? { guidelines: artifact.guidelines.group_descriptions }
      : {}),
  };
}

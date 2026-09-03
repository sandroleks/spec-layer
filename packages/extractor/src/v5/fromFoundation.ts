/**
 * Direct FoundationSpec -> Foundation Context v5 export.
 *
 * This is the production contract boundary. It consumes the stable identities,
 * source scopes, and already-resolved alias provenance built in foundation.ts;
 * it never reconstructs v5 by round-tripping through the lossy v4 brief.
 */
import type {
  FoundationCollection, FoundationProvenanceLiteral, FoundationProvenanceValue,
  FoundationEffectStyle, FoundationSourceIssue, FoundationSpec, FoundationTextStyle,
  FoundationVariable, FoundationUnresolvedReason, RawPublicationMetadata,
} from '../foundation';
import type { EffectLayer } from '../effects';
import { buildEnvelope, canonicalJson } from './canonical';
import type {
  ArtifactSource, FoundationArtifactV5, SemanticPayload,
} from './canonical';
import {
  compareCodeUnits, diagnostic, sortDiagnostics,
} from './diagnostics';
import type { Diagnostic } from './diagnostics';
import { colorFromHex } from './color';
import type {
  CollectionV5, EffectStyleV5, EffectV5, ExtractionCompleteness,
  PublicationState, SourceState, StyleBinding, StyleProperty, TokenV5,
  TypographyStyleV5,
} from './entities';
import { canonicalNumber } from './precision';
import { computeFoundationStatistics } from './statistics';
import { numericValue } from './units';
import type {
  AliasReference, CanonicalValue, TokenType, TypedValue, UnresolvedReason,
} from './value';
import { resolvedValueOf } from './value';
import { validateLevel1, validateLevel2 } from './validate';

export interface FoundationExportV5Meta {
  exportId: string;
  generatedAt: string;
  build: string | null;
  libraryEnabled?: boolean | null;
  scope?:
    | { target: 'collection'; collectionId: string }
    | { target: 'textStyles' };
}

export interface FoundationExportV5Result {
  artifact: FoundationArtifactV5;
  diagnostics: Diagnostic[];
}

const ROOT = '<artifact>';

const nfc = (value: string): string => value.normalize('NFC');
const tokenPath = (name: string): string[] => name.split('/').map(nfc);

function publicationOf(
  metadata: RawPublicationMetadata | undefined,
): PublicationState | undefined {
  if (metadata?.publishStatus === null || metadata === undefined) return undefined;
  return {
    published: metadata.publishStatus !== 'UNPUBLISHED',
    hidden_from_publishing: metadata.hiddenFromPublishing,
  };
}

function sourceOf(remote: boolean | undefined): SourceState | undefined {
  return remote === undefined ? undefined : {
    remote,
    library_file_id: null,
    library_name: null,
    modified_at: null,
  };
}

function stylePath(name: string): string[] {
  const path = tokenPath(name);
  return path.length > 0 ? path : [''];
}

function styleProperty(
  resolved: TypedValue | null,
  bindingId: string | undefined,
  normalizedPaths: Map<string, string[]>,
): StyleProperty {
  return bindingId === undefined
    ? { source: { kind: 'literal' }, resolved }
    : {
        source: {
          kind: 'alias', target_id: bindingId,
          target_path: normalizedPaths.get(bindingId) ?? [],
        },
        resolved,
      };
}

/** Numeric font weights are not a Figma style property; the API exposes a
 * human font-style label. Convert only labels with an established CSS weight
 * meaning. Unknown labels remain null and receive a diagnostic. */
function fontWeightOf(fontStyle: string): number | null {
  const numeric = fontStyle.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/)?.[1];
  if (numeric !== undefined) return Number(numeric);
  const key = fontStyle.toLowerCase().replace(/[\s_-]+/g, '');
  const weights: Array<[string, number]> = [
    ['hairline', 100], ['thin', 100],
    ['extralight', 200], ['ultralight', 200],
    ['semibold', 600], ['demibold', 600],
    ['extrabold', 800], ['ultrabold', 800],
    ['light', 300],
    ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400],
    ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900],
  ];
  return weights.find(([label]) => key.includes(label))?.[1] ?? null;
}

function typographyBinding(
  style: FoundationTextStyle,
  property: string,
): string | undefined {
  const ids = style.bindingIds ?? {};
  if (property === 'font_weight') return ids.fontWeight ?? ids.fontStyle;
  const figmaProperty: Record<string, string> = {
    font_family: 'fontFamily', font_size: 'fontSize', line_height: 'lineHeight',
    letter_spacing: 'letterSpacing', paragraph_spacing: 'paragraphSpacing',
    paragraph_indent: 'paragraphIndent',
  };
  return ids[figmaProperty[property]];
}

function typographyStyleOf(
  style: FoundationTextStyle,
  normalizedPaths: Map<string, string[]>,
  tokensById: Map<string, TokenV5>,
  diagnostics: Diagnostic[],
): TypographyStyleV5 | null {
  if (!style.id) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'A text style could not be exported because its stable source id is unavailable.',
      details: { kind: 'typography', name: style.name },
    }));
    return null;
  }

  const source = sourceOf(style.source?.remote);
  const weight = fontWeightOf(style.fontStyle);
  if (
    style.bindingIds?.fontWeight !== undefined
    && style.bindingIds.fontStyle !== undefined
    && style.bindingIds.fontWeight !== style.bindingIds.fontStyle
  ) {
    diagnostics.push(diagnostic('INCONSISTENT_VALUE_SHAPE', {
      entity_id: style.id,
      message: 'The text style exposes different variable ids for fontWeight and fontStyle.',
      details: {
        font_weight_token_id: style.bindingIds.fontWeight,
        font_style_token_id: style.bindingIds.fontStyle,
      },
    }));
  }
  if (weight === null) {
    diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
      entity_id: style.id,
      message: 'The text style font label has no unambiguous numeric weight.',
      details: { property: 'font_weight', font_style: style.fontStyle },
    }));
  }
  const lineHeight = style.lineHeight.unit === 'AUTO'
    ? null
    : style.lineHeight.value === undefined
      ? null
      : {
          type: 'dimension' as const,
          number: canonicalNumber(style.lineHeight.value),
          unit: style.lineHeight.unit === 'PIXELS' ? 'px' as const : '%' as const,
        };
  if (lineHeight === null) {
    diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
      entity_id: style.id,
      message: 'Automatic or valueless line height has no numeric v5 representation.',
      details: { property: 'line_height', source_unit: style.lineHeight.unit },
    }));
  }
  const letterUnit = style.letterSpacing.unit === 'PIXELS' ? 'px' as const : '%' as const;
  const binding = (property: string): string | undefined => typographyBinding(style, property);
  const properties: TypographyStyleV5['properties'] = {
    font_family: styleProperty(
      { type: 'font_family', value: style.fontFamily },
      binding('font_family'), normalizedPaths,
    ),
    font_weight: styleProperty(
      weight === null ? null : { type: 'number', value: weight },
      binding('font_weight'), normalizedPaths,
    ),
    font_size: styleProperty(
      { type: 'dimension', number: canonicalNumber(style.fontSize), unit: 'px' },
      binding('font_size'), normalizedPaths,
    ),
    line_height: styleProperty(lineHeight, binding('line_height'), normalizedPaths),
    letter_spacing: styleProperty(
      {
        type: 'dimension', number: canonicalNumber(style.letterSpacing.value),
        unit: letterUnit,
      },
      binding('letter_spacing'), normalizedPaths,
    ),
    paragraph_spacing: styleProperty(
      { type: 'dimension', number: canonicalNumber(style.paragraphSpacing), unit: 'px' },
      binding('paragraph_spacing'), normalizedPaths,
    ),
    paragraph_indent: styleProperty(
      { type: 'dimension', number: canonicalNumber(style.paragraphIndent), unit: 'px' },
      binding('paragraph_indent'), normalizedPaths,
    ),
    text_case: style.textCase.toLowerCase(),
    text_decoration: style.textDecoration.toLowerCase(),
  };

  const scalarProperties = [
    'font_family', 'font_weight', 'font_size', 'line_height',
    'letter_spacing', 'paragraph_spacing', 'paragraph_indent',
  ] as const;
  for (const propertyName of scalarProperties) {
    const property = properties[propertyName];
    if (property.source.kind !== 'alias' || property.source.target_id === null
      || property.resolved === null) continue;
    const token = tokensById.get(property.source.target_id);
    if (token === undefined) continue;
    const snapshots = Object.values(token.values).map(resolvedValueOf);
    if (snapshots.length === 0 || snapshots.some((value) => value === null)) continue;
    const unique = new Map<string, TypedValue>();
    for (const snapshot of snapshots as TypedValue[]) {
      unique.set(canonicalJson(snapshot), snapshot);
    }
    // Text styles expose no consuming mode. As with effects, compare only
    // when every source mode states one identical value.
    if (unique.size !== 1) continue;
    const tokenValue = [...unique.values()][0];
    if (canonicalJson(tokenValue) === canonicalJson(property.resolved)) continue;
    diagnostics.push(diagnostic('STYLE_BINDING_DRIFT', {
      entity_id: style.id,
      message: 'The typography property snapshot differs from its unambiguous bound token value.',
      details: {
        property: propertyName,
        token_id: property.source.target_id,
        style_value: property.resolved,
        token_value: tokenValue,
      },
    }));
  }
  return {
    id: style.id,
    name: nfc(style.name),
    path: stylePath(style.name),
    description: style.description,
    ...(source ? { source } : {}),
    properties,
  };
}

function dimension(number: number) {
  return { type: 'dimension' as const, number: canonicalNumber(number), unit: 'px' as const };
}

function effectOf(
  effect: EffectLayer,
  styleId: string,
  sourceIndex: number,
  diagnostics: Diagnostic[],
): EffectV5 | null {
  if (effect.type === 'drop-shadow' || effect.type === 'inner-shadow') {
    const color = colorFromHex(effect.color.hex, effect.color.alpha);
    if (!color.ok) {
      diagnostics.push(diagnostic('INVALID_SOURCE_COLOR', {
        entity_id: styleId,
        message: 'An effect style shadow contains a color v5 cannot represent.',
        details: { effect_index: sourceIndex, reason: color.reason },
      }));
      return null;
    }
    return {
      type: effect.type === 'drop-shadow' ? 'drop_shadow' : 'inner_shadow',
      visible: effect.visible,
      blend_mode: effect.blendMode.toLowerCase(),
      color: color.value,
      offset_x: dimension(effect.offset.x),
      offset_y: dimension(effect.offset.y),
      blur: dimension(effect.radius),
      ...(effect.spread !== undefined ? { spread: dimension(effect.spread) } : {}),
      ...(effect.showShadowBehindNode !== undefined
        ? { show_behind_node: effect.showShadowBehindNode }
        : {}),
    };
  }
  if (effect.type === 'layer-blur' || effect.type === 'background-blur') {
    if (effect.blurType === 'progressive') {
      diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
        entity_id: styleId,
        message: 'Progressive blur metadata is only partially representable in Foundation Context v5.',
        details: { effect_index: sourceIndex, figma_type: effect.type },
      }));
    }
    return {
      type: effect.type === 'layer-blur' ? 'layer_blur' : 'background_blur',
      visible: effect.visible,
      blur: dimension(effect.radius),
    };
  }
  diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
    entity_id: styleId,
    message: 'An effect style layer kind is not representable by Foundation Context v5.',
    details: { effect_index: sourceIndex, figma_type: effect.type },
  }));
  return null;
}

function effectPropertyValue(effect: EffectV5, property: string): TypedValue | null {
  const field = property.match(/^effects\[\d+\]\.(.+)$/)?.[1];
  if (field === 'color') return effect.color ?? null;
  if (field === 'offset_x') return effect.offset_x ?? null;
  if (field === 'offset_y') return effect.offset_y ?? null;
  if (field === 'blur') return effect.blur ?? null;
  if (field === 'spread') return effect.spread ?? null;
  return null;
}

function hasNonAscii(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && code > 0x7f) return true;
  }
  return false;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

/** Keys sorted by code unit so two exports of one variable serialize alike. */
function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => compareCodeUnits(a, b)),
  );
}

function diagnosticIdentity(finding: Diagnostic): string {
  return canonicalJson({
    code: finding.code,
    entity_id: finding.entity_id,
    mode_id: finding.mode_id,
    details: finding.details ?? null,
  });
}

function dedupeDiagnostics(findings: Diagnostic[]): Diagnostic[] {
  const byIdentity = new Map<string, Diagnostic>();
  for (const finding of findings) {
    const key = diagnosticIdentity(finding);
    if (!byIdentity.has(key)) byIdentity.set(key, finding);
  }
  return sortDiagnostics([...byIdentity.values()]);
}

function collectionClosure(
  foundation: FoundationSpec,
  requestedCollectionId: string | undefined,
): FoundationCollection[] {
  if (requestedCollectionId === undefined) return foundation.collections;
  if (!foundation.collections.some((collection) => collection.id === requestedCollectionId)) {
    throw new Error(`Collection ${JSON.stringify(requestedCollectionId)} is no longer in this file.`);
  }

  const wanted = new Set([requestedCollectionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const collection of foundation.collections) {
      if (!wanted.has(collection.id)) continue;
      for (const variable of collection.variables) {
        for (const value of Object.values(variable.provenance.valuesByMode)) {
          if (value.kind !== 'alias' || value.external) continue;
          const targetCollectionId = value.targetCollectionId;
          if (
            targetCollectionId !== null
            && foundation.collections.some((candidate) => candidate.id === targetCollectionId)
            && !wanted.has(targetCollectionId)
          ) {
            wanted.add(targetCollectionId);
            changed = true;
          }
        }
      }
    }
  }
  return foundation.collections.filter((collection) => wanted.has(collection.id));
}

function textStyleDependencyCollections(foundation: FoundationSpec): FoundationCollection[] {
  const boundIds = new Set(foundation.textStyles.flatMap((style) =>
    Object.values(style.bindingIds ?? {})));
  const seedIds = foundation.collections.flatMap((collection) =>
    collection.variables.some((variable) => boundIds.has(variable.provenance.id))
      ? [collection.id]
      : []);
  const wanted = new Set(seedIds.flatMap((id) =>
    collectionClosure(foundation, id).map((collection) => collection.id)));
  return foundation.collections.filter((collection) => wanted.has(collection.id));
}

function tokenTypeOf(variable: FoundationVariable): TokenType {
  if (variable.resolvedType === 'COLOR') return 'color';
  if (variable.resolvedType === 'BOOLEAN') return 'boolean';
  if (variable.resolvedType === 'STRING') {
    const scopes = uniqueSorted(variable.provenance.scopes);
    return scopes.length === 1 && scopes[0] === 'FONT_FAMILY' ? 'font_family' : 'string';
  }
  const numeric = numericValue(0, variable.provenance.scopes);
  return numeric?.type === 'dimension' ? 'dimension' : 'number';
}

function typedLiteral(
  literal: FoundationProvenanceLiteral,
  variable: FoundationVariable,
  tokenType: TokenType,
): TypedValue | null {
  if (literal.kind === 'color' && tokenType === 'color') {
    return {
      type: 'color', color_space: 'srgb', hex: literal.hex, alpha: literal.alpha,
      ...(literal.channels ? { channels: literal.channels } : {}),
    };
  }
  if (literal.kind === 'number') {
    if (tokenType === 'dimension') return numericValue(literal.value, variable.provenance.scopes);
    if (tokenType === 'number') return { type: 'number', value: literal.value };
  }
  if (literal.kind === 'string') {
    if (tokenType === 'font_family') return { type: 'font_family', value: literal.value };
    if (tokenType === 'string') return { type: 'string', value: literal.value };
  }
  if (literal.kind === 'boolean' && tokenType === 'boolean') {
    return { type: 'boolean', value: literal.value };
  }
  return null;
}

function unresolvedReason(reason: FoundationUnresolvedReason): UnresolvedReason {
  switch (reason) {
    case 'cycle': return 'cycle';
    case 'missing': return 'target_not_found';
    case 'external': return 'source_library_unavailable';
    case 'depth': return 'depth_exceeded';
    case 'type_mismatch': return 'type_mismatch';
    case 'target_mode_unresolvable': return 'target_mode_unresolvable';
    case 'target_mode_value_missing': return 'target_mode_value_missing';
    // The target exists but its source value cannot inhabit the declared type.
    // v5 has no separate alias-resolution reason for corrupt source literals;
    // the target token carries the specific INVALID_SOURCE_COLOR diagnostic.
    case 'invalid_source_value': return 'type_mismatch';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function projectValue(
  value: FoundationProvenanceValue | undefined,
  variable: FoundationVariable,
  tokenType: TokenType,
  modeId: string,
  normalizedPaths: Map<string, string[]>,
  diagnostics: Diagnostic[],
): CanonicalValue {
  if (value === undefined || (value.kind === 'unresolved' && value.reason === 'missing')) {
    diagnostics.push(diagnostic('MISSING_MODE_VALUE', {
      entity_id: variable.provenance.id, mode_id: modeId,
      message: 'The source states no value for this declared mode.',
    }));
    return { kind: 'missing', reason: 'no_value_for_mode' };
  }

  if (value.kind === 'unresolved') {
    if (value.reason === 'invalid_source_value') {
      diagnostics.push(diagnostic('INVALID_SOURCE_COLOR', {
        entity_id: variable.provenance.id, mode_id: modeId,
        message: 'The source color contains a non-finite or out-of-range channel.',
      }));
      return { kind: 'missing', reason: 'invalid_source_value' };
    }
    return { kind: 'missing', reason: 'source_unavailable' };
  }

  if (value.kind !== 'alias') {
    const typed = typedLiteral(value, variable, tokenType);
    if (typed === null) {
      diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
        entity_id: variable.provenance.id, mode_id: modeId,
        message: `The source literal ${JSON.stringify(value.kind)} cannot inhabit token type ${JSON.stringify(tokenType)}.`,
      }));
      return { kind: 'missing', reason: 'unsupported_value_type' };
    }
    if (variable.resolvedType === 'FLOAT'
      && numericValue(0, variable.provenance.scopes) === null) {
      diagnostics.push(diagnostic('UNIT_METADATA_UNAVAILABLE', {
        entity_id: variable.provenance.id, mode_id: modeId,
        message: 'The numeric source value is retained, but its scopes do not state one unit.',
        details: { scopes: uniqueSorted(variable.provenance.scopes) },
      }));
    }
    return { kind: 'literal', value: typed };
  }

  const readableTargetPath = normalizedPaths.get(value.targetId);
  const externalMetadataReadable = value.external && value.targetName !== value.targetId;
  const reference: AliasReference = {
    target_id: value.targetId,
    target_collection_id: value.targetCollectionId,
    target_path: readableTargetPath
      ?? (externalMetadataReadable ? value.targetPath.map(nfc) : value.external ? [] : value.targetPath.map(nfc)),
    external: value.external,
    ...(value.external && value.targetCollection
      ? { source_library_name: value.targetCollection }
      : {}),
  };

  if (value.resolved === null) {
    return {
      kind: 'alias', reference,
      resolved: {
        status: 'unresolved', reason: 'source_library_unavailable', value: null, chain: [],
      },
    };
  }

  if (value.resolved.kind === 'unresolved') {
    return {
      kind: 'alias', reference,
      resolved: {
        status: 'unresolved', reason: unresolvedReason(value.resolved.reason),
        value: null,
        chain: value.chain.map((step) => ({ token_id: step.tokenId, mode_id: step.modeId })),
      },
    };
  }

  const typed = typedLiteral(value.resolved, variable, tokenType);
  if (typed === null) {
    return {
      kind: 'alias', reference,
      resolved: {
        status: 'unresolved', reason: 'type_mismatch', value: null,
        chain: value.chain.map((step) => ({ token_id: step.tokenId, mode_id: step.modeId })),
      },
    };
  }
  if (variable.resolvedType === 'FLOAT'
    && numericValue(0, variable.provenance.scopes) === null) {
    diagnostics.push(diagnostic('UNIT_METADATA_UNAVAILABLE', {
      entity_id: variable.provenance.id, mode_id: modeId,
      message: 'The resolved numeric value is retained, but its scopes do not state one unit.',
      details: { scopes: uniqueSorted(variable.provenance.scopes) },
    }));
  }
  return {
    kind: 'alias', reference,
    resolved: {
      status: 'resolved', value: typed,
      chain: value.chain.map((step) => ({ token_id: step.tokenId, mode_id: step.modeId })),
    },
  };
}

function effectStyleOf(
  style: FoundationEffectStyle,
  tokensById: Map<string, TokenV5>,
  diagnostics: Diagnostic[],
): EffectStyleV5 | null {
  if (!style.id) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'An effect style could not be exported because its stable source id is unavailable.',
      details: { kind: 'effect', name: style.name },
    }));
    return null;
  }

  const source = sourceOf(style.source?.remote);
  const sourceToOutput = new Map<number, number>();
  const effects: EffectV5[] = [];
  style.effects.forEach((effect, sourceIndex) => {
    const projected = effectOf(effect, style.id!, sourceIndex, diagnostics);
    if (projected === null) return;
    sourceToOutput.set(sourceIndex, effects.length);
    effects.push(projected);
  });

  const bindings: StyleBinding[] = [];
  for (const binding of style.bindings ?? []) {
    const match = binding.property.match(/^effects\[(\d+)\]\.(.+)$/);
    if (!match) continue;
    const sourceIndex = Number(match[1]);
    const outputIndex = sourceToOutput.get(sourceIndex);
    if (outputIndex === undefined) continue;
    const property = `effects[${outputIndex}].${match[2]}`;
    bindings.push({ property, token_id: binding.tokenId });

    const token = tokensById.get(binding.tokenId);
    const styleValue = effectPropertyValue(effects[outputIndex], property);
    if (token === undefined || styleValue === null) continue;
    const snapshots = Object.values(token.values).map(resolvedValueOf);
    if (snapshots.length === 0 || snapshots.some((value) => value === null)) continue;
    const unique = new Map<string, TypedValue>();
    for (const snapshot of snapshots as TypedValue[]) {
      unique.set(canonicalJson(snapshot), snapshot);
    }
    // A style has no consuming mode. Compare only when every source mode states
    // the same value; choosing one differing mode would invent context.
    if (unique.size !== 1) continue;
    const tokenValue = [...unique.values()][0];
    if (canonicalJson(tokenValue) !== canonicalJson(styleValue)) {
      diagnostics.push(diagnostic('STYLE_BINDING_DRIFT', {
        entity_id: style.id,
        message: 'The effect property snapshot differs from its unambiguous bound token value.',
        details: {
          property, token_id: binding.tokenId,
          style_value: styleValue, token_value: tokenValue,
        },
      }));
    }
  }

  return {
    id: style.id,
    name: nfc(style.name),
    path: stylePath(style.name),
    mode_id: null,
    effects,
    ...(bindings.length > 0 ? { bindings } : {}),
    ...(source ? { source } : {}),
  };
}

function confusableDiagnostics(
  collections: FoundationCollection[],
): Diagnostic[] {
  const findings: Diagnostic[] = [];
  for (const collection of collections) {
    if (hasNonAscii(collection.name)) {
      findings.push(diagnostic('CONFUSABLE_NAME', {
        entity_id: collection.id,
        message: `Collection name ${JSON.stringify(collection.name)} contains non-ASCII characters.`,
        details: { kind: 'collection', name: collection.name },
      }));
    }
    for (const mode of collection.modes) {
      if (hasNonAscii(mode.name)) {
        findings.push(diagnostic('CONFUSABLE_NAME', {
          entity_id: mode.modeId,
          message: `Mode name ${JSON.stringify(mode.name)} contains non-ASCII characters.`,
          details: { kind: 'mode', collection_id: collection.id, name: mode.name },
        }));
      }
    }
    for (const variable of collection.variables) {
      if (hasNonAscii(variable.name)) {
        findings.push(diagnostic('CONFUSABLE_NAME', {
          entity_id: variable.provenance.id,
          message: `Token name ${JSON.stringify(variable.name)} contains non-ASCII characters.`,
          details: { kind: 'token', name: variable.name },
        }));
      }
    }
  }
  return findings;
}

function confusableStyleDiagnostics(
  styles: Array<FoundationTextStyle | FoundationEffectStyle>,
  kind: 'typography' | 'effect',
): Diagnostic[] {
  return styles.flatMap((style) =>
    style.id && hasNonAscii(style.name)
      ? [diagnostic('CONFUSABLE_NAME', {
          entity_id: style.id,
          message: `${kind === 'typography' ? 'Typography' : 'Effect'} style name `
            + `${JSON.stringify(style.name)} contains non-ASCII characters.`,
          details: { kind, name: style.name },
        })]
      : []);
}

function sourceIssueDiagnostics(
  foundation: FoundationSpec,
  includedCollections: FoundationCollection[],
): { issues: FoundationSourceIssue[]; diagnostics: Diagnostic[] } {
  const includedCollectionIds = new Set(includedCollections.map((collection) => collection.id));
  const tokenInfo = new Map<string, { collectionId: string; declaredModeIds: string[] }>();
  for (const collection of includedCollections) {
    for (const variable of collection.variables) {
      tokenInfo.set(variable.provenance.id, {
        collectionId: collection.id,
        declaredModeIds: collection.modes.map((mode) => mode.modeId),
      });
    }
  }
  const byPair = new Map<string, FoundationSourceIssue>();
  for (const issue of foundation.sourceIssues ?? []) {
    if (!includedCollectionIds.has(issue.collectionId)) continue;
    byPair.set(canonicalJson([issue.tokenId, issue.modeId]), issue);
  }
  for (const collection of includedCollections) {
    for (const variable of collection.variables) {
      for (const modeId of variable.provenance.staleModeIds) {
        const key = canonicalJson([variable.provenance.id, modeId]);
        if (byPair.has(key)) continue;
        byPair.set(key, {
          kind: 'stale_mode_value', collectionId: collection.id,
          tokenId: variable.provenance.id, modeId,
          declaredModeIds: collection.modes.map((mode) => mode.modeId),
        });
      }
    }
  }
  const issues = [...byPair.values()].sort((a, b) =>
    compareCodeUnits(a.tokenId, b.tokenId) || compareCodeUnits(a.modeId, b.modeId));
  return {
    issues,
    diagnostics: issues.map((issue) => diagnostic('UNRESOLVED_REFERENCE', {
      entity_id: issue.tokenId, mode_id: issue.modeId,
      message: 'The source carries a value keyed by a mode the collection no longer declares.',
      details: {
        collection_id: issue.collectionId,
        declared_mode_ids: tokenInfo.get(issue.tokenId)?.declaredModeIds ?? issue.declaredModeIds,
        stale_mode_id: issue.modeId,
      },
    })),
  };
}

function completenessOf(
  foundation: FoundationSpec,
  includedCollections: FoundationCollection[],
  scope: FoundationExportV5Meta['scope'],
  staleIssueCount: number,
  externalSourceCount: number,
  collectionMetadataUnavailable: boolean,
  diagnostics: Diagnostic[],
): ExtractionCompleteness {
  const unavailable = new Set(foundation.unavailable ?? []);
  let collections: ExtractionCompleteness['collections'];
  let styles: ExtractionCompleteness['styles'];

  if (scope !== undefined) {
    collections = 'partial';
    styles = scope.target === 'collection'
      ? 'unavailable'
      : unavailable.has('textStyles') ? 'unavailable' : 'partial';
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: scope.target === 'collection' ? scope.collectionId : ROOT,
      message: scope.target === 'collection'
        ? 'This artifact is scoped to one collection and its complete local dependency closure.'
        : 'This artifact is scoped to typography styles and their bound-token dependency collections.',
      details: scope.target === 'collection'
        ? {
            requested_collection_id: scope.collectionId,
            included_collection_ids: includedCollections.map((collection) => collection.id),
          }
        : {
            target: 'textStyles',
            included_collection_ids: includedCollections.map((collection) => collection.id),
          },
    }));
  } else {
    collections = unavailable.has('variables') && includedCollections.length === 0
      ? 'unavailable'
      : unavailable.has('variables') || staleIssueCount > 0 || externalSourceCount > 0
        || collectionMetadataUnavailable
        ? 'partial'
        : 'complete';

    const textFailed = unavailable.has('textStyles');
    const effectsFailed = unavailable.has('effectStyles');
    if (textFailed && effectsFailed) styles = 'unavailable';
    else if (textFailed || effectsFailed
      || foundation.textStyles.length > 0 || foundation.effectStyles.length > 0) styles = 'partial';
    else styles = 'complete';
  }

  if (unavailable.has('variables')) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'One or more local variable reads were unavailable.',
      details: { source: 'figma:variables' },
    }));
  }
  if (scope?.target !== 'collection'
    && (foundation.textStyles.length > 0 || foundation.effectStyles.length > 0)) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'Composite styles are emitted, but Figma exposes no complete style publication, lifecycle, or consuming-mode metadata.',
      details: {
        typography: foundation.textStyles.length,
        effects: scope?.target === 'textStyles' ? 0 : foundation.effectStyles.length,
        hidden_from_publishing_unavailable: true,
        lifecycle_unavailable: true,
        consuming_mode_unavailable: scope?.target !== 'textStyles'
          && foundation.effectStyles.length > 0,
      },
    }));
  }
  const textStylesUnavailable = unavailable.has('textStyles');
  const effectStylesUnavailable = scope === undefined && unavailable.has('effectStyles');
  if (scope?.target !== 'collection'
    && (textStylesUnavailable || effectStylesUnavailable)) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'One or more composite-style source reads were unavailable.',
      details: {
        text_styles_unavailable: textStylesUnavailable,
        effect_styles_unavailable: effectStylesUnavailable,
      },
    }));
  }

  return {
    collections,
    styles,
    unavailable_sources: [],
  };
}

export function buildFoundationArtifactV5(
  foundation: FoundationSpec,
  meta: FoundationExportV5Meta,
): FoundationExportV5Result {
  const requestedCollectionId = meta.scope?.target === 'collection'
    ? meta.scope.collectionId
    : undefined;
  const includedCollections = meta.scope?.target === 'textStyles'
    ? textStyleDependencyCollections(foundation)
    : collectionClosure(foundation, requestedCollectionId);
  const includedCollectionIds = new Set(includedCollections.map((collection) => collection.id));
  const diagnostics: Diagnostic[] = confusableDiagnostics(includedCollections);
  if (meta.scope?.target !== 'collection') {
    diagnostics.push(...confusableStyleDiagnostics(foundation.textStyles, 'typography'));
  }
  if (meta.scope === undefined) {
    diagnostics.push(...confusableStyleDiagnostics(foundation.effectStyles, 'effect'));
  }

  const normalizedPaths = new Map<string, string[]>();
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      normalizedPaths.set(variable.provenance.id, tokenPath(variable.name));
    }
  }

  const externalSources: string[] = [];
  for (const collection of includedCollections) {
    for (const variable of collection.variables) {
      for (const value of Object.values(variable.provenance.valuesByMode)) {
        if (value.kind === 'alias' && value.external) {
          externalSources.push(value.targetCollection || value.targetId);
        }
      }
    }
  }
  if (meta.scope?.target !== 'collection') {
    for (const style of foundation.textStyles) {
      for (const tokenId of Object.values(style.bindingIds ?? {})) {
        if (!normalizedPaths.has(tokenId)) externalSources.push(tokenId);
      }
    }
  }
  if (meta.scope === undefined) {
    for (const style of foundation.effectStyles) {
      for (const binding of style.bindings ?? []) {
        if (!normalizedPaths.has(binding.tokenId)) externalSources.push(binding.tokenId);
      }
    }
  }

  const sourceIssues = sourceIssueDiagnostics(foundation, includedCollections);
  diagnostics.push(...sourceIssues.diagnostics);

  let collectionMetadataUnavailable = false;
  for (const collection of includedCollections) {
    if (collection.publication?.publishStatus === null) {
      collectionMetadataUnavailable = true;
      diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
        entity_id: collection.id,
        message: 'The collection publication status could not be read.',
        details: { field: 'publication.published' },
      }));
    }
    for (const variable of collection.variables) {
      if (variable.publication?.publishStatus !== null) continue;
      collectionMetadataUnavailable = true;
      diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
        entity_id: variable.provenance.id,
        message: 'The token publication status could not be read.',
        details: { field: 'publication.published' },
      }));
    }
  }

  const completeness = completenessOf(
    foundation, includedCollections, meta.scope,
    sourceIssues.issues.length, externalSources.length,
    collectionMetadataUnavailable, diagnostics,
  );
  completeness.unavailable_sources = uniqueSorted([
    ...(foundation.unavailableSources ?? []), ...externalSources,
  ]);

  const collections: CollectionV5[] = includedCollections.map((collection) => {
    const publication = publicationOf(collection.publication);
    const sourceState = sourceOf(collection.publication?.remote);
    return {
      id: collection.id,
      name: nfc(collection.name),
      path: [nfc(collection.name)],
      default_mode_id: collection.defaultModeId,
      modes: collection.modes.map((mode, order) => ({
        id: mode.modeId, name: nfc(mode.name), order,
      })),
      ...(publication ? { publication } : {}),
      ...(sourceState ? { source: sourceState } : {}),
    };
  });

  const tokens: TokenV5[] = [];
  for (const collection of includedCollections) {
    if (!includedCollectionIds.has(collection.id)) continue;
    for (const variable of collection.variables) {
      const type = tokenTypeOf(variable);
      const values: Record<string, CanonicalValue> = {};
      for (const mode of collection.modes) {
        values[mode.modeId] = projectValue(
          variable.provenance.valuesByMode[mode.modeId],
          variable, type, mode.modeId, normalizedPaths, diagnostics,
        );
      }
      tokens.push({
        id: variable.provenance.id,
        name: nfc(variable.name),
        path: tokenPath(variable.name),
        collection_id: collection.id,
        type,
        description: variable.description,
        scopes: uniqueSorted(variable.provenance.scopes),
        ...(Object.keys(variable.codeSyntax).length > 0
          ? { code_syntax: sortedRecord(variable.codeSyntax) }
          : {}),
        ...(publicationOf(variable.publication)
          ? { publication: publicationOf(variable.publication) }
          : {}),
        values,
      });
    }
  }

  const tokensById = new Map(tokens.map((token) => [token.id, token]));
  const typography = meta.scope?.target !== 'collection'
    ? foundation.textStyles.flatMap((style) => {
        const projected = typographyStyleOf(
          style, normalizedPaths, tokensById, diagnostics,
        );
        return projected === null ? [] : [projected];
      })
    : [];
  const effects = meta.scope === undefined
    ? foundation.effectStyles.flatMap((style) => {
        const projected = effectStyleOf(style, tokensById, diagnostics);
        return projected === null ? [] : [projected];
      })
    : [];

  const payload: SemanticPayload = {
    completeness,
    collections,
    tokens,
    styles: { typography, effects },
  };
  const source: ArtifactSource = {
    provider: 'figma',
    file_id: foundation.fileKey && foundation.fileKey !== 'unknown'
      ? foundation.fileKey
      : null,
    file_name: foundation.fileName ?? null,
    file_version: null,
    library_enabled: meta.libraryEnabled ?? null,
  };
  const envelope = buildEnvelope(payload, {
    exportId: meta.exportId,
    generatedAt: meta.generatedAt,
    build: meta.build,
    source,
  });

  const provisionalDiagnostics = dedupeDiagnostics(diagnostics);
  const provisionalStatistics = computeFoundationStatistics({
    ...payload, diagnostics: provisionalDiagnostics,
  });
  const provisionalArtifact: FoundationArtifactV5 = {
    ...payload,
    spec_layer: envelope,
    diagnostics: provisionalDiagnostics,
    statistics: provisionalStatistics,
  };
  const level1 = validateLevel1(provisionalArtifact);
  if (level1.length > 0) {
    throw new Error(`Direct v5 exporter produced an invalid artifact: ${level1.map((finding) => finding.message).join(' ')}`);
  }

  const level2 = validateLevel2(provisionalArtifact);
  const finalDiagnostics = dedupeDiagnostics([...provisionalDiagnostics, ...level2]);
  const finalStatistics = computeFoundationStatistics({
    ...payload, diagnostics: finalDiagnostics,
  });
  const artifact: FoundationArtifactV5 = {
    ...payload,
    spec_layer: envelope,
    diagnostics: finalDiagnostics,
    statistics: finalStatistics,
  };
  return { artifact, diagnostics: finalDiagnostics };
}

/**
 * Direct FoundationSpec -> Foundation Context v5 export.
 *
 * This is the production contract boundary. It consumes the stable identities,
 * source scopes, and already-resolved alias provenance built in foundation.ts;
 * it never reconstructs v5 by round-tripping through the lossy v4 brief.
 */
import type {
  FoundationCollection, FoundationProvenanceLiteral, FoundationProvenanceValue,
  FoundationSourceIssue, FoundationSpec, FoundationVariable,
  FoundationUnresolvedReason,
} from '../foundation';
import { buildEnvelope, canonicalJson } from './canonical';
import type {
  ArtifactSource, FoundationArtifactV5, SemanticPayload,
} from './canonical';
import {
  compareCodeUnits, diagnostic, sortDiagnostics,
} from './diagnostics';
import type { Diagnostic } from './diagnostics';
import type { CollectionV5, ExtractionCompleteness, TokenV5 } from './entities';
import { computeFoundationStatistics } from './statistics';
import { numericValue } from './units';
import type {
  AliasReference, CanonicalValue, TokenType, TypedValue, UnresolvedReason,
} from './value';
import { validateLevel1, validateLevel2 } from './validate';

export interface FoundationExportV5Meta {
  exportId: string;
  generatedAt: string;
  build: string | null;
  libraryEnabled?: boolean | null;
  scope?: { target: 'collection'; collectionId: string };
}

export interface FoundationExportV5Result {
  artifact: FoundationArtifactV5;
  diagnostics: Diagnostic[];
}

const ROOT = '<artifact>';

const nfc = (value: string): string => value.normalize('NFC');
const tokenPath = (name: string): string[] => name.split('/').map(nfc);

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
  requestedCollectionId: string | undefined,
  staleIssueCount: number,
  externalSourceCount: number,
  diagnostics: Diagnostic[],
): ExtractionCompleteness {
  const unavailable = new Set(foundation.unavailable ?? []);
  let collections: ExtractionCompleteness['collections'];
  let styles: ExtractionCompleteness['styles'];

  if (requestedCollectionId !== undefined) {
    collections = 'partial';
    styles = 'unavailable';
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: requestedCollectionId,
      message: 'This artifact is scoped to one collection and its complete local dependency closure.',
      details: {
        requested_collection_id: requestedCollectionId,
        included_collection_ids: includedCollections.map((collection) => collection.id),
      },
    }));
  } else {
    collections = unavailable.has('variables') && includedCollections.length === 0
      ? 'unavailable'
      : unavailable.has('variables') || staleIssueCount > 0 || externalSourceCount > 0
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
  if (requestedCollectionId === undefined
    && (foundation.textStyles.length > 0 || foundation.effectStyles.length > 0)) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'Composite styles are present but are not emitted until Foundation Context v5 Phase 3.',
      details: {
        typography_not_migrated: foundation.textStyles.length,
        effects_not_migrated: foundation.effectStyles.length,
      },
    }));
  }
  if (requestedCollectionId === undefined
    && (unavailable.has('textStyles') || unavailable.has('effectStyles'))) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ROOT,
      message: 'One or more composite-style source reads were unavailable.',
      details: {
        text_styles_unavailable: unavailable.has('textStyles'),
        effect_styles_unavailable: unavailable.has('effectStyles'),
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
  const requestedCollectionId = meta.scope?.collectionId;
  const includedCollections = collectionClosure(foundation, requestedCollectionId);
  const includedCollectionIds = new Set(includedCollections.map((collection) => collection.id));
  const diagnostics: Diagnostic[] = confusableDiagnostics(includedCollections);

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

  const sourceIssues = sourceIssueDiagnostics(foundation, includedCollections);
  diagnostics.push(...sourceIssues.diagnostics);

  const completeness = completenessOf(
    foundation, includedCollections, requestedCollectionId,
    sourceIssues.issues.length, externalSources.length, diagnostics,
  );
  completeness.unavailable_sources = uniqueSorted([
    ...(foundation.unavailableSources ?? []), ...externalSources,
  ]);

  const collections: CollectionV5[] = includedCollections.map((collection) => ({
    id: collection.id,
    name: nfc(collection.name),
    path: [nfc(collection.name)],
    default_mode_id: collection.defaultModeId,
    modes: collection.modes.map((mode, order) => ({
      id: mode.modeId, name: nfc(mode.name), order,
    })),
  }));

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
        values,
      });
    }
  }

  const payload: SemanticPayload = {
    completeness,
    collections,
    tokens,
    styles: { typography: [], effects: [] },
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

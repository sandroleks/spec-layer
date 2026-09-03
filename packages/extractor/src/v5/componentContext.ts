/**
 * Component Context v5.
 *
 * The component extractor already owns the difficult Figma work: one part
 * namespace, minimized variant conditions, inline effects, hardcoded gaps,
 * and deterministic component findings. This module is the new clipboard
 * boundary over that mature `IntermediateSpec`. It joins every Foundation
 * reference by stable id, selects only the transitive Foundation closure the
 * component needs, validates those joins, and hashes the semantic result.
 *
 * The legacy component brief remains exported for compatibility and canvas
 * hashes remain untouched. Nothing in here feeds `specContentHash`.
 */
import { sha256 } from 'js-sha256';
import { componentBrief } from '../brief';
import type { IntermediateSpec } from '../extract';
import type { EffectLayer } from '../effects';
import type { ProseDrafts } from '../prose/prompt';
import type { RefIdentity, RefKind } from '../tree';
import { validate as validateComponentFacts } from '../validate';
import { EXTRACTOR_VERSION } from '../version';
import type { YamlValue } from '../yaml';
import {
  canonicalJson, semanticContentHash, SCHEMA_VERSION,
} from './canonical';
import type {
  ArtifactSource, FoundationArtifactV5, SemanticPayload,
} from './canonical';
import { compareCodeUnits, sortDiagnostics } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import type {
  EffectStyleV5, ExtractionCompleteness, TokenV5,
  TypographyStyleV5,
} from './entities';
import { foundationAiContext } from './aiContext';
import { computeFoundationStatistics } from './statistics';
import { validateLevel1, validateLevel2 } from './validate';
import { resolvedValueOf } from './value';

export const COMPONENT_SCHEMA_VERSION = '5.1.0';
export const COMPONENT_SCHEMA_URI = 'https://spec-layer.com/schemas/component-context/v5.json';
export const COMPONENT_EXTRACTOR_NAME = 'spec-layer-component';

type YamlObject = { [key: string]: YamlValue | undefined };

export type ComponentReferenceStatus =
  | 'resolved'
  | 'external'
  | 'unavailable'
  | 'not_in_snapshot'
  | 'not_extracted'
  | 'no_foundation';

export interface ComponentReferenceV5 {
  source_id: string;
  name: string;
  kind: RefKind;
  remote: boolean;
  collection_id?: string;
  status: ComponentReferenceStatus;
}

export interface ComponentBindingV5 {
  path: string;
  property: string;
  source_id: string;
  kind: RefKind;
  when?: Record<string, string[]>;
}

type ComponentAiBindingFactsV5 = Omit<ComponentBindingV5, 'path'>;

/** Clipboard-only binding shape. Canonical artifacts always retain one exact
 * `path` per binding; the AI profile groups only otherwise-identical bindings. */
export type ComponentAiBindingV5 = ComponentAiBindingFactsV5 & (
  | { path: string; paths?: never }
  | { paths: string[]; path?: never }
);

export interface ComponentReferenceSetV5 {
  used: ComponentReferenceV5[];
  bindings: ComponentBindingV5[];
  /** Canonical Foundation dependency payload. It deliberately excludes the
   * whole-file Foundation hash, so an unrelated token cannot move this
   * component's semantic hash. */
  foundation?: SemanticPayload;
}

export interface ComponentSemanticPayloadV5 {
  component: YamlObject;
  api?: YamlValue;
  anatomy: YamlValue[];
  layout?: YamlValue;
  references: ComponentReferenceSetV5;
  effects_inline?: YamlValue;
  unbound?: YamlValue;
}

export interface ComponentArtifactSourceV5 extends ArtifactSource {
  node_id: string;
  node_name: string;
  component_key: string | null;
}

export interface ComponentEnvelopeV5 {
  kind: 'component';
  schema_version: string;
  schema_uri: string;
  extractor: { name: string; version: string; build: string | null };
  export: { id: string; generated_at: string; deterministic: boolean; content_hash: string };
  source: ComponentArtifactSourceV5;
}

export type ComponentContextDiagnosticCode =
  | 'UNRESOLVED_REFERENCE'
  | 'INCONSISTENT_REFERENCE';

export interface ComponentContextDiagnostic {
  code: ComponentContextDiagnosticCode;
  severity: 'error' | 'warning';
  entity_id: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ComponentArtifactV5 extends ComponentSemanticPayloadV5 {
  spec_layer: ComponentEnvelopeV5;
  /** Whole-file Foundation identity for matching against a Foundation context
   * already present in a conversation. Outside the component semantic hash. */
  foundation_content_hash?: string;
  /** Hash of `references.foundation`, repeated for cheap comparison. */
  foundation_dependency_hash?: string;
  foundation_diagnostics?: Diagnostic[];
  diagnostics: ComponentContextDiagnostic[];
  validation?: YamlValue;
  guidelines?: YamlValue;
}

export interface ComponentExportV5Meta {
  exportId: string;
  generatedAt: string;
  build: string | null;
  foundation?: FoundationArtifactV5;
  prose?: ProseDrafts | null;
}

export interface ComponentAiContextV5 {
  spec_layer: {
    kind: 'component';
    version: 5;
    profile: 'ai';
    content_hash: string;
    foundation_hash?: string;
    source: { provider: 'figma'; file_name?: string };
  };
  source: { node_id: string; node_name: string; component_key?: string };
  component: YamlObject;
  api?: YamlValue;
  anatomy: YamlValue[];
  layout?: YamlValue;
  references: {
    used: ComponentReferenceV5[];
    bindings: ComponentAiBindingV5[];
    foundation: YamlValue;
  };
  effects_inline?: YamlValue;
  unbound?: YamlValue;
  validation?: YamlValue;
  issue_counts?: Record<string, Record<string, number>>;
  guidelines?: YamlValue;
}

const asObject = (value: YamlValue | undefined): YamlObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as YamlObject
    : {};

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort(compareCodeUnits);

const referenceKey = (reference: Pick<RefIdentity, 'kind' | 'id'>): string =>
  JSON.stringify([reference.kind, reference.id]);

const bindingKey = (binding: ComponentBindingV5): string => canonicalJson(binding);

function entityExists(
  foundation: FoundationArtifactV5,
  reference: RefIdentity,
): boolean {
  if (reference.kind === 'variable') {
    return foundation.tokens.some((token) => token.id === reference.id);
  }
  if (reference.kind === 'text-style') {
    return foundation.styles.typography.some((style) => style.id === reference.id);
  }
  if (reference.kind === 'effect-style') {
    return foundation.styles.effects.some((style) => style.id === reference.id);
  }
  return false;
}

function referenceStatus(
  reference: RefIdentity,
  foundation: FoundationArtifactV5 | undefined,
): ComponentReferenceStatus {
  if (reference.kind === 'paint-style') return 'not_extracted';
  if (reference.remote) return 'external';
  if (foundation === undefined) return 'no_foundation';
  if (entityExists(foundation, reference)) return 'resolved';
  if (foundation.completeness.unavailable_sources.includes(reference.id)) return 'unavailable';
  return 'not_in_snapshot';
}

function referencesOf(
  spec: IntermediateSpec,
  foundation: FoundationArtifactV5 | undefined,
): { used: ComponentReferenceV5[]; bindings: ComponentBindingV5[] } {
  const used: ComponentReferenceV5[] = [];
  const usedKeys = new Set<string>();
  const bindings: ComponentBindingV5[] = [];
  const bindingKeys = new Set<string>();

  const addUsed = (reference: RefIdentity): void => {
    const key = referenceKey(reference);
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    used.push({
      source_id: reference.id,
      name: reference.name.normalize('NFC'),
      kind: reference.kind,
      remote: reference.remote,
      ...(reference.collectionId ? { collection_id: reference.collectionId } : {}),
      status: referenceStatus(reference, foundation),
    });
  };
  const addBinding = (binding: ComponentBindingV5): void => {
    const key = bindingKey(binding);
    if (bindingKeys.has(key)) return;
    bindingKeys.add(key);
    bindings.push(binding);
  };

  for (const rule of spec.tokens) {
    const refKey = referenceKey(rule);
    if (!usedKeys.has(refKey)) addUsed(rule);

    const binding: ComponentBindingV5 = {
      path: rule.path.normalize('NFC'),
      property: rule.property,
      source_id: rule.id,
      kind: rule.kind,
      ...(Object.keys(rule.conditions).length > 0 ? { when: rule.conditions } : {}),
    };
    addBinding(binding);
  }

  for (const item of spec.nodeEffects) {
    item.effects.forEach((effect, effectIndex) => {
      const effectBindings = (effect as { bindings?: Record<string, RefIdentity> }).bindings;
      for (const [field, reference] of Object.entries(effectBindings ?? {})) {
        addUsed(reference);
        addBinding({
          path: item.path.normalize('NFC'),
          property: `effects[${effectIndex}].${field}`,
          source_id: reference.id,
          kind: reference.kind,
        });
      }
    });
  }
  return { used, bindings };
}

function aliasTargets(token: TokenV5): string[] {
  const targets: string[] = [];
  for (const value of Object.values(token.values)) {
    if (value.kind === 'alias' && !value.reference.external
      && value.reference.target_id !== null) {
      targets.push(value.reference.target_id);
    }
  }
  return targets;
}

function styleTokenTargets(style: TypographyStyleV5 | EffectStyleV5): string[] {
  if ('properties' in style) {
    return Object.values(style.properties).flatMap((property) => {
      if (typeof property === 'string' || property.source.kind !== 'alias'
        || property.source.target_id === null) return [];
      return [property.source.target_id];
    });
  }
  return (style.bindings ?? []).map((binding) => binding.token_id);
}

function dedupeFoundationDiagnostics(findings: Diagnostic[]): Diagnostic[] {
  const byValue = new Map<string, Diagnostic>();
  for (const finding of findings) byValue.set(canonicalJson(finding), finding);
  return sortDiagnostics([...byValue.values()]);
}

/**
 * Select exactly the Foundation entities needed by these component references.
 * Entity arrays retain their source artifact order; closure discovery order
 * cannot make two exports differ.
 */
export function componentFoundationDependencies(
  foundation: FoundationArtifactV5,
  references: ComponentReferenceV5[],
): FoundationArtifactV5 {
  const allTokens = new Map(foundation.tokens.map((token) => [token.id, token]));
  const allTypography = new Map(
    foundation.styles.typography.map((style) => [style.id, style]),
  );
  const allEffects = new Map(foundation.styles.effects.map((style) => [style.id, style]));
  const tokenIds = new Set<string>();
  const typographyIds = new Set<string>();
  const effectIds = new Set<string>();
  const unavailableTokens = new Set<string>();
  const unavailableStyles = new Set<string>();
  const pending: string[] = [];

  const addToken = (id: string): void => {
    if (tokenIds.has(id)) return;
    const token = allTokens.get(id);
    if (token === undefined) {
      unavailableTokens.add(id);
      return;
    }
    tokenIds.add(id);
    pending.push(id);
  };

  for (const reference of references) {
    if (reference.kind === 'variable') addToken(reference.source_id);
    if (reference.kind === 'text-style') {
      const style = allTypography.get(reference.source_id);
      if (style === undefined) unavailableStyles.add(reference.source_id);
      else {
        typographyIds.add(style.id);
        for (const id of styleTokenTargets(style)) addToken(id);
      }
    }
    if (reference.kind === 'effect-style') {
      const style = allEffects.get(reference.source_id);
      if (style === undefined) unavailableStyles.add(reference.source_id);
      else {
        effectIds.add(style.id);
        for (const id of styleTokenTargets(style)) addToken(id);
      }
    }
  }

  for (let index = 0; index < pending.length; index += 1) {
    const token = allTokens.get(pending[index]);
    if (token === undefined) continue;
    for (const target of aliasTargets(token)) addToken(target);
  }

  const tokens = foundation.tokens.filter((token) => tokenIds.has(token.id));
  const collectionIds = new Set(tokens.map((token) => token.collection_id));
  const collections = foundation.collections.filter((collection) => collectionIds.has(collection.id));
  const typography = foundation.styles.typography.filter((style) => typographyIds.has(style.id));
  const effects = foundation.styles.effects.filter((style) => effectIds.has(style.id));
  const includedIds = new Set<string>([
    ...collectionIds, ...tokenIds, ...typographyIds, ...effectIds,
  ]);
  const inherited = foundation.diagnostics.filter((finding) => includedIds.has(finding.entity_id));

  const variableRequested = references.some((reference) => reference.kind === 'variable')
    || tokenIds.size > 0;
  const styleRequested = references.some((reference) =>
    reference.kind === 'text-style' || reference.kind === 'effect-style');
  const missingVariable = references.some((reference) =>
    reference.kind === 'variable' && reference.status !== 'resolved')
    || unavailableTokens.size > 0;
  const missingStyle = references.some((reference) =>
    (reference.kind === 'text-style' || reference.kind === 'effect-style')
      && reference.status !== 'resolved') || unavailableStyles.size > 0;
  const collectionSourcePartial = inherited.some((finding) =>
    finding.code === 'SOURCE_PARTIALLY_UNAVAILABLE'
      && (collectionIds.has(finding.entity_id) || tokenIds.has(finding.entity_id)));
  const completeness: ExtractionCompleteness = {
    collections: !variableRequested
      ? 'complete'
      : missingVariable || collectionSourcePartial ? 'partial' : 'complete',
    styles: !styleRequested
      ? 'complete'
      : missingStyle ? 'partial' : foundation.completeness.styles,
    unavailable_sources: uniqueSorted([...unavailableTokens, ...unavailableStyles]),
  };
  const payload: SemanticPayload = {
    completeness,
    collections,
    tokens,
    styles: { typography, effects },
  };
  const dependencyHash = semanticContentHash(payload);
  const envelope = {
    ...foundation.spec_layer,
    export: {
      ...foundation.spec_layer.export,
      id: `${foundation.spec_layer.export.id}:component-dependencies`,
      content_hash: dependencyHash,
    },
  };
  const provisional: FoundationArtifactV5 = {
    ...payload,
    spec_layer: envelope,
    diagnostics: inherited,
    statistics: {},
  };
  const level1 = validateLevel1(provisional);
  if (level1.length > 0) {
    throw new Error(`Component Foundation dependency slice is invalid: ${level1.map((finding) => finding.message).join(' ')}`);
  }
  const diagnostics = dedupeFoundationDiagnostics([...inherited, ...validateLevel2(provisional)]);
  return {
    ...provisional,
    diagnostics,
    statistics: computeFoundationStatistics({ ...payload, diagnostics }),
  };
}

export function componentSemanticContentHash(payload: ComponentSemanticPayloadV5): string {
  return `sha256:${sha256(canonicalJson({
    component: payload.component,
    api: payload.api,
    anatomy: payload.anatomy,
    layout: payload.layout,
    references: payload.references,
    effects_inline: payload.effects_inline,
    unbound: payload.unbound,
  }))}`;
}

interface AnatomyNodeV5 extends YamlObject {
  part: string;
  path: string;
  type: string;
  children?: YamlValue[];
}

function componentAnatomy(spec: IntermediateSpec): YamlValue[] {
  const roots: AnatomyNodeV5[] = [];
  const stack: Array<{ depth: number; node: AnatomyNodeV5 }> = [];
  for (const part of spec.anatomy) {
    const node: AnatomyNodeV5 = {
      part: part.name, path: part.path, type: part.type,
      ...(part.component ? { component: part.component } : {}),
    };
    while (stack.length > 0 && stack[stack.length - 1].depth >= part.depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else {
      const parent = stack[stack.length - 1].node;
      const children = parent.children ?? [];
      children.push(node);
      parent.children = children;
    }
    stack.push({ depth: part.depth, node });
  }
  return roots;
}

function componentLayout(spec: IntermediateSpec): YamlValue | undefined {
  if (spec.layout.length === 0) return undefined;
  return {
    scope: 'default_variant',
    items: spec.layout.map((item) => ({
      path: item.path,
      summary: item.summary,
      ...(Object.keys(item.values).length > 0 ? { values: item.values } : {}),
    })) as unknown as YamlValue,
  };
}

function exactEffectLayer(layer: EffectLayer): YamlValue {
  const raw = layer as unknown as Record<string, unknown>;
  const bindings = raw.bindings as Record<string, RefIdentity> | undefined;
  if (bindings === undefined) return layer as unknown as YamlValue;
  return {
    ...raw,
    bindings: Object.fromEntries(Object.entries(bindings).map(([field, reference]) => [
      field,
      {
        source_id: reference.id, name: reference.name, kind: reference.kind,
        remote: reference.remote,
        ...(reference.collectionId ? { collection_id: reference.collectionId } : {}),
      },
    ])) as unknown as YamlValue,
  } as unknown as YamlValue;
}

function componentInlineEffects(spec: IntermediateSpec): YamlValue | undefined {
  if (spec.nodeEffects.length === 0) return undefined;
  return spec.nodeEffects.map((item) => ({
    path: item.path,
    layers: item.effects.map(exactEffectLayer),
  })) as unknown as YamlValue;
}

function componentValidation(
  spec: IntermediateSpec,
  foundation: FoundationArtifactV5 | undefined,
): YamlValue | undefined {
  const resolved = new Map<string, number>();
  if (foundation) {
    const collections = new Map(foundation.collections.map((item) => [item.id, item]));
    const tokens = new Map(foundation.tokens.map((item) => [item.id, item]));
    for (const rule of spec.tokens) {
      if (rule.kind !== 'variable' || resolved.has(rule.id)) continue;
      const token = tokens.get(rule.id);
      if (token === undefined) continue;
      const collection = collections.get(token.collection_id);
      if (collection === undefined) continue;
      const value = resolvedValueOf(token.values[collection.default_mode_id]);
      if (value?.type === 'number') resolved.set(rule.id, value.value);
      if (value?.type === 'dimension') resolved.set(rule.id, value.number);
    }
  }
  const findings = validateComponentFacts(spec, resolved, 'id').map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    ...(finding.path !== undefined ? { path: finding.path } : {}),
    ...(finding.property !== undefined ? { property: finding.property } : {}),
    message: finding.message,
    ...(finding.when !== undefined ? { when: finding.when } : {}),
  }));
  return findings.length > 0 ? findings as unknown as YamlValue : undefined;
}

function statusMessage(reference: ComponentReferenceV5): string {
  switch (reference.status) {
    case 'external': return 'Figma reports this reference as belonging to an external library.';
    case 'unavailable': return 'The Foundation read named this source id as unavailable.';
    case 'not_in_snapshot': return 'The local source id is absent from the current Foundation snapshot.';
    case 'not_extracted': return 'Paint style definitions are not extracted.';
    case 'no_foundation': return 'No Foundation snapshot was available for this component copy.';
    case 'resolved': return '';
  }
}

/** Referential checks over the finished component artifact. */
export function validateComponentArtifactV5(
  artifact: ComponentArtifactV5,
): ComponentContextDiagnostic[] {
  const diagnostics: ComponentContextDiagnostic[] = [];
  const used = new Map(artifact.references.used.map((reference) => [
    referenceKey({ kind: reference.kind, id: reference.source_id }), reference,
  ]));
  for (const binding of artifact.references.bindings) {
    const key = referenceKey({ kind: binding.kind, id: binding.source_id });
    if (used.has(key)) continue;
    diagnostics.push({
      code: 'INCONSISTENT_REFERENCE', severity: 'error',
      entity_id: artifact.spec_layer.source.node_id,
      message: 'A component binding has no matching used reference.',
      details: { source_id: binding.source_id, kind: binding.kind, property: binding.property },
    });
  }

  const foundation = artifact.references.foundation;
  const tokenIds = new Set(foundation?.tokens.map((token) => token.id) ?? []);
  const typographyIds = new Set(foundation?.styles.typography.map((style) => style.id) ?? []);
  const effectIds = new Set(foundation?.styles.effects.map((style) => style.id) ?? []);
  for (const reference of artifact.references.used) {
    const present = reference.kind === 'variable'
      ? tokenIds.has(reference.source_id)
      : reference.kind === 'text-style'
        ? typographyIds.has(reference.source_id)
        : reference.kind === 'effect-style'
          ? effectIds.has(reference.source_id)
          : false;
    if (reference.status === 'resolved' && !present) {
      diagnostics.push({
        code: 'INCONSISTENT_REFERENCE', severity: 'error',
        entity_id: reference.source_id,
        message: 'A reference claims to be resolved but its definition is absent from the dependency slice.',
        details: { kind: reference.kind },
      });
    } else if (reference.status !== 'resolved') {
      diagnostics.push({
        code: 'UNRESOLVED_REFERENCE',
        severity: reference.status === 'no_foundation' ? 'warning' : 'error',
        entity_id: reference.source_id,
        message: statusMessage(reference),
        details: { kind: reference.kind, status: reference.status, name: reference.name },
      });
    }
  }

  return [...new Map(diagnostics.map((finding) => [canonicalJson(finding), finding])).values()]
    .sort((a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)
      || compareCodeUnits(a.code, b.code)
      || compareCodeUnits(a.entity_id, b.entity_id)
      || compareCodeUnits(a.message, b.message));
}

/** Build the canonical component artifact. */
export function buildComponentArtifactV5(
  spec: IntermediateSpec,
  meta: ComponentExportV5Meta,
): ComponentArtifactV5 {
  const projected = asObject(componentBrief(spec, {
    generatedAt: meta.generatedAt,
    prose: meta.prose,
  }));
  const exact = referencesOf(spec, meta.foundation);
  const dependency = meta.foundation
    ? componentFoundationDependencies(meta.foundation, exact.used)
    : undefined;
  const references: ComponentReferenceSetV5 = {
    ...exact,
    ...(dependency ? { foundation: {
      completeness: dependency.completeness,
      collections: dependency.collections,
      tokens: dependency.tokens,
      styles: dependency.styles,
    } } : {}),
  };
  const layout = componentLayout(spec);
  const effectsInline = componentInlineEffects(spec);
  const validation = componentValidation(spec, meta.foundation);
  const payload: ComponentSemanticPayloadV5 = {
    component: asObject(projected.component),
    ...(projected.api !== undefined ? { api: projected.api } : {}),
    anatomy: componentAnatomy(spec),
    ...(layout !== undefined ? { layout } : {}),
    references,
    ...(effectsInline !== undefined
      ? { effects_inline: effectsInline }
      : {}),
    ...(projected.unbound !== undefined ? { unbound: projected.unbound } : {}),
  };
  const source: ComponentArtifactSourceV5 = {
    provider: 'figma',
    file_id: spec.figmaFile && spec.figmaFile !== 'unknown' ? spec.figmaFile : null,
    file_name: spec.figmaFileName ?? null,
    file_version: null,
    library_enabled: null,
    node_id: spec.figmaNode,
    node_name: spec.name,
    component_key: spec.figmaKey || null,
  };
  const envelope: ComponentEnvelopeV5 = {
    kind: 'component',
    schema_version: COMPONENT_SCHEMA_VERSION,
    schema_uri: COMPONENT_SCHEMA_URI,
    extractor: {
      name: COMPONENT_EXTRACTOR_NAME,
      version: EXTRACTOR_VERSION,
      build: meta.build,
    },
    export: {
      id: meta.exportId,
      generated_at: meta.generatedAt,
      deterministic: true,
      content_hash: componentSemanticContentHash(payload),
    },
    source,
  };
  const provisional: ComponentArtifactV5 = {
    ...payload,
    spec_layer: envelope,
    ...(meta.foundation
      ? { foundation_content_hash: meta.foundation.spec_layer.export.content_hash }
      : {}),
    ...(dependency
      ? { foundation_dependency_hash: dependency.spec_layer.export.content_hash }
      : {}),
    ...(dependency ? { foundation_diagnostics: dependency.diagnostics } : {}),
    diagnostics: [],
    ...(validation !== undefined ? { validation } : {}),
    ...(projected.guidelines !== undefined ? { guidelines: projected.guidelines } : {}),
  };
  return { ...provisional, diagnostics: validateComponentArtifactV5(provisional) };
}

function componentIssueCounts(
  diagnostics: ComponentContextDiagnostic[],
): Record<string, Record<string, number>> | undefined {
  const counts = new Map<string, Map<string, number>>();
  for (const finding of diagnostics) {
    const byCode = counts.get(finding.severity) ?? new Map<string, number>();
    byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
    counts.set(finding.severity, byCode);
  }
  if (counts.size === 0) return undefined;
  return Object.fromEntries([...counts].sort(([a], [b]) => compareCodeUnits(a, b)).map(
    ([severity, byCode]) => [severity, Object.fromEntries(
      [...byCode].sort(([a], [b]) => compareCodeUnits(a, b)),
    )],
  ));
}

/** Group repeated clipboard rules without changing their meaning or the
 * canonical artifact. Group order follows the first binding occurrence and
 * path order follows canonical binding order. */
function compactComponentBindings(
  bindings: ComponentBindingV5[],
): ComponentAiBindingV5[] {
  const groups = new Map<string, {
    facts: ComponentAiBindingFactsV5;
    paths: string[];
  }>();
  for (const binding of bindings) {
    const { path, ...facts } = binding;
    const key = canonicalJson(facts);
    const group = groups.get(key);
    if (group) {
      group.paths.push(path);
    } else {
      groups.set(key, { facts, paths: [path] });
    }
  }
  return [...groups.values()].map(({ facts, paths }) => paths.length === 1
    ? { path: paths[0]!, ...facts }
    : { paths, ...facts });
}

/** Compact clipboard projection of a finished canonical component artifact. */
export function componentAiContext(
  artifact: ComponentArtifactV5,
): ComponentAiContextV5 {
  let foundation: YamlValue = { status: 'not_read' };
  if (artifact.references.foundation) {
    const payload = artifact.references.foundation;
    const dependencyArtifact: FoundationArtifactV5 = {
      ...payload,
      spec_layer: {
        kind: 'foundation',
        // The Foundation schema's own version, since this slice is a Foundation
        // artifact: the two happen to agree today and need not tomorrow.
        schema_version: SCHEMA_VERSION,
        schema_uri: 'https://spec-layer.com/schemas/foundation-context/v5.json',
        extractor: artifact.spec_layer.extractor,
        export: {
          id: `${artifact.spec_layer.export.id}:foundation-dependencies`,
          generated_at: artifact.spec_layer.export.generated_at,
          deterministic: true,
          content_hash: artifact.foundation_dependency_hash
            ?? semanticContentHash(payload),
        },
        source: {
          provider: 'figma',
          file_id: null,
          file_name: artifact.spec_layer.source.file_name,
          file_version: null,
          library_enabled: null,
        },
      },
      diagnostics: artifact.foundation_diagnostics ?? [],
      statistics: {},
    };
    const compact = foundationAiContext(dependencyArtifact, { includeSourceIds: true });
    foundation = {
      dependency_hash: dependencyArtifact.spec_layer.export.content_hash,
      completeness: compact.completeness as unknown as YamlValue,
      collections: compact.collections as unknown as YamlValue,
      styles: compact.styles as unknown as YamlValue,
      ...(compact.issue_counts
        ? { issue_counts: compact.issue_counts as unknown as YamlValue }
        : {}),
    };
  }
  const counts = componentIssueCounts(artifact.diagnostics);
  return {
    spec_layer: {
      kind: 'component', version: 5, profile: 'ai',
      content_hash: artifact.spec_layer.export.content_hash,
      ...(artifact.foundation_content_hash
        ? { foundation_hash: artifact.foundation_content_hash }
        : {}),
      source: {
        provider: 'figma',
        ...(artifact.spec_layer.source.file_name
          ? { file_name: artifact.spec_layer.source.file_name }
          : {}),
      },
    },
    source: {
      node_id: artifact.spec_layer.source.node_id,
      node_name: artifact.spec_layer.source.node_name,
      ...(artifact.spec_layer.source.component_key
        ? { component_key: artifact.spec_layer.source.component_key }
        : {}),
    },
    component: artifact.component,
    ...(artifact.api !== undefined ? { api: artifact.api } : {}),
    anatomy: artifact.anatomy,
    ...(artifact.layout !== undefined ? { layout: artifact.layout } : {}),
    references: {
      used: artifact.references.used,
      bindings: compactComponentBindings(artifact.references.bindings),
      foundation,
    },
    ...(artifact.effects_inline !== undefined
      ? { effects_inline: artifact.effects_inline }
      : {}),
    ...(artifact.unbound !== undefined ? { unbound: artifact.unbound } : {}),
    ...(artifact.validation !== undefined ? { validation: artifact.validation } : {}),
    ...(counts ? { issue_counts: counts } : {}),
    ...(artifact.guidelines !== undefined ? { guidelines: artifact.guidelines } : {}),
  };
}

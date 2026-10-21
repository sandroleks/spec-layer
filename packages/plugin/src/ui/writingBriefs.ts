/**
 * What Draft all tells the model about each open field: only facts the UI
 * already holds, never more. The system prompt forbids inferring a purpose
 * from a name, so a brief carries every true fact it can and invents none.
 * Pure; nothing here enters a hash.
 */
import type {
  DescriptionBrief, FoundationMode, FoundationScope, FoundationSpec, FoundationVariable, SpecHashProjection,
} from '@spec-layer/extractor';
import { valueLabel, type WritingGap } from '../writingGaps';
import { writingTaskKey } from './viewModel/writing';

export interface BriefContext {
  /** The UI's current Foundation spec, or null before it loads. */
  foundation?: FoundationSpec | null;
  /** The row's Foundation scope; its `modeIds` narrow a variable's values. */
  scope?: FoundationScope | undefined;
  /** The projection the row's last source check hashed, when it is held. */
  projection?: SpecHashProjection | undefined;
}

function findVariable(spec: FoundationSpec | null | undefined, id: string): { variable: FoundationVariable; modes: FoundationMode[] } | null {
  for (const collection of spec?.collections ?? []) {
    const variable = collection.variables.find((v) => v.provenance.id === id);
    if (variable) return { variable, modes: collection.modes };
  }
  return null;
}

function variableBrief(key: string, gap: WritingGap, context: BriefContext): DescriptionBrief {
  const found = findVariable(context.foundation, gap.id);
  if (!found) return { key, kind: 'variable', name: gap.name, type: 'variable', values: gap.facts ?? [] };
  const { variable } = found;
  const scoped = context.scope?.target === 'collection' && context.scope.modeIds.length > 0
    ? new Set(context.scope.modeIds)
    : null;
  const modes = scoped ? found.modes.filter((m) => scoped.has(m.modeId)) : found.modes;
  const values = modes.map((m) => {
    const value = variable.valuesByMode[m.modeId];
    return `${m.name} = ${value ? valueLabel(value) : 'Not set'}`;
  });
  const targets = modes.map((m) => {
    const value = variable.valuesByMode[m.modeId];
    return value?.kind === 'alias' ? value.targetName : null;
  });
  const aliasOf = targets.length > 0 && targets.every((t) => t !== null && t === targets[0]) ? targets[0] : null;
  const scopes = variable.provenance.scopes;
  return {
    key, kind: 'variable', name: gap.name, type: variable.resolvedType, values,
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(aliasOf ? { aliasOf } : {}),
  };
}

function styleBrief(key: string, gap: WritingGap, context: BriefContext): DescriptionBrief {
  const family = gap.facts?.[0] ?? 'style';
  const spec = context.foundation;
  if (family === 'typography') {
    const style = spec?.textStyles.find((s) => s.id === gap.id);
    return {
      key, kind: 'style', name: gap.name, type: family,
      ...(style ? { facts: [`Font: ${style.fontFamily} ${style.fontStyle}, ${style.fontSize}px`] } : {}),
    };
  }
  if (family === 'effect') {
    const style = spec?.effectStyles.find((s) => s.id === gap.id);
    return {
      key, kind: 'style', name: gap.name, type: family,
      ...(style ? { facts: [`Effects: ${style.effects.length}`] } : {}),
    };
  }
  return { key, kind: 'style', name: gap.name, type: family };
}

/** "Properties: Size, Label" and "Variants: 6", from the projection alone. */
function componentFacts(projection: SpecHashProjection | undefined): string[] {
  if (!projection) return [];
  const facts: string[] = [];
  if (projection.props.length > 0) facts.push(`Properties: ${projection.props.map((p) => p.name).join(', ')}`);
  if (projection.variantInstances.length > 0) facts.push(`Variants: ${projection.variantInstances.length}`);
  return facts;
}

/** A slot's preferred components, by name, as the projection names them. */
function preferredComponents(gap: WritingGap, projection: SpecHashProjection | undefined): string[] {
  if (!projection || !gap.propertyName) return [];
  // "Content#1:2" is "Content" in the projection: Figma suffixes a property with its id.
  const shown = gap.propertyName.replace(/#.*$/, '');
  const prop = projection.props.find((p) => p.kind === 'slot' && p.name === shown);
  return (prop?.slot?.preferred ?? []).filter((name): name is string => typeof name === 'string' && name !== '');
}

export function briefFor(gap: WritingGap, context: BriefContext = {}): DescriptionBrief {
  const key = writingTaskKey(gap);
  switch (gap.kind) {
    case 'variable': return variableBrief(key, gap, context);
    case 'style': return styleBrief(key, gap, context);
    case 'slot': {
      // Labelled as a fact, not bare values, so the model reads them as what they are.
      const preferred = preferredComponents(gap, context.projection);
      const facts = [
        ...componentFacts(context.projection),
        ...(preferred.length > 0 ? [`Preferred components: ${preferred.join(', ')}`] : []),
      ];
      return { key, kind: 'slot', name: gap.name, type: 'slot', ...(facts.length > 0 ? { facts } : {}) };
    }
    default: {
      const facts = componentFacts(context.projection);
      return { key, kind: 'component', name: gap.name, type: 'component', ...(facts.length > 0 ? { facts } : {}) };
    }
  }
}

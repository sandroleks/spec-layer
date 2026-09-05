/// <reference types="@figma/plugin-typings" />
import type {
  FoundationReader, ReaderCollection, ReaderVariable, ReaderTextStyle, ReaderEffectStyle,
} from './serializeFoundation';
import type { RawEffect } from '@spec-layer/extractor';

type PublishStatusSource = { getPublishStatusAsync(): Promise<PublishStatus> };

/** The fields of a Figma Variable this reader touches. */
export interface VariableSource extends PublishStatusSource {
  id: string;
  name: string;
  resolvedType: VariableResolvedDataType;
  description: string;
  variableCollectionId: string;
  codeSyntax: Partial<Record<string, string>>;
  valuesByMode: Record<string, VariableValue>;
  scopes: readonly VariableScope[];
  remote: boolean;
  hiddenFromPublishing: boolean;
}

export interface CollectionSource extends PublishStatusSource {
  id: string;
  name: string;
  modes: ReadonlyArray<{ modeId: string; name: string }>;
  defaultModeId: string;
  variableIds: readonly string[];
  hiddenFromPublishing: boolean;
  remote: boolean;
}

export interface TextStyleSource extends PublishStatusSource {
  id: string;
  name: string;
  description: string;
  fontName: FontName;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: TextCase;
  textDecoration: TextDecoration;
  boundVariables?: Partial<Record<string, VariableAlias | undefined>>;
  remote: boolean;
}

export interface EffectStyleSource extends PublishStatusSource {
  id: string;
  name: string;
  description: string;
  effects: readonly Effect[];
  remote: boolean;
}

/** `figma.variables`, or a fake. */
export interface VariablesSource {
  getLocalVariableCollectionsAsync(): Promise<CollectionSource[]>;
  getLocalVariablesAsync(): Promise<VariableSource[]>;
  getVariableByIdAsync(id: string): Promise<VariableSource | null>;
  getVariableCollectionByIdAsync(id: string): Promise<CollectionSource | null>;
}

/** `figma`, or a fake: only the two style listings. */
export interface StylesSource {
  getLocalTextStylesAsync(): Promise<TextStyleSource[]>;
  getLocalEffectStylesAsync(): Promise<EffectStyleSource[]>;
}

async function publishStatusOf(source: PublishStatusSource): Promise<PublishStatus | null> {
  try { return await source.getPublishStatusAsync(); } catch { return null; }
}

function readerVariable(v: VariableSource, publishStatus: PublishStatus | null): ReaderVariable {
  return {
    id: v.id,
    name: v.name,
    resolvedType: v.resolvedType,
    description: v.description ?? '',
    variableCollectionId: v.variableCollectionId,
    // codeSyntax is Partial<Record<CodeSyntaxPlatform, string>>; drop empties.
    codeSyntax: Object.fromEntries(
      Object.entries(v.codeSyntax ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
    valuesByMode: v.valuesByMode as Record<string, never>,
    scopes: [...v.scopes],
    remote: v.remote,
    hiddenFromPublishing: v.hiddenFromPublishing,
    publishStatus,
  };
}

/**
 * A FoundationReader for one serialization pass.
 *
 * The first variable lookup reads every local variable in one
 * getLocalVariablesAsync call and indexes it by id, so a 464-variable file
 * costs one round trip for values instead of 464. An id the bulk read did not
 * return (or a bulk read that failed) falls back to getVariableByIdAsync, so
 * nothing is reported missing that Figma can still hand over.
 *
 * Publication status stays per variable and is not deferred: an absent
 * `publication` drops the field from every v5 artifact built from this dump,
 * and the selection-time dump is the same session cache the publish path
 * reads. The reads run concurrently under serializeFoundation's Promise.all.
 *
 * Create one per pass. The index is a snapshot; a reader kept across passes
 * would serve stale values after an edit.
 */
export function createFoundationReader(
  variables: VariablesSource,
  styles: StylesSource,
): FoundationReader {
  let index: Promise<Map<string, VariableSource>> | null = null;
  const localVariables = (): Promise<Map<string, VariableSource>> => {
    if (!index) {
      index = variables.getLocalVariablesAsync()
        .then((list) => new Map(list.map((v) => [v.id, v] as const)))
        // A failed bulk read must not fail every lookup; the per-id path below
        // still works, exactly as the reader behaved before the bulk read.
        .catch(() => new Map<string, VariableSource>());
    }
    return index;
  };

  return {
    async collections() {
      const colls = await variables.getLocalVariableCollectionsAsync();
      return Promise.all(colls.map(async (c): Promise<ReaderCollection> => ({
        id: c.id,
        name: c.name,
        modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        defaultModeId: c.defaultModeId,
        variableIds: [...c.variableIds],
        hiddenFromPublishing: c.hiddenFromPublishing,
        publishStatus: await publishStatusOf(c),
        remote: c.remote,
      })));
    },
    async variable(id) {
      const v = (await localVariables()).get(id) ?? await variables.getVariableByIdAsync(id);
      if (!v) return null;
      return readerVariable(v, await publishStatusOf(v));
    },
    async textStyles() {
      const list = await styles.getLocalTextStylesAsync();
      return Promise.all(list.map(async (s): Promise<ReaderTextStyle> => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        fontName: { family: s.fontName.family, style: s.fontName.style },
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        paragraphSpacing: s.paragraphSpacing,
        paragraphIndent: s.paragraphIndent,
        textCase: String(s.textCase),
        textDecoration: String(s.textDecoration),
        boundVariables: Object.fromEntries(
          Object.entries(s.boundVariables ?? {})
            .filter((e): e is [string, VariableAlias] => Boolean(e[1]?.id))
            .map(([k, v]) => [k, { id: v.id }]),
        ),
        remote: s.remote,
        publishStatus: await publishStatusOf(s),
      })));
    },
    async effectStyles() {
      const list = await styles.getLocalEffectStylesAsync();
      return Promise.all(list.map(async (s): Promise<ReaderEffectStyle> => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        // Handed to effectLayerOf as-is: it is structurally typed for exactly
        // this, which keeps the effect union in the extractor rather than here.
        effects: s.effects as unknown as RawEffect[],
        remote: s.remote,
        publishStatus: await publishStatusOf(s),
      })));
    },
    async collectionName(id) {
      const c = await variables.getVariableCollectionByIdAsync(id);
      return c?.name ?? null;
    },
  };
}

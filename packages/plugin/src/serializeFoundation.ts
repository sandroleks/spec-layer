/**
 * serializeFoundation.ts — builds the raw foundation dump the extractor turns
 * into a FoundationSpec.
 *
 * Figma-free by construction: it reads through an injected FoundationReader,
 * the same pattern serialize.ts uses with NodeResolver, so the dump logic is
 * unit-testable and main.ts owns the Figma API surface.
 */
import {
  effectLayerOf,
  type SerializedFoundation, type RawCollection, type RawVariable, type RawTextStyle,
  type RawExternalRef, type RawVariableValue, type FoundationVariableType,
  type FoundationMode, type FoundationRead, type FoundationPublishStatus,
  type RawEffectStyle, type RawEffect,
} from '@spec-layer/extractor';

export interface ReaderCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variableIds: string[];
  hiddenFromPublishing?: boolean;
  publishStatus?: FoundationPublishStatus | null;
  remote?: boolean;
}

export interface ReaderVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  variableCollectionId: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
  scopes: string[];
  remote: boolean;
  hiddenFromPublishing?: boolean;
  publishStatus?: FoundationPublishStatus | null;
}

export interface ReaderTextStyle {
  id?: string;
  name: string;
  description: string;
  fontName: { family: string; style: string };
  fontSize: number;
  lineHeight: RawTextStyle['lineHeight'];
  letterSpacing: RawTextStyle['letterSpacing'];
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
  boundVariables: Record<string, { id: string }>;
  remote?: boolean;
  publishStatus?: FoundationPublishStatus | null;
}

export interface ReaderEffectStyle {
  id?: string;
  name: string;
  description: string;
  effects: RawEffect[];
  remote?: boolean;
  publishStatus?: FoundationPublishStatus | null;
}

/** Injected Figma surface. main.ts supplies the real one; tests a fake. */
export interface FoundationReader {
  collections(): Promise<ReaderCollection[]>;
  variable(id: string): Promise<ReaderVariable | null>;
  textStyles(): Promise<ReaderTextStyle[]>;
  effectStyles(): Promise<ReaderEffectStyle[]>;
  /** Name of a collection that may be remote. Optional: absent → ''. */
  collectionName?(id: string): Promise<string | null>;
}

function isAlias(v: RawVariableValue): v is { type: 'VARIABLE_ALIAS'; id: string } {
  return typeof v === 'object' && v !== null
    && (v as { type?: string }).type === 'VARIABLE_ALIAS';
}

const EFFECT_BINDING_FIELDS: Record<string, string> = {
  color: 'color',
  radius: 'blur',
  spread: 'spread',
  offsetX: 'offset_x',
  offsetY: 'offset_y',
};

/** Figma's style-level `boundVariables.effects` is a flat id array. The exact
 * relationship lives on each effect layer, so preserve that layer/property
 * path before converting the effect to the Figma-free union. */
function effectBindingIds(effects: RawEffect[]): Array<{ property: string; tokenId: string }> {
  const bindings: Array<{ property: string; tokenId: string }> = [];
  effects.forEach((effect, index) => {
    const raw = effect as Record<string, unknown>;
    const bound = raw.boundVariables;
    if (typeof bound !== 'object' || bound === null || Array.isArray(bound)) return;
    for (const [figmaField, alias] of Object.entries(bound)) {
      const property = EFFECT_BINDING_FIELDS[figmaField];
      if (property === undefined || typeof alias !== 'object' || alias === null) continue;
      const id = (alias as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) continue;
      bindings.push({ property: `effects[${index}].${property}`, tokenId: id });
    }
  });
  return bindings;
}

/**
 * One variable read, with any failure mapped to null.
 *
 * Every read below goes through this so a batch can be awaited with
 * `Promise.all` without one unreadable id rejecting the whole batch — the
 * sequential version's per-read `try/catch` (skip, don't throw) survives
 * unchanged, just moved into the helper. The `await` inside the `try` also
 * catches a reader that throws synchronously instead of returning a rejected
 * promise.
 */
async function readVariable(
  reader: FoundationReader, id: string,
): Promise<ReaderVariable | null> {
  try { return await reader.variable(id); } catch { return null; }
}

/** Collection name for an external alias target. Absent method, missing
 *  collection, or a throw all mean the same thing here: unavailable metadata. */
async function readCollectionName(reader: FoundationReader, id: string): Promise<string | null> {
  if (!reader.collectionName) return null;
  try { return (await reader.collectionName(id)) ?? null; } catch { return null; }
}

export async function serializeFoundation(
  reader: FoundationReader, fileKey: string, extractedAt: string, fileName?: string,
): Promise<SerializedFoundation> {
  const unavailable: FoundationRead[] = [];
  const unavailableSources = new Set<string>();
  const markSectionUnavailable = (section: FoundationRead, source: string): void => {
    if (!unavailable.includes(section)) unavailable.push(section);
    unavailableSources.add(source);
  };

  let readerCollections: ReaderCollection[] = [];
  try {
    readerCollections = await reader.collections();
  } catch {
    // An empty foundation is no longer "the honest result" on its own: it is
    // indistinguishable from a file with no variables. Say which one it is.
    markSectionUnavailable('variables', 'figma:variables');
  }

  const collections: RawCollection[] = [];
  const declaredLocalIds = new Set(
    readerCollections.flatMap((collection) => collection.variableIds),
  );
  // Alias targets seen while walking, resolved to externals after we know which
  // ids are local. Keyed by id so a target aliased from ten places costs one hop.
  const aliasTargets = new Set<string>();

  // Every variable in the file, read in ONE batch rather than one sequential
  // await per id. On a 2,000-variable system the sequential version was 2,000
  // main-thread round trips in series before the caller saw anything.
  //
  // Order is load-bearing: a collection's rendered row order comes straight
  // from this array and feeds the doc's content hash, so a reorder here would
  // spuriously mark every existing foundation doc as drifted. `Promise.all`
  // resolves to an array in ARGUMENT order, never completion order, so
  // `readPerCollection[i][j]` is always the result for
  // `readerCollections[i].variableIds[j]` no matter which read finishes first.
  // The two loops below walk those arrays by index, so the walk that fills
  // `variables` (and, with it, the insertion order of `aliasTargets`) is
  // byte-for-byte the walk the sequential version did.
  const readPerCollection = await Promise.all(
    readerCollections.map((rc) => Promise.all(
      rc.variableIds.map((id) => readVariable(reader, id)),
    )),
  );

  for (let i = 0; i < readerCollections.length; i++) {
    const rc = readerCollections[i];
    const variables: RawVariable[] = [];
    for (let j = 0; j < readPerCollection[i].length; j++) {
      const rv = readPerCollection[i][j];
      if (!rv) {
        markSectionUnavailable('variables', rc.variableIds[j]);
        continue;
      }
      for (const value of Object.values(rv.valuesByMode)) {
        if (isAlias(value)) aliasTargets.add(value.id);
      }
      variables.push({
        id: rv.id, name: rv.name, resolvedType: rv.resolvedType,
        description: rv.description, codeSyntax: rv.codeSyntax,
        valuesByMode: rv.valuesByMode,
        scopes: [...rv.scopes],
        ...(typeof rv.hiddenFromPublishing === 'boolean'
          ? { publication: {
              hiddenFromPublishing: rv.hiddenFromPublishing,
              publishStatus: rv.publishStatus ?? null,
              remote: rv.remote,
            } }
          : {}),
      });
    }
    collections.push({
      id: rc.id, name: rc.name,
      modes: rc.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: rc.defaultModeId,
      variableIds: [...rc.variableIds],
      variables,
      ...(typeof rc.hiddenFromPublishing === 'boolean' && typeof rc.remote === 'boolean'
        ? { publication: {
            hiddenFromPublishing: rc.hiddenFromPublishing,
            publishStatus: rc.publishStatus ?? null,
            remote: rc.remote,
          } }
        : {}),
    });
  }

  // One metadata hop per non-local alias target: capture stable identity and
  // provenance, but never values. A remote variable's valuesByMode is keyed by
  // the REMOTE collection's
  // mode ids, which cannot be mapped onto local modes, so any value we read
  // would be a guess about mode correspondence. The arrow is real; the value
  // is honestly absent.
  //
  // Batched the same way, and in the Set's insertion order (which is the walk
  // order above), so `externals` comes out in exactly the sequence the
  // sequential version produced.
  const externalIds = [...aliasTargets].filter((id) => !declaredLocalIds.has(id));
  const externalVars = await Promise.all(externalIds.map((id) => readVariable(reader, id)));
  const externalCollectionNames = await Promise.all(
    externalVars.map((rv) => rv
      ? readCollectionName(reader, rv.variableCollectionId)
      : Promise.resolve(null)),
  );
  const externals: RawExternalRef[] = externalIds.map((id, i) => {
    const rv = externalVars[i];
    const collectionName = externalCollectionNames[i];
    unavailableSources.add(collectionName ?? id);
    return {
      id,
      name: rv?.name ?? null,
      collectionId: rv?.variableCollectionId ?? null,
      collectionName,
      remote: rv?.remote ?? null,
      external: true,
    };
  });

  let readerStyles: ReaderTextStyle[] = [];
  try {
    readerStyles = await reader.textStyles();
  } catch {
    markSectionUnavailable('textStyles', 'figma:textStyles');
  }

  // Batched across styles AND across each style's bound variables. Style order
  // holds because `Promise.all` is argument-ordered; each style's
  // `boundVariables` key order holds because the keys are written back by index
  // over the same `entries` array they were read from, so an unresolvable
  // binding is still dropped from the legacy name map (never written as
  // undefined) without shifting the keys around it. Its exact source id remains
  // in `bindingIds` for v5 even when the variable metadata read fails.
  const textStyles: RawTextStyle[] = await Promise.all(readerStyles.map(async (rs) => {
    const entries = Object.entries(rs.boundVariables ?? {})
      .filter((e): e is [string, { id: string }] => Boolean(e[1]?.id));
    const bound = await Promise.all(entries.map(([, ref]) => readVariable(reader, ref.id)));
    const boundVariables: Record<string, string> = {};
    const bindingIds: Record<string, string> = {};
    entries.forEach(([property], i) => {
      const rv = bound[i];
      if (rv) boundVariables[property] = rv.name;
      bindingIds[property] = entries[i][1].id;
    });
    return {
      ...(rs.id !== undefined ? { id: rs.id } : {}),
      name: rs.name, description: rs.description,
      fontFamily: rs.fontName.family, fontStyle: rs.fontName.style,
      fontSize: rs.fontSize, lineHeight: rs.lineHeight, letterSpacing: rs.letterSpacing,
      paragraphSpacing: rs.paragraphSpacing, paragraphIndent: rs.paragraphIndent,
      textCase: rs.textCase, textDecoration: rs.textDecoration,
      boundVariables,
      ...(Object.keys(bindingIds).length > 0 ? { bindingIds } : {}),
      ...(typeof rs.remote === 'boolean'
        ? { source: { remote: rs.remote, publishStatus: rs.publishStatus ?? null } }
        : {}),
    };
  }));

  let readerEffects: ReaderEffectStyle[] = [];
  try {
    readerEffects = await reader.effectStyles();
  } catch {
    markSectionUnavailable('effectStyles', 'figma:effectStyles');
  }
  const effectStyles: RawEffectStyle[] = readerEffects.map((rs) => {
    const bindings = effectBindingIds(rs.effects);
    return {
      ...(rs.id !== undefined ? { id: rs.id } : {}),
      name: rs.name,
      description: rs.description,
      effects: rs.effects.map((e) => effectLayerOf(e)),
      ...(bindings.length > 0 ? { bindings } : {}),
      ...(typeof rs.remote === 'boolean'
        ? { source: { remote: rs.remote, publishStatus: rs.publishStatus ?? null } }
        : {}),
    };
  });

  return {
    fileKey, ...(fileName !== undefined ? { fileName } : {}),
    collections, textStyles, effectStyles, externals, extractedAt,
    ...(unavailable.length > 0 ? { unavailable } : {}),
    ...(unavailableSources.size > 0
      ? { unavailableSources: [...unavailableSources].sort() }
      : {}),
  };
}

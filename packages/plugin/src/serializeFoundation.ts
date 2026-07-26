/**
 * serializeFoundation.ts — builds the raw foundation dump the extractor turns
 * into a FoundationSpec.
 *
 * Figma-free by construction: it reads through an injected FoundationReader,
 * the same pattern serialize.ts uses with NodeResolver, so the dump logic is
 * unit-testable and main.ts owns the Figma API surface.
 */
import type {
  SerializedFoundation, RawCollection, RawVariable, RawTextStyle, RawExternalRef,
  RawVariableValue, FoundationVariableType, FoundationMode,
} from '@spec-layer/extractor';

export interface ReaderCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variableIds: string[];
}

export interface ReaderVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  variableCollectionId: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
}

export interface ReaderTextStyle {
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
}

/** Injected Figma surface. main.ts supplies the real one; tests a fake. */
export interface FoundationReader {
  collections(): Promise<ReaderCollection[]>;
  variable(id: string): Promise<ReaderVariable | null>;
  textStyles(): Promise<ReaderTextStyle[]>;
  /** Name of a collection that may be remote. Optional: absent → ''. */
  collectionName?(id: string): Promise<string | null>;
}

function isAlias(v: RawVariableValue): v is { type: 'VARIABLE_ALIAS'; id: string } {
  return typeof v === 'object' && v !== null
    && (v as { type?: string }).type === 'VARIABLE_ALIAS';
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
 *  collection, or a throw all mean the same thing here: no name. */
async function readCollectionName(reader: FoundationReader, id: string): Promise<string> {
  if (!reader.collectionName) return '';
  try { return (await reader.collectionName(id)) ?? ''; } catch { return ''; }
}

export async function serializeFoundation(
  reader: FoundationReader, fileKey: string, extractedAt: string,
): Promise<SerializedFoundation> {
  let readerCollections: ReaderCollection[] = [];
  try {
    readerCollections = await reader.collections();
  } catch {
    /* variables API unavailable — an empty foundation is the honest result */
  }

  const collections: RawCollection[] = [];
  const localIds = new Set<string>();
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
  // `variables` (and, with it, the insertion order of `localIds` and
  // `aliasTargets`) is byte-for-byte the walk the sequential version did.
  const readPerCollection = await Promise.all(
    readerCollections.map((rc) => Promise.all(
      rc.variableIds.map((id) => readVariable(reader, id)),
    )),
  );

  for (let i = 0; i < readerCollections.length; i++) {
    const rc = readerCollections[i];
    const variables: RawVariable[] = [];
    for (const rv of readPerCollection[i]) {
      if (!rv) continue;
      localIds.add(rv.id);
      for (const value of Object.values(rv.valuesByMode)) {
        if (isAlias(value)) aliasTargets.add(value.id);
      }
      variables.push({
        id: rv.id, name: rv.name, resolvedType: rv.resolvedType,
        description: rv.description, codeSyntax: rv.codeSyntax,
        valuesByMode: rv.valuesByMode,
      });
    }
    collections.push({
      id: rc.id, name: rc.name,
      modes: rc.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: rc.defaultModeId,
      variables,
    });
  }

  // One hop per non-local alias target: capture its name and collection name
  // only. A remote variable's valuesByMode is keyed by the REMOTE collection's
  // mode ids, which cannot be mapped onto local modes, so any value we read
  // would be a guess about mode correspondence. The arrow is real; the value
  // is honestly absent.
  //
  // Batched the same way, and in the Set's insertion order (which is the walk
  // order above), so `externals` comes out in exactly the sequence the
  // sequential version produced.
  const externalIds = [...aliasTargets].filter((id) => !localIds.has(id));
  const externalVars = (await Promise.all(externalIds.map((id) => readVariable(reader, id))))
    .filter((rv): rv is ReaderVariable => rv !== null);
  const externalCollectionNames = await Promise.all(
    externalVars.map((rv) => readCollectionName(reader, rv.variableCollectionId)),
  );
  const externals: RawExternalRef[] = externalVars.map((rv, i) => ({
    id: rv.id, name: rv.name, collectionName: externalCollectionNames[i],
  }));

  let readerStyles: ReaderTextStyle[] = [];
  try {
    readerStyles = await reader.textStyles();
  } catch {
    /* styles API unavailable */
  }

  // Batched across styles AND across each style's bound variables. Style order
  // holds because `Promise.all` is argument-ordered; each style's
  // `boundVariables` key order holds because the keys are written back by index
  // over the same `entries` array they were read from, so an unresolvable
  // binding is still dropped (never written as undefined) without shifting the
  // keys around it.
  const textStyles: RawTextStyle[] = await Promise.all(readerStyles.map(async (rs) => {
    const entries = Object.entries(rs.boundVariables ?? {})
      .filter((e): e is [string, { id: string }] => Boolean(e[1]?.id));
    const bound = await Promise.all(entries.map(([, ref]) => readVariable(reader, ref.id)));
    const boundVariables: Record<string, string> = {};
    entries.forEach(([property], i) => {
      const rv = bound[i];
      if (rv) boundVariables[property] = rv.name;
    });
    return {
      name: rs.name, description: rs.description,
      fontFamily: rs.fontName.family, fontStyle: rs.fontName.style,
      fontSize: rs.fontSize, lineHeight: rs.lineHeight, letterSpacing: rs.letterSpacing,
      paragraphSpacing: rs.paragraphSpacing, paragraphIndent: rs.paragraphIndent,
      textCase: rs.textCase, textDecoration: rs.textDecoration,
      boundVariables,
    };
  }));

  return { fileKey, collections, textStyles, externals, extractedAt };
}

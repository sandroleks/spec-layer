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

  for (const rc of readerCollections) {
    const variables: RawVariable[] = [];
    for (const id of rc.variableIds) {
      let rv: ReaderVariable | null = null;
      try { rv = await reader.variable(id); } catch { rv = null; }
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
  const externals: RawExternalRef[] = [];
  for (const id of aliasTargets) {
    if (localIds.has(id)) continue;
    let rv: ReaderVariable | null = null;
    try { rv = await reader.variable(id); } catch { rv = null; }
    if (!rv) continue;
    let collectionName = '';
    if (reader.collectionName) {
      try { collectionName = (await reader.collectionName(rv.variableCollectionId)) ?? ''; }
      catch { collectionName = ''; }
    }
    externals.push({ id: rv.id, name: rv.name, collectionName });
  }

  let readerStyles: ReaderTextStyle[] = [];
  try {
    readerStyles = await reader.textStyles();
  } catch {
    /* styles API unavailable */
  }

  const textStyles: RawTextStyle[] = [];
  for (const rs of readerStyles) {
    const boundVariables: Record<string, string> = {};
    for (const [property, ref] of Object.entries(rs.boundVariables ?? {})) {
      if (!ref?.id) continue;
      let rv: ReaderVariable | null = null;
      try { rv = await reader.variable(ref.id); } catch { rv = null; }
      if (rv) boundVariables[property] = rv.name;
    }
    textStyles.push({
      name: rs.name, description: rs.description,
      fontFamily: rs.fontName.family, fontStyle: rs.fontName.style,
      fontSize: rs.fontSize, lineHeight: rs.lineHeight, letterSpacing: rs.letterSpacing,
      paragraphSpacing: rs.paragraphSpacing, paragraphIndent: rs.paragraphIndent,
      textCase: rs.textCase, textDecoration: rs.textDecoration,
      boundVariables,
    });
  }

  return { fileKey, collections, textStyles, externals, extractedAt };
}

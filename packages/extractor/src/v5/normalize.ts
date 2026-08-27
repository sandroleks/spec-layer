/**
 * The v4-to-v5 normalizer — spec §19.
 *
 * v4 (`brief.ts`'s `foundationBrief`/`tokenOf`/`valueOf`) is the input shape
 * here: a plain object with collections of tokens, each mode value flattened
 * to one of FOUR shapes (a bare string, a bare number, a `{hex, alpha}`
 * object, or an `{alias, resolved?}` object). v4 has no stable ids at all —
 * its own rule was that internal Figma ids stay inside the extractor
 * (`brief.ts:120`) — no `scopes`, no publication state, no lifecycle, and its
 * aliases are bare names. Every one of those losses becomes a dedicated
 * diagnostic below rather than a silent guess.
 */
import { canonicalNumber } from './precision';
import { colorFromHex } from './color';
import { numericValue } from './units';
import {
  compareCodeUnits, diagnostic, sortDiagnostics,
} from './diagnostics';
import type { Diagnostic, DiagnosticCode } from './diagnostics';
import type {
  AliasReference, AliasResolution, CanonicalValue, TokenType, UnresolvedReason,
} from './value';
import type { CollectionV5, ExtractionCompleteness, ModeV5, TokenV5 } from './entities';
import { buildEnvelope } from './canonical';
import type { ArtifactSource, FoundationArtifactV5, SemanticPayload } from './canonical';

// ---------------------------------------------------------------------------
// The v4 input shape
// ---------------------------------------------------------------------------

/** v4's four value shapes, collapsed from `valueOf` (brief.ts). A bare
 *  string is EITHER a `string`-typed token's value OR an opaque colour (hex,
 *  implied alpha 1) -- which one it is comes from the owning token's `type`,
 *  never from the value's own shape. */
export interface V4AliasValue {
  alias: string;
  /** The concrete value the alias pointed to, already collapsed to one hop
   *  by v4's own resolution (`resolveValue` in foundation.ts). ABSENT when
   *  v4 could not read the target at all -- which today only happens for an
   *  external alias (`collection` set, `resolved: null` in the internal
   *  model, dropped by `valueOf`'s conditional spread). */
  resolved?: V4Value;
  external?: boolean;
  /** The alias's target collection. v4 emits this ONLY for external aliases
   *  today (`valueOf`'s `v.external && v.targetCollection` guard) -- a local,
   *  same-file alias carries no collection at all, even across collections. */
  collection?: string;
}

export type V4ColorValue = { hex: string; alpha?: number };
export type V4UnresolvedValue = { unresolved: string };

export type V4Value =
  | string | number | boolean | V4ColorValue | V4AliasValue | V4UnresolvedValue;

export type V4TokenType = 'color' | 'float' | 'string' | 'boolean';

export interface V4Token {
  name: string;
  type: V4TokenType;
  description?: string;
  /** Keyed by MODE DISPLAY NAME (`brief.ts:122`) -- v4 has no mode ids. */
  values: Record<string, V4Value>;
}

export interface V4Collection {
  name: string;
  /** Mode display names, in source order -- v4 has no mode ids either. */
  modes: string[];
  default_mode?: string;
  tokens: V4Token[];
}

export interface V4Foundation {
  source?: { file_key?: string };
  collections: V4Collection[];
  /**
   * Source labels v4 could not read (a collection or library name, e.g.
   * `"Color base [deprecated]"`), carried straight through from
   * `FoundationSpec.unavailable` (`foundation.ts:137`) so the fact that a
   * read failed is not lost during migration. Absent on a clean read, never
   * `[]` -- matching v4's own convention for the field.
   *
   * INPUT CONTRACT HONESTY: No real v4 document carries this field today,
   * because `foundationBrief` never serializes `FoundationSpec.unavailable`
   * (confirmed by reading brief.ts lines 209-277). An absent field therefore
   * reads as `completeness.collections: 'complete'` and emits no
   * SOURCE_PARTIALLY_UNAVAILABLE diagnostic — which is the only honest reading
   * of a document that cannot express the fact. Wiring the unavailable field
   * into the v4 emitter is deferred to a later phase where extraction
   * changes belong. An input contract that quietly implies a field real
   * documents do not carry is exactly the kind of fiction this migration exists
   * to prevent.
   */
  unavailable?: string[];
  /**
   * v4's composite styles, which real foundation briefs DO carry
   * (`foundationBrief` emits both, `brief.ts:253-272`).
   *
   * Declared here, and deliberately NOT modelled field by field: Phase 1 does
   * not migrate composite styles at all (§22 Phase 3 owns them), so the only
   * facts this module needs from them are THAT they are present and HOW MANY
   * there are. Typing their interiors would imply this module reads them.
   *
   * They are declared at all because an undeclared field is a silently
   * DISCARDED field. Before this, an input carrying 99 text styles produced
   * `styles.typography: []`, `statistics.styles.typography: 0`,
   * `completeness.styles: 'complete'` and no diagnostic -- an artifact stating
   * that the file has no text styles, which is a different fact from "99 were
   * not migrated". `completeness` exists to make that distinction, so the
   * fields have to reach it.
   */
  text_styles?: unknown[];
  effect_styles?: unknown[];
}

export interface NormalizeMeta { exportId: string; generatedAt: string }

export interface NormalizeResult { artifact: FoundationArtifactV5; diagnostics: Diagnostic[] }

// ---------------------------------------------------------------------------
// Injective synthetic ids — §19 decision 1
// ---------------------------------------------------------------------------

/**
 * Mints an injective id from a name, since v4 has none.
 *
 * `figma-name:<kind>:<encoded collection>/<encoded segments joined by />`,
 * every segment through `encodeURIComponent` so a literal `/` becomes `%2F`
 * and a literal `%` becomes `%25`. Without that, `figma-name:Color/color/bg/brand`
 * is ambiguous: a token literally named `bg/brand` in group `color` and one
 * named `brand` in group `color/bg` produce the same string.
 *
 * The `figma-name:` prefix stops a consumer mistaking a migrated id for a
 * stable Figma one. The kind is part of the id so a token and a style with
 * one path never collide. Readable, unlike a hash, which matters because a
 * human reads the migrated fixture.
 */
export function syntheticId(kind: string, collection: string, path: string[]): string {
  const encodedCollection = encodeURIComponent(collection);
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  return `figma-name:${kind}:${encodedCollection}${encodedPath ? `/${encodedPath}` : ''}`;
}

/**
 * Synthetic mode ids use the same percent-encoding, scoped under the
 * collection's own id: v4 keys a token's values by mode DISPLAY NAME
 * (`brief.ts:122`), so the same collision risk applies to mode names.
 */
function syntheticModeId(collectionId: string, modeName: string): string {
  return `${collectionId}/${encodeURIComponent(modeName)}`;
}

// ---------------------------------------------------------------------------
// Path parsing — respects v4's `\/` escape
// ---------------------------------------------------------------------------

/**
 * Splits a v4 name on `/`, honouring v4's escape convention: a literal slash
 * inside one node's name is written `\/`. A naive `.split('/')` would turn
 * one segment into two.
 */
export function parseV4Path(raw: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1] === '/') {
      current += '/';
      i += 1;
    } else if (ch === '/') {
      segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

/** True when `s` holds any character outside the ASCII range -- surrogate
 *  pairs included, since this walks by code point rather than by UTF-16
 *  unit. Not a regex: ESLint's `no-control-regex` flags a `\x00`/`\x7F`
 *  boundary written into a character class, control characters or not. */
function hasNonAscii(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code > 0x7f) return true;
  }
  return false;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

const ARTIFACT_ENTITY_ID = '<artifact>';

/**
 * What goes into `default_mode_id` when v4 states no usable default mode.
 *
 * DELIBERATELY not a mode id, and deliberately not `modes[0].id`.
 *
 * §7 requires `default_mode_id` to reference a declared mode id, and the field
 * is not nullable, so an input that does not state a usable default cannot be
 * represented truthfully at all. Given that, the choice is between a value
 * downstream validation REJECTS and one it silently ACCEPTS. Substituting
 * `modes[0]` is the second: it produces an artifact that passes every level
 * while asserting a default the designer never chose, and a generator reading
 * it has no way to tell that from a stated one. This sentinel is the first:
 * `validateLevel2`'s default-mode check reports it as UNRESOLVED_REFERENCE, so
 * the artifact is visibly incomplete rather than plausibly wrong.
 *
 * The accompanying diagnostic from `buildCollections` is what says which of the
 * two cases (absent, or stated-but-unresolvable) produced it.
 */
const UNSTATED_DEFAULT_MODE_ID = '<no-default-mode-stated>';

const V4_TYPE_TO_V5: Record<V4TokenType, TokenType> = {
  color: 'color',
  // v4 carries no `scopes`, so a float can never be stated as a dimension --
  // see decision 2 in convertLiteral below.
  float: 'number',
  string: 'string',
  boolean: 'boolean',
};

// ---------------------------------------------------------------------------
// Value shape guards
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isAliasShape = (v: V4Value): v is V4AliasValue =>
  isRecord(v) && typeof (v as Record<string, unknown>).alias === 'string';

const isUnresolvedShape = (v: V4Value): v is V4UnresolvedValue =>
  isRecord(v) && typeof (v as Record<string, unknown>).unresolved === 'string';

const isColorObjectShape = (v: V4Value): v is V4ColorValue =>
  isRecord(v) && typeof (v as Record<string, unknown>).hex === 'string';

// ---------------------------------------------------------------------------
// Collection + token identity minting
// ---------------------------------------------------------------------------

interface CollectionBuild {
  v4: V4Collection;
  v5: CollectionV5;
  modeIdByName: Map<string, string>;
}

interface TokenIndexEntry {
  id: string;
  path: string[];
  collectionName: string;
  collectionId: string;
}

function buildCollections(v4: V4Foundation, diagnostics: Diagnostic[]): CollectionBuild[] {
  return v4.collections.map((c) => {
    const name = c.name.normalize('NFC');
    const path = parseV4Path(name);
    const id = syntheticId('collection', name, []);

    const modeIdByName = new Map<string, string>();
    const modes: ModeV5[] = c.modes.map((modeName, order) => {
      const modeId = syntheticModeId(id, modeName);
      modeIdByName.set(modeName, modeId);
      return { id: modeId, name: modeName, order };
    });

    // The default mode is either STATED and resolvable, or it is not stated at
    // all. There is no third, substitutable case: falling through to
    // `modes[0]` (which this did before) discards a stated-but-unresolvable
    // value AND invents an unstated one, in both cases with no diagnostic, so
    // an artifact carrying a designer's real choice and one carrying the
    // normalizer's guess were byte-identical.
    const statedDefault = c.default_mode;
    const statedDefaultId = statedDefault !== undefined
      ? modeIdByName.get(statedDefault)
      : undefined;
    const defaultModeId = statedDefaultId ?? UNSTATED_DEFAULT_MODE_ID;

    if (statedDefaultId === undefined) {
      diagnostics.push(diagnostic('UNRESOLVED_REFERENCE', {
        entity_id: id,
        message: statedDefault !== undefined
          ? `Collection "${name}" states default mode "${statedDefault}", which is not one of `
            + `the ${c.modes.length} mode(s) it declares. No substitute was chosen: picking one `
            + 'would state a default the source does not.'
          : `Collection "${name}" states no default mode, and v5 requires default_mode_id to name `
            + 'a declared mode. No substitute was chosen: picking one would state a default the '
            + 'source does not.',
        details: {
          ...(statedDefault !== undefined ? { stated_default_mode: statedDefault } : {}),
          declared_modes: modes.map((m) => m.id),
          default_mode_id: defaultModeId,
        },
      }));
    }

    diagnostics.push(diagnostic('SYNTHETIC_IDENTITY', {
      entity_id: id,
      message: `Collection "${name}"'s id was derived from its name because v4 carries no `
        + 'stable id; a rename will read as a delete plus an add until re-extraction.',
    }));
    if (hasNonAscii(name)) {
      diagnostics.push(diagnostic('CONFUSABLE_NAME', {
        entity_id: id,
        message: `Collection name "${name}" contains non-ASCII characters. Preserved as-is, `
          + 'never replaced with a generated name.',
      }));
    }

    const v5: CollectionV5 = {
      id, name, path, default_mode_id: defaultModeId, modes,
    };
    return { v4: c, v5, modeIdByName };
  });
}

// ---------------------------------------------------------------------------
// Literal value conversion
// ---------------------------------------------------------------------------

/**
 * Converts one v4 literal (never an alias or an `{unresolved}` marker -- both
 * are handled by the caller) into a v5 `CanonicalValue`. Shared between a
 * token's own mode value and an alias's embedded `resolved` snapshot, since
 * both use the identical four v4 shapes.
 */
function convertLiteral(
  raw: V4Value, tokenType: V4TokenType, entityId: string, modeId: string, diagnostics: Diagnostic[],
): CanonicalValue {
  switch (tokenType) {
    case 'color': {
      let hex: string;
      let alpha: number;
      if (typeof raw === 'string') {
        hex = raw;
        alpha = 1;
      } else if (isColorObjectShape(raw)) {
        hex = raw.hex;
        alpha = typeof raw.alpha === 'number' ? raw.alpha : 1;
      } else {
        diagnostics.push(diagnostic('INVALID_SOURCE_COLOR', {
          entity_id: entityId, mode_id: modeId,
          message: `Colour value is not a v4 colour shape (a hex string or {hex, alpha}): ${JSON.stringify(raw)}.`,
        }));
        return { kind: 'missing', reason: 'invalid_source_value' };
      }
      const result = colorFromHex(hex, alpha);
      if (result.ok) return { kind: 'literal', value: result.value };
      // colorFromHex REJECTS rather than repairs (see color.ts) -- a
      // malformed colour becomes `missing` plus a diagnostic, never a
      // clamped or padded guess. Decision 4 / Task 3.
      diagnostics.push(diagnostic('INVALID_SOURCE_COLOR', {
        entity_id: entityId, mode_id: modeId,
        message: `Colour could not be canonicalized: ${result.reason}`,
      }));
      return { kind: 'missing', reason: 'invalid_source_value' };
    }
    case 'float': {
      if (typeof raw !== 'number') {
        diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
          entity_id: entityId, mode_id: modeId,
          message: `Expected a numeric value, got ${JSON.stringify(raw)}.`,
        }));
        return { kind: 'missing', reason: 'unsupported_value_type' };
      }
      // v4 carries no `scopes` at all, so `numericValue` always returns
      // null here -- there is no unit to state. The NUMBER is real data and
      // must survive; only the unit CLAIM is lost. Decision 2: `type:
      // number` plus UNIT_METADATA_UNAVAILABLE, never `missing` (which
      // would discard real data) and never a guessed `dimension`/`px`
      // (which would fabricate one). Deliberately not UNSUPPORTED_VALUE_TYPE,
      // which means a value that cannot be represented at all.
      const dimensionOrNumber = numericValue(raw, []);
      if (dimensionOrNumber !== null) return { kind: 'literal', value: dimensionOrNumber };
      diagnostics.push(diagnostic('UNIT_METADATA_UNAVAILABLE', {
        entity_id: entityId, mode_id: modeId,
        message: 'v4 carries no scopes for this variable, so its unit is unknown. '
          + 'Re-extract from Figma to recover it.',
      }));
      return { kind: 'literal', value: { type: 'number', value: canonicalNumber(raw) } };
    }
    case 'string': {
      if (typeof raw !== 'string') {
        diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
          entity_id: entityId, mode_id: modeId,
          message: `Expected a string value, got ${JSON.stringify(raw)}.`,
        }));
        return { kind: 'missing', reason: 'unsupported_value_type' };
      }
      return { kind: 'literal', value: { type: 'string', value: raw } };
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') {
        diagnostics.push(diagnostic('UNSUPPORTED_VALUE_TYPE', {
          entity_id: entityId, mode_id: modeId,
          message: `Expected a boolean value, got ${JSON.stringify(raw)}.`,
        }));
        return { kind: 'missing', reason: 'unsupported_value_type' };
      }
      return { kind: 'literal', value: { type: 'boolean', value: raw } };
    }
    default: {
      const _exhaustive: never = tokenType;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Alias resolution — §19 decision 3, stated not improvised
// ---------------------------------------------------------------------------

function unresolvedAliasDiagnosticCode(reason: UnresolvedReason): DiagnosticCode {
  if (reason === 'ambiguous_target') return 'AMBIGUOUS_ALIAS_TARGET';
  if (reason === 'cycle') return 'ALIAS_CYCLE';
  if (reason === 'source_library_unavailable') return 'UNRESOLVED_EXTERNAL_ALIAS';
  // The alias TARGET resolved; what did not is the target collection's
  // default-mode reference. UNRESOLVED_ALIAS would tell a consumer the wrong
  // thing -- that someone aliased a variable that is not there.
  if (reason === 'target_mode_unresolvable') return 'UNRESOLVED_REFERENCE';
  return 'UNRESOLVED_ALIAS';
}

/**
 * A collection's `default_mode_id`, but ONLY when it actually names one of that
 * collection's declared modes (§7). `undefined` otherwise -- including for the
 * `UNSTATED_DEFAULT_MODE_ID` sentinel, which is the whole reason this is a
 * function and not a field read: a caller must not be able to pass the sentinel
 * on into a `mode_id` slot without noticing.
 */
function declaredDefaultModeId(build: CollectionBuild | undefined): string | undefined {
  if (build === undefined) return undefined;
  const defaultModeId = build.v5.default_mode_id;
  return build.v5.modes.some((m) => m.id === defaultModeId) ? defaultModeId : undefined;
}

function unresolvedAlias(
  reference: AliasReference, reason: UnresolvedReason, entityId: string, modeId: string,
  message: string, diagnostics: Diagnostic[], details?: Record<string, unknown>,
): CanonicalValue {
  diagnostics.push(diagnostic(unresolvedAliasDiagnosticCode(reason), {
    entity_id: entityId, mode_id: modeId, message, ...(details !== undefined ? { details } : {}),
  }));
  return {
    kind: 'alias',
    reference,
    resolved: { status: 'unresolved', reason, value: null, chain: [] },
  };
}

function convertAlias(
  alias: V4AliasValue, ownerType: V4TokenType, entityId: string, modeId: string, ownerCollectionId: string,
  tokenIndex: TokenIndexEntry[], collectionsByV5Id: Map<string, CollectionBuild>, diagnostics: Diagnostic[],
): CanonicalValue {
  const targetPath = parseV4Path(alias.alias.normalize('NFC'));
  const byPath = tokenIndex.filter((t) => arraysEqual(t.path, targetPath));
  // Decision 3, step 1: match on (collection, path) ONLY when v4 states a
  // collection -- never fall back to the unqualified pool in that case, or a
  // qualified miss would silently widen into an unqualified guess.
  const collectionName = alias.collection?.normalize('NFC');
  const candidates = collectionName !== undefined
    ? byPath.filter((t) => t.collectionName === collectionName)
    : byPath;

  const external = alias.collection !== undefined;
  const baseReference = {
    target_path: targetPath,
    external,
    ...(alias.collection !== undefined ? { source_library_name: alias.collection } : {}),
  };

  // Decision 3, step 3: two or more matches is reported, never resolved by
  // picking the first one.
  if (candidates.length > 1) {
    return unresolvedAlias(
      { ...baseReference, target_id: null, target_collection_id: null },
      'ambiguous_target', entityId, modeId,
      `Alias "${alias.alias}" matches more than one token by name; v4 has no id to `
        + 'disambiguate, so no target was picked.',
      diagnostics,
      { candidates: candidates.map((c) => ({ id: c.id, collection: c.collectionName, path: c.path })) },
    );
  }

  const target = candidates[0];

  if (target === undefined) {
    const reason: UnresolvedReason = external ? 'source_library_unavailable' : 'target_not_found';
    return unresolvedAlias(
      { ...baseReference, target_id: null, target_collection_id: null },
      reason, entityId, modeId,
      external
        ? `Alias "${alias.alias}" names a target in "${alias.collection}", a source this export could not read.`
        : `Alias "${alias.alias}" names no token this export could find.`,
      diagnostics,
    );
  }

  const reference: AliasReference = {
    ...baseReference, target_id: target.id, target_collection_id: target.collectionId,
  };

  // RULE 1's resolved terminal: unreachable with today's v4 output. Rule 1 (the
  // `(collection, path)` match above) is structurally live and necessary for
  // narrowing candidates and computing the target_id/target_collection_id that
  // feed both branch 2 and the ambiguity check. However, reaching the
  // `alias.resolved === undefined` case that follows requires an alias with a
  // `collection` field. Per brief.ts's `valueOf` (lines 100-109), v4 only
  // emits `collection` on external aliases; external aliases by definition have
  // `resolved: null` in the internal model, and `valueOf`'s conditional spread
  // drops the falsy `resolved` field entirely from the brief output. An alias
  // with a collection therefore always lacks the `resolved` value this check
  // would need. This terminal is kept because it becomes reachable when v4
  // qualifies internal cross-collection aliases with collection names too —
  // backlog item A4. When that day comes, a local token matching the (collection,
  // path) pair becomes proof of the target's identity.
  if (alias.resolved === undefined) {
    // Today v4 omits `resolved` ONLY for a genuinely external alias (the
    // internal model's `resolved: null`, dropped by `valueOf`'s conditional
    // spread). We know structurally which local token the name/collection
    // pair WOULD match, but claiming that local token IS the target would be
    // fabrication: an external reference points at a variable in a
    // different file, and a same-named local token need not be the same
    // entity. So the reference names it (for lineage) while resolution
    // stays unresolved.
    return unresolvedAlias(
      reference, 'source_library_unavailable', entityId, modeId,
      `Alias "${alias.alias}" matched a token by name, but v4 recorded no value for it `
        + '(its source was unreadable at export time).',
      diagnostics,
    );
  }

  if (isUnresolvedShape(alias.resolved)) {
    // v4 itself already tried and failed (a cycle or its own depth limit,
    // `foundation.ts`'s `resolveValue`) -- carry that fact over rather than
    // re-deriving it, since v4's chain walk saw hops we no longer have.
    const reasonByV4Reason: Record<string, UnresolvedReason> = {
      cycle: 'cycle', depth: 'depth_exceeded', external: 'source_library_unavailable',
    };
    const reason = reasonByV4Reason[alias.resolved.unresolved] ?? 'target_not_found';
    return unresolvedAlias(
      reference, reason, entityId, modeId,
      `Alias "${alias.alias}" could not be resolved to a value by v4 (${alias.resolved.unresolved}).`,
      diagnostics,
    );
  }

  // A concrete literal. An alias must share its owning token's declared
  // type (Figma enforces this), so it converts the same way a direct value
  // of that type would.
  const literal = convertLiteral(alias.resolved, ownerType, entityId, modeId, diagnostics);
  if (literal.kind !== 'literal') {
    // convertLiteral already reported the specific failure (e.g.
    // INVALID_SOURCE_COLOR). `type_mismatch` is the closest existing
    // UnresolvedReason for "the source stated something this alias's type
    // cannot hold."
    return unresolvedAlias(reference, 'type_mismatch', entityId, modeId,
      `Alias "${alias.alias}" resolved to a value v4 could not represent as its declared type.`,
      diagnostics);
  }

  // One visible hop, matching v4's own chain (which is already collapsed to
  // one hop by the time it reaches the brief -- see `resolveValue`'s
  // "Collapse a chain to one visible hop" comment).
  //
  // WHICH MODE THE HOP READS. One rule, and it is the SAME rule
  // `walkAliasGraph` in validate.ts applies:
  //
  //  - same collection: the mode carries across unchanged, because it is
  //    literally the same mode.
  //  - different collection: the TARGET collection's default mode. Mode ids
  //    are collection-scoped (see syntheticModeId), so the source mode id does
  //    not exist in the target at all, and Figma itself resolves a
  //    cross-collection alias through whichever mode the consuming context
  //    selects for the target collection, defaulting to that collection's
  //    default mode.
  //
  // This deliberately does NOT replicate v4's `targetModeId`
  // (foundation.ts:389), which matched the source mode's display NAME in the
  // target collection first. That is name-based inference -- the thing §10
  // exists to eliminate -- and it is not what Figma does: two collections
  // owning a mode called "light" is a naming coincidence, not a relationship.
  //
  // The rules MUST stay identical between the two modules. If they diverge,
  // one fact ("which mode did this hop read?") has two owners with two
  // answers, and validate.ts ends up reporting normalize.ts's own output as
  // wrong -- which is precisely the class of bug this fix wave is closing.
  const targetModeId = target.collectionId === ownerCollectionId
    ? modeId
    : declaredDefaultModeId(collectionsByV5Id.get(target.collectionId));

  if (targetModeId === undefined) {
    // The target token exists and v4 even handed us its value, but the mode
    // the hop reads it under cannot be named: the target collection declares
    // no usable default. The previous `?? target.id` fallback wrote the TARGET
    // TOKEN's id into a `mode_id` slot -- a value of entirely the wrong kind,
    // which no validation level would catch and which a consumer would read as
    // a real mode. Reporting is the only honest option; see
    // `target_mode_unresolvable` in value.ts.
    return unresolvedAlias(
      reference, 'target_mode_unresolvable', entityId, modeId,
      `Alias "${alias.alias}" resolves into collection "${target.collectionName}", which declares `
        + 'no usable default mode, so the mode this hop reads cannot be stated.',
      diagnostics,
      { target_collection_id: target.collectionId },
    );
  }

  const resolved: AliasResolution = {
    status: 'resolved', value: literal.value, chain: [{ token_id: target.id, mode_id: targetModeId }],
  };
  return { kind: 'alias', reference, resolved };
}

// ---------------------------------------------------------------------------
// The normalizer
// ---------------------------------------------------------------------------

export function normalizeV4(v4: V4Foundation, meta: NormalizeMeta): NormalizeResult {
  const diagnostics: Diagnostic[] = [];

  const collectionsBuild = buildCollections(v4, diagnostics);
  const collectionsByV5Id = new Map(collectionsBuild.map((c) => [c.v5.id, c]));

  interface TokenBuild { v4: V4Token; id: string; name: string; path: string[]; collBuild: CollectionBuild }
  const tokenBuilds: TokenBuild[] = [];
  const tokenIndex: TokenIndexEntry[] = [];
  for (const collBuild of collectionsBuild) {
    for (const t of collBuild.v4.tokens) {
      const name = t.name.normalize('NFC');
      const path = parseV4Path(name);
      const id = syntheticId('token', collBuild.v5.name, path);
      tokenBuilds.push({
        v4: t, id, name, path, collBuild,
      });
      tokenIndex.push({
        id, path, collectionName: collBuild.v5.name, collectionId: collBuild.v5.id,
      });
    }
  }

  const tokens: TokenV5[] = tokenBuilds.map(({
    v4: t, id, name, path, collBuild,
  }) => {
    diagnostics.push(diagnostic('SYNTHETIC_IDENTITY', {
      entity_id: id,
      message: `Token "${name}"'s id was derived from its name because v4 carries no stable `
        + 'id; a rename will read as a delete plus an add until re-extraction.',
    }));
    if (hasNonAscii(name)) {
      diagnostics.push(diagnostic('CONFUSABLE_NAME', {
        entity_id: id,
        message: `Token name "${name}" contains non-ASCII characters. Preserved as-is, never `
          + 'replaced with a generated name.',
      }));
    }

    const values: Record<string, CanonicalValue> = {};
    // Iterates the COLLECTION'S DECLARED MODES, not `Object.entries(t.values)`.
    //
    // §8.2 requires "one value entry for every declared mode, or an explicit
    // missing-value record", and iterating the v4 values gave neither for a
    // mode v4 simply did not mention: no key, and no diagnostic. The artifact
    // then failed its OWN `validateLevel2` (checkModeCompleteness reports
    // exactly that gap as MISSING_MODE_VALUE), so normalize and validate
    // contradicted each other about the same artifact.
    //
    // A mode name present in `t.values` but NOT declared by the collection is
    // stale (the mode was deleted after the value was recorded) and is
    // therefore not visited at all. That matches v4's own `tokenOf`, which
    // drops a mode id with no name (`brief.ts:117-123`): keying a v5 value by a
    // mode this collection no longer declares would assert a mode that does
    // not exist.
    for (const mode of collBuild.v5.modes) {
      const stated = Object.prototype.hasOwnProperty.call(t.values, mode.name);
      if (!stated) {
        diagnostics.push(diagnostic('MISSING_MODE_VALUE', {
          entity_id: id, mode_id: mode.id,
          message: `v4 states no value for declared mode "${mode.name}"; recorded as explicitly `
            + 'missing rather than omitted, so an absent value stays distinguishable from an '
            + 'unexported one (§7).',
        }));
        values[mode.id] = { kind: 'missing', reason: 'no_value_for_mode' };
        continue;
      }
      const raw = t.values[mode.name];
      if (isAliasShape(raw)) {
        values[mode.id] = convertAlias(
          raw, t.type, id, mode.id, collBuild.v5.id, tokenIndex, collectionsByV5Id, diagnostics,
        );
      } else if (isUnresolvedShape(raw)) {
        diagnostics.push(diagnostic('MISSING_MODE_VALUE', {
          entity_id: id, mode_id: mode.id,
          message: `v4 recorded no value for this mode (${raw.unresolved}); the source never `
            + 'stated one.',
        }));
        values[mode.id] = { kind: 'missing', reason: 'no_value_for_mode' };
      } else {
        values[mode.id] = convertLiteral(raw, t.type, id, mode.id, diagnostics);
      }
    }

    return {
      id,
      name,
      path,
      collection_id: collBuild.v5.id,
      type: V4_TYPE_TO_V5[t.type],
      description: t.description ?? '',
      // v4 carries no Figma `scopes` at all -- see `numericValue`'s contract
      // in units.ts, which is exactly why a float can never become a
      // dimension here.
      scopes: [],
      values,
    };
  });

  const collections = collectionsBuild.map((c) => c.v5);

  const unavailableSources = [...(v4.unavailable ?? [])].sort(compareCodeUnits);
  for (const source of unavailableSources) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ARTIFACT_ENTITY_ID,
      message: `v4 could not read "${source}"; this export is missing whatever that source held.`,
      details: { source },
    }));
  }

  // Composite styles are NOT migrated by Phase 1 (§22 Phase 3 owns them, and
  // adding them here would be scope creep). What Phase 1 must not do is claim
  // the input had none.
  //
  // `styles.typography: []` plus `completeness.styles: 'complete'` states "this
  // file has no text styles". For a real v4 brief -- which carries `text_styles`
  // and `effect_styles` whenever the file has any (`brief.ts:253-272`) -- that
  // is false, and a consumer cannot tell it from a file that genuinely has
  // none. `completeness` exists precisely so the two are different artifacts,
  // and because it is HASHED, the difference also shows up in a semantic diff.
  const typographyNotMigrated = v4.text_styles?.length ?? 0;
  const effectsNotMigrated = v4.effect_styles?.length ?? 0;
  const stylesNotMigrated = typographyNotMigrated + effectsNotMigrated;
  if (stylesNotMigrated > 0) {
    diagnostics.push(diagnostic('SOURCE_PARTIALLY_UNAVAILABLE', {
      entity_id: ARTIFACT_ENTITY_ID,
      message: `v4 states ${typographyNotMigrated} text style(s) and ${effectsNotMigrated} effect `
        + 'style(s) that this migration does not carry across: composite styles are not part of '
        + 'the Phase 1 value model. They are absent from this artifact, not from the source file.',
      details: {
        typography_not_migrated: typographyNotMigrated,
        effects_not_migrated: effectsNotMigrated,
      },
    }));
  }

  const completeness: ExtractionCompleteness = {
    collections: unavailableSources.length > 0 ? 'partial' : 'complete',
    // 'complete' ONLY when the input genuinely states no composite styles.
    // 'partial' rather than 'unavailable' because the collections and tokens in
    // the same artifact did migrate -- 'unavailable' would overstate the loss.
    styles: stylesNotMigrated > 0 ? 'partial' : 'complete',
    // `unavailable_sources` stays empty here on purpose: these styles were read
    // fine, they are simply not migrated. Listing them as unreadable sources
    // would misattribute a scope decision to a read failure.
    unavailable_sources: unavailableSources,
  };

  const payload: SemanticPayload = {
    completeness,
    collections,
    tokens,
    styles: { typography: [], effects: [] },
  };

  const source: ArtifactSource = {
    provider: 'figma',
    file_id: v4.source?.file_key ?? null,
    file_name: null,
    file_version: null,
    library_enabled: false,
  };

  const spec_layer = buildEnvelope(payload, {
    exportId: meta.exportId, generatedAt: meta.generatedAt, build: null, source,
  });

  // Decision 8 / the review finding on Task 8: `diagnostics` is sorted here,
  // once, right before it becomes part of the artifact -- never accumulated
  // in whatever order the two walks above happened to visit collections and
  // tokens in.
  const sortedDiagnostics = sortDiagnostics(diagnostics);

  const statistics = computeStatistics({
    collections, tokens, styles: payload.styles, diagnostics: sortedDiagnostics,
  });

  const artifact: FoundationArtifactV5 = {
    ...payload,
    spec_layer,
    diagnostics: sortedDiagnostics,
    statistics,
  };

  return { artifact, diagnostics: sortedDiagnostics };
}

// ---------------------------------------------------------------------------
// Statistics — §15, computed from the finished artifact
// ---------------------------------------------------------------------------

/**
 * Computed FROM the already-built payload and diagnostics, never accumulated
 * during the walk above. §15 requires statistics to be derivable from the
 * artifact; computing them from the output is what makes that true by
 * construction rather than by discipline (decision 8, and the same principle
 * Task 8's `validateLevel2` statistics check relies on).
 */
function computeStatistics(built: {
  collections: CollectionV5[]; tokens: TokenV5[];
  styles: { typography: unknown[]; effects: unknown[] }; diagnostics: Diagnostic[];
}): Record<string, unknown> {
  const { collections, tokens, styles, diagnostics } = built;

  const modes = collections.reduce((sum, c) => sum + c.modes.length, 0);

  const allValues = tokens.flatMap((t) => Object.values(t.values));
  const aliasValues = allValues.filter((v) => v.kind === 'alias');
  const resolvedAliases = aliasValues.filter((v) => v.resolved.status === 'resolved').length;

  const lifecycle = { active: 0, deprecated: 0, archived: 0 };
  for (const t of tokens) {
    // Phase 1 never populates `lifecycle` for a migrated token (v4 states
    // none) -- a token with no lifecycle state is left out of every bucket
    // rather than assumed active, which would be a claim v4 never made.
    if (t.lifecycle !== undefined) lifecycle[t.lifecycle.status] += 1;
  }

  const diagnosticCounts = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) diagnosticCounts[d.severity] += 1;

  return {
    collections: collections.length,
    modes,
    tokens: tokens.length,
    styles: { typography: styles.typography.length, effects: styles.effects.length },
    aliases: {
      total: aliasValues.length,
      resolved: resolvedAliases,
      unresolved: aliasValues.length - resolvedAliases,
    },
    lifecycle,
    diagnostics: diagnosticCounts,
  };
}

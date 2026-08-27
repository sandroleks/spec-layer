/**
 * Level 1 validation — spec §18 "Schema validity".
 *
 * A hand-written mirror of `schema/foundation-5.0.0.json`, kept separate
 * because the plugin sandbox cannot load `ajv` (see the module comment on
 * that schema file). The published schema is for consumers; this is what the
 * plugin itself runs. `test/v5/schemaParity.test.ts` is what keeps the two
 * from drifting apart.
 *
 * Two diagnostic codes carry the whole of this file's judgment, and they mean
 * different things:
 *
 *  - `INCONSISTENT_VALUE_SHAPE` — the JSON is not the shape the discriminated
 *    union promises: a missing or unrecognized discriminant (`kind`, a typed
 *    value's `type`, an alias resolution's `status`), a bare primitive where
 *    an object belongs, a required structural key absent (a resolution chain
 *    step with no `mode_id`, an alias with no `reference`).
 *  - `UNSUPPORTED_VALUE_TYPE` — the discriminant is fine and the object is a
 *    typed value of a KNOWN kind, but a leaf field inside it cannot be
 *    represented: no unit, a unit outside the vocabulary, a hex that is not
 *    six lowercase digits, a non-finite number, an alpha outside 0..1.
 *
 * `validateLevel1` never throws. Every field access below is preceded by a
 * `typeof` / `Array.isArray` guard, because a validator that crashes on
 * malformed input cannot report on the one input where reporting matters.
 */
import { compareCodeUnits, diagnostic } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import { SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS, SUPPORTED_VALUE_KINDS } from './value';
import type { TokenType, Unit } from './value';
import type { TokenV5 } from './entities';
import type { FoundationArtifactV5 } from './canonical';

const ROOT = '<artifact>';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

const HEX_RE = /^#[0-9a-f]{6}$/;

function shape(
  entityId: string, message: string, modeId?: string,
): Diagnostic {
  return diagnostic('INCONSISTENT_VALUE_SHAPE', {
    entity_id: entityId, message, ...(modeId !== undefined ? { mode_id: modeId } : {}),
  });
}

function unsupported(
  entityId: string, message: string, modeId?: string,
): Diagnostic {
  return diagnostic('UNSUPPORTED_VALUE_TYPE', {
    entity_id: entityId, message, ...(modeId !== undefined ? { mode_id: modeId } : {}),
  });
}

/**
 * A leaf-level typed value (§9), reached once its `type` discriminant is
 * already known to be one of `SUPPORTED_TOKEN_TYPES` — every failure from
 * here down is content the shape cannot carry, never a shape problem.
 */
function validateTypedValue(
  type: TokenType, tv: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string,
): void {
  switch (type) {
    case 'color': {
      if (tv.color_space !== 'srgb') {
        out.push(unsupported(entityId, 'color.color_space must be "srgb".', modeId));
      }
      if (typeof tv.hex !== 'string' || !HEX_RE.test(tv.hex)) {
        out.push(unsupported(entityId, 'color.hex must be six lowercase hex digits with a leading "#".', modeId));
      }
      if (!isFiniteNumber(tv.alpha) || tv.alpha < 0 || tv.alpha > 1) {
        out.push(unsupported(entityId, 'color.alpha must be a finite number between 0 and 1.', modeId));
      }
      if (tv.channels !== undefined) {
        const channels = tv.channels;
        if (!Array.isArray(channels) || channels.length !== 3 || !channels.every(isFiniteNumber)) {
          out.push(unsupported(entityId, 'color.channels must be three finite numbers when present.', modeId));
        }
      }
      break;
    }
    case 'dimension': {
      if (!isFiniteNumber(tv.number)) {
        out.push(unsupported(entityId, 'dimension.number must be a finite number.', modeId));
      }
      if (typeof tv.unit !== 'string' || !SUPPORTED_UNITS.includes(tv.unit as Unit)) {
        out.push(unsupported(entityId, 'dimension.unit is missing or outside the supported unit vocabulary.', modeId));
      }
      break;
    }
    case 'number': {
      if (!isFiniteNumber(tv.value)) {
        out.push(unsupported(entityId, 'number.value must be a finite number.', modeId));
      }
      break;
    }
    case 'string': {
      if (typeof tv.value !== 'string') {
        out.push(unsupported(entityId, 'string.value must be a string.', modeId));
      }
      break;
    }
    case 'boolean': {
      if (typeof tv.value !== 'boolean') {
        out.push(unsupported(entityId, 'boolean.value must be a boolean.', modeId));
      }
      break;
    }
    case 'duration': {
      if (!isFiniteNumber(tv.number)) {
        out.push(unsupported(entityId, 'duration.number must be a finite number.', modeId));
      }
      if (tv.unit !== 'ms' && tv.unit !== 's') {
        out.push(unsupported(entityId, 'duration.unit must be "ms" or "s".', modeId));
      }
      break;
    }
    case 'cubic_bezier': {
      const value = tv.value;
      if (!Array.isArray(value) || value.length !== 4 || !value.every(isFiniteNumber)) {
        out.push(unsupported(entityId, 'cubic_bezier.value must be four finite numbers.', modeId));
      }
      break;
    }
    case 'font_family': {
      if (typeof tv.value !== 'string') {
        out.push(unsupported(entityId, 'font_family.value must be a string.', modeId));
      }
      break;
    }
    default:
      // Exhaustive over TokenType; unreachable when `type` was already
      // checked against SUPPORTED_TOKEN_TYPES by the caller.
      break;
  }
}

/** Dispatches on the typed value's own `type` discriminant, which is what
 *  decides shape (INCONSISTENT_VALUE_SHAPE) vs. content (UNSUPPORTED_VALUE_TYPE). */
function validateTypedValueEnvelope(
  value: unknown, entityId: string, out: Diagnostic[], modeId?: string,
): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'A typed value must be an object.', modeId));
    return;
  }
  const { type } = value;
  if (typeof type !== 'string' || !SUPPORTED_TOKEN_TYPES.includes(type as TokenType)) {
    out.push(shape(entityId, `Typed value has an unrecognized or missing "type" discriminant: ${JSON.stringify(type)}.`, modeId));
    return;
  }
  validateTypedValue(type as TokenType, value, entityId, out, modeId);
}

function validateChainStep(step: unknown, entityId: string, out: Diagnostic[], modeId?: string): void {
  if (!isRecord(step) || typeof step.token_id !== 'string' || typeof step.mode_id !== 'string') {
    out.push(shape(entityId, 'A resolution chain step must carry both token_id and mode_id.', modeId));
  }
}

function validateAliasReference(ref: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string): void {
  if (!(ref.target_id === null || typeof ref.target_id === 'string')) {
    out.push(shape(entityId, 'alias.reference.target_id must be a string or null.', modeId));
  }
  if (!(ref.target_collection_id === null || typeof ref.target_collection_id === 'string')) {
    out.push(shape(entityId, 'alias.reference.target_collection_id must be a string or null.', modeId));
  }
  if (!isStringArray(ref.target_path)) {
    out.push(shape(entityId, 'alias.reference.target_path must be an array of strings.', modeId));
  }
  if (typeof ref.external !== 'boolean') {
    out.push(shape(entityId, 'alias.reference.external must be a boolean.', modeId));
  }
  if (ref.source_library_name !== undefined && typeof ref.source_library_name !== 'string') {
    out.push(shape(entityId, 'alias.reference.source_library_name must be a string when present.', modeId));
  }
}

function validateAliasResolution(resolved: Record<string, unknown>, entityId: string, out: Diagnostic[], modeId?: string): void {
  const { status } = resolved;
  if (status === 'resolved') {
    validateTypedValueEnvelope(resolved.value, entityId, out, modeId);
  } else if (status === 'unresolved') {
    if (!isNonEmptyString(resolved.reason)) {
      out.push(shape(entityId, 'An unresolved alias must carry a non-empty reason.', modeId));
    }
    if (resolved.value !== null) {
      out.push(shape(entityId, 'An unresolved alias must carry a null value.', modeId));
    }
  } else {
    out.push(shape(entityId, `alias.resolved.status has an unrecognized value: ${JSON.stringify(status)}.`, modeId));
  }

  if (!Array.isArray(resolved.chain)) {
    out.push(shape(entityId, 'alias.resolved.chain must be an array.', modeId));
  } else {
    for (const step of resolved.chain) validateChainStep(step, entityId, out, modeId);
  }
}

/** A single mode's `CanonicalValue` (§9): the `kind` discriminant, dispatched. */
function validateValue(value: unknown, entityId: string, modeId: string, out: Diagnostic[]): void {
  if (!isRecord(value)) {
    out.push(shape(entityId, 'A token value must be an object, not a bare primitive.', modeId));
    return;
  }
  const { kind } = value;
  if (typeof kind !== 'string' || !SUPPORTED_VALUE_KINDS.includes(kind as typeof SUPPORTED_VALUE_KINDS[number])) {
    out.push(shape(entityId, `Value has an unrecognized or missing "kind" discriminant: ${JSON.stringify(kind)}.`, modeId));
    return;
  }

  if (kind === 'literal') {
    validateTypedValueEnvelope(value.value, entityId, out, modeId);
  } else if (kind === 'alias') {
    if (!isRecord(value.reference)) {
      out.push(shape(entityId, 'An alias value must carry a reference object.', modeId));
    } else {
      validateAliasReference(value.reference, entityId, out, modeId);
    }
    if (!isRecord(value.resolved)) {
      out.push(shape(entityId, 'An alias value must carry a resolved object.', modeId));
    } else {
      validateAliasResolution(value.resolved, entityId, out, modeId);
    }
  } else if (kind === 'missing') {
    if (!isNonEmptyString(value.reason)) {
      out.push(shape(entityId, 'A missing value must carry a non-empty reason.', modeId));
    }
  }
}

/** §8 — one token record. Structural checks only; cross-references (does
 *  `collection_id` resolve, is there a value for every declared mode) are
 *  Level 2/3, not this level. */
function validateToken(token: unknown, index: number, out: Diagnostic[]): void {
  if (!isRecord(token)) {
    out.push(shape(`tokens[${index}]`, 'A token must be an object.'));
    return;
  }

  const entityId = isNonEmptyString(token.id) ? token.id : `tokens[${index}]`;

  if (!isNonEmptyString(token.id)) {
    out.push(shape(entityId, 'token.id must be a non-empty string.'));
  }
  if (typeof token.collection_id !== 'string' || token.collection_id.length === 0) {
    out.push(shape(entityId, 'token.collection_id must be a non-empty string.'));
  }
  if (typeof token.name !== 'string') {
    out.push(shape(entityId, 'token.name must be a string.'));
  }
  if (!isStringArray(token.path) || token.path.length === 0) {
    out.push(shape(entityId, 'token.path must be a non-empty array of strings.'));
  }
  if (typeof token.type !== 'string') {
    out.push(shape(entityId, 'token.type must be a string.'));
  } else if (!SUPPORTED_TOKEN_TYPES.includes(token.type as TokenType)) {
    out.push(shape(entityId, `token.type is not a recognized token type: ${JSON.stringify(token.type)}.`));
  }
  if (typeof token.description !== 'string') {
    out.push(shape(entityId, 'token.description must be present and a string (an empty string is allowed).'));
  }
  if (!Array.isArray(token.scopes)) {
    out.push(shape(entityId, 'token.scopes must be an array.'));
  }
  if (!isRecord(token.values)) {
    out.push(shape(entityId, 'token.values must be an object keyed by mode id.'));
    return;
  }

  for (const [modeId, value] of Object.entries(token.values)) {
    validateValue(value, entityId, modeId, out);
  }
}

/**
 * §5.2 — the top-level sections every artifact must expose. Only container
 * shape is checked here (object vs. array vs. absent); `tokens` is the one
 * section given full field-by-field treatment, per this task's scope.
 */
const COMPLETENESS_VALUES = ['complete', 'partial', 'unavailable'];

function validateRootSections(artifact: Record<string, unknown>, out: Diagnostic[]): void {
  if (!isRecord(artifact.spec_layer)) {
    out.push(shape(ROOT, '`spec_layer` must be an object.'));
  }
  const completeness = artifact.completeness;
  if (
    !isRecord(completeness)
    || !COMPLETENESS_VALUES.includes(completeness.collections as string)
    || !COMPLETENESS_VALUES.includes(completeness.styles as string)
    || !isStringArray(completeness.unavailable_sources)
  ) {
    out.push(shape(ROOT, '`completeness` must state collections/styles completeness and list unavailable sources.'));
  }
  if (!Array.isArray(artifact.collections)) {
    out.push(shape(ROOT, '`collections` must be an array.'));
  }
  if (!isRecord(artifact.styles) || !Array.isArray(artifact.styles.typography) || !Array.isArray(artifact.styles.effects)) {
    out.push(shape(ROOT, '`styles` must be an object with `typography` and `effects` arrays.'));
  }
  if (!Array.isArray(artifact.diagnostics)) {
    out.push(shape(ROOT, '`diagnostics` must be an array.'));
  }
  if (!isRecord(artifact.statistics)) {
    out.push(shape(ROOT, '`statistics` must be an object.'));
  }
}

/**
 * Level 1 validation — never throws, on any input.
 *
 * Anchors every diagnostic to the entity it is about (`entity_id`, plus
 * `mode_id` when the fault lives inside one mode's value), so a caller can
 * join a finding back to the token that produced it without re-deriving
 * position from array indices.
 */
export function validateLevel1(artifact: unknown): Diagnostic[] {
  try {
    const out: Diagnostic[] = [];

    if (!isRecord(artifact)) {
      out.push(shape(ROOT, 'The artifact root must be an object.'));
      return out;
    }

    validateRootSections(artifact, out);

    if (!Array.isArray(artifact.tokens)) {
      out.push(shape(ROOT, '`tokens` must be an array.'));
    } else {
      artifact.tokens.forEach((token, index) => validateToken(token, index, out));
    }

    return out;
  } catch (err) {
    // A per-access type guard cannot prevent an exception from a throwing
    // getter or Proxy trap — the throw happens during the read itself. The
    // guarantee has to be enforced structurally here instead.
    const message = err instanceof Error && err.message
      ? `The artifact could not be read; accessing its properties threw: ${err.message}`
      : 'The artifact could not be read; accessing its properties threw.';
    return [diagnostic('INCONSISTENT_VALUE_SHAPE', {
      entity_id: 'artifact',
      message,
    })];
  }
}

// ---------------------------------------------------------------------------
// Level 2 — referential integrity (§18 Level 2, §10 "Alias graph", §7 modes,
// §6 identity and paths).
//
// Unlike Level 1, `validateLevel2` takes a typed `FoundationArtifactV5`, not
// `unknown`: it is only meaningful to run once Level 1 has already accepted
// the shape, so the defensive `isRecord`/`typeof` guarding above has no
// counterpart down here -- every field this section reads is already the
// type it claims to be.
// ---------------------------------------------------------------------------

interface AliasNode { tokenId: string; modeId: string }

type NodeState = 'in_progress' | 'done';

/** get-or-create for the nested per-(token_id, mode_id) traversal state. */
function nodeStates(store: Map<string, Map<string, NodeState>>, tokenId: string): Map<string, NodeState> {
  let inner = store.get(tokenId);
  if (!inner) {
    inner = new Map();
    store.set(tokenId, inner);
  }
  return inner;
}

function getNodeState(
  store: Map<string, Map<string, NodeState>>, tokenId: string, modeId: string,
): NodeState | undefined {
  return store.get(tokenId)?.get(modeId);
}

/** The ring node with the lowest (token_id, mode_id) by code-unit order, so a
 *  cycle is reported from the same node regardless of which token the walk
 *  happened to reach it from first -- entry order depends on array position,
 *  which §16 determinism forbids leaking into output. */
function lowestRingIndex(ring: AliasNode[]): number {
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const cmp = compareCodeUnits(ring[i].tokenId, ring[best].tokenId)
      || compareCodeUnits(ring[i].modeId, ring[best].modeId);
    if (cmp < 0) best = i;
  }
  return best;
}

/**
 * Walks the alias graph rooted at every (token, mode) pair holding an alias
 * value.
 *
 * ITERATIVE, with an explicit `path` array standing in for the call stack a
 * recursive walk would otherwise consume. A recursive depth-first walk blows
 * the JS call stack at a few thousand hops regardless of algorithmic
 * complexity -- exactly what `artifactWithChainOfLength(5000)` exists to
 * catch.
 *
 * MEMOIZED on (token_id, mode_id): once a node's outcome is known -- resolved
 * to a terminal value, unresolved, or part of an already-reported cycle -- it
 * is marked 'done' and is never walked again. That is what keeps whole-
 * artifact resolution linear instead of quadratic (§21.3): without it, every
 * node in an N-long chain would be re-walked from every one of its N
 * ancestors.
 *
 * The alias graph is a FUNCTIONAL graph: every node has out-degree at most 1
 * (one `reference` per alias value), so "does the walk return to a node
 * already on the CURRENT path" is the entire cycle test -- no branching DFS
 * is needed, only a path stack and an O(1) membership check on it.
 */
function walkAliasGraph(tokens: TokenV5[], out: Diagnostic[]): void {
  const tokensById = new Map(tokens.map((t) => [t.id, t]));
  const states = new Map<string, Map<string, NodeState>>();

  const markDone = (path: AliasNode[]): void => {
    for (const node of path) nodeStates(states, node.tokenId).set(node.modeId, 'done');
  };

  const reportCycle = (path: AliasNode[], ringStart: number): void => {
    const ring = path.slice(ringStart);
    const lowest = lowestRingIndex(ring);
    const rotated = [...ring.slice(lowest), ...ring.slice(0, lowest)];
    const chain = [...rotated, rotated[0]].map((n) => ({ token_id: n.tokenId, mode_id: n.modeId }));
    out.push(diagnostic('ALIAS_CYCLE', {
      entity_id: rotated[0].tokenId,
      mode_id: rotated[0].modeId,
      message: `Alias resolution cycles back to itself: ${chain.map((c) => c.token_id).join(' -> ')}.`,
      details: { chain },
    }));
  };

  for (const startToken of tokens) {
    for (const startModeId of Object.keys(startToken.values)) {
      if (startToken.values[startModeId].kind !== 'alias') continue;
      if (getNodeState(states, startToken.id, startModeId) === 'done') continue;

      const path: AliasNode[] = [];
      const pathIndex = new Map<string, Map<string, number>>();
      let curTokenId = startToken.id;
      const curModeId = startModeId;

      while (true) {
        if (getNodeState(states, curTokenId, curModeId) === 'done') {
          // A prior walk already determined this node's outcome (and
          // reported whatever that outcome warranted). The nodes THIS walk
          // added leading up to it are new, though, and need marking.
          markDone(path);
          break;
        }

        const seenAt = pathIndex.get(curTokenId)?.get(curModeId);
        if (seenAt !== undefined) {
          reportCycle(path, seenAt);
          markDone(path);
          break;
        }

        nodeStates(states, curTokenId).set(curModeId, 'in_progress');
        const inner = pathIndex.get(curTokenId) ?? new Map<string, number>();
        inner.set(curModeId, path.length);
        pathIndex.set(curTokenId, inner);
        path.push({ tokenId: curTokenId, modeId: curModeId });

        const curToken = tokensById.get(curTokenId);
        const value = curToken?.values[curModeId];
        if (!curToken || !value || value.kind !== 'alias') {
          // Terminal: a literal, an explicit `missing` record, or simply no
          // entry for this mode on this token. Nothing further to resolve.
          markDone(path);
          break;
        }

        const { reference } = value;
        if (reference.external) {
          // The target lives in a library this export did not read, so it
          // cannot be verified against this artifact's own token set.
          // Level 2 defers to what extraction already recorded rather than
          // guessing at a library it has no access to.
          if (value.resolved.status === 'unresolved') {
            out.push(diagnostic('UNRESOLVED_EXTERNAL_ALIAS', {
              entity_id: curTokenId,
              mode_id: curModeId,
              message: `Alias references an external library that did not resolve: ${reference.source_library_name ?? 'unknown library'}.`,
            }));
          }
          markDone(path);
          break;
        }

        const targetId = reference.target_id;
        const targetToken = targetId === null ? undefined : tokensById.get(targetId);
        if (!targetToken) {
          out.push(diagnostic('UNRESOLVED_ALIAS', {
            entity_id: curTokenId,
            mode_id: curModeId,
            message: `Alias reference target does not exist in this artifact: ${JSON.stringify(targetId)}.`,
          }));
          markDone(path);
          break;
        }

        if (targetToken.type !== curToken.type) {
          out.push(diagnostic('ALIAS_TYPE_MISMATCH', {
            entity_id: curTokenId,
            mode_id: curModeId,
            message: `Alias on a "${curToken.type}" token targets "${targetToken.id}", which is "${targetToken.type}".`,
          }));
        }

        // Mode carries across a hop: which mode of the target applies is a
        // decision already made and stated by the extractor (§9's
        // ResolutionStep model keys each hop by BOTH token and mode), so the
        // walk holds the mode constant rather than re-deriving it.
        curTokenId = targetToken.id;
      }
    }
  }
}

/**
 * §7: every token must carry an entry for every mode its collection
 * declares -- either a value, or an explicit `{kind: 'missing'}` record
 * stating so. Omitting the key entirely is the ABSENT case ("An absent mode
 * value MUST be distinguishable from an explicit null value"); a `missing`
 * record is the token stating the fact itself, so it is not reported.
 */
function checkModeCompleteness(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const collectionsById = new Map(artifact.collections.map((c) => [c.id, c]));
  for (const token of artifact.tokens) {
    const collection = collectionsById.get(token.collection_id);
    if (!collection) continue; // no declared collection to check modes against
    for (const mode of collection.modes) {
      if (!(mode.id in token.values)) {
        out.push(diagnostic('MISSING_MODE_VALUE', {
          entity_id: token.id,
          mode_id: mode.id,
          message: `Token has no value record for mode "${mode.name}" (${mode.id}), and does not declare it explicitly missing.`,
        }));
      }
    }
  }
}

/**
 * §6: id is identity. Two entities -- of any kind -- sharing one stable id
 * makes that id useless as identity, since a consumer joining on it cannot
 * tell which entity it means.
 */
function checkDuplicateIds(artifact: FoundationArtifactV5, out: Diagnostic[]): void {
  const allIds = [
    ...artifact.collections.map((c) => c.id),
    ...artifact.tokens.map((t) => t.id),
    ...artifact.styles.typography.map((s) => s.id),
    ...artifact.styles.effects.map((s) => s.id),
  ];
  const counts = new Map<string, number>();
  for (const id of allIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const reported = new Set<string>();
  for (const id of allIds) {
    const count = counts.get(id) ?? 0;
    if (count > 1 && !reported.has(id)) {
      reported.add(id);
      out.push(diagnostic('DUPLICATE_SOURCE_ID', {
        entity_id: id,
        message: `${count} entities share the stable id "${id}".`,
      }));
    }
  }
}

/**
 * §6: a normalized-path collision, scoped to `(collection_id, NFC(path))`.
 * Two collections both holding the same path is the normal, intended shape of
 * a themed design system -- a collection IS the namespace -- so this is
 * deliberately NOT a global check; flagging the cross-collection case would
 * fire on nearly every real file.
 */
function checkPathCollisions(tokens: TokenV5[], out: Diagnostic[]): void {
  const groups = new Map<string, TokenV5[]>();
  for (const token of tokens) {
    const key = JSON.stringify([token.collection_id, token.path.map((seg) => seg.normalize('NFC'))]);
    const group = groups.get(key);
    if (group) group.push(token); else groups.set(key, [token]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = group.map((t) => t.id).sort(compareCodeUnits);
    out.push(diagnostic('PATH_COLLISION', {
      entity_id: ids[0],
      message: `${group.length} tokens in collection "${group[0].collection_id}" normalize to the same path: ${JSON.stringify(group[0].path)}.`,
      details: { collection_id: group[0].collection_id, token_ids: ids },
    }));
  }
}

/**
 * Level 2 validation — spec §18 "Referential integrity" and §10 "Alias
 * graph". Assumes `artifact` has already passed `validateLevel1`.
 */
export function validateLevel2(artifact: FoundationArtifactV5): Diagnostic[] {
  const out: Diagnostic[] = [];
  walkAliasGraph(artifact.tokens, out);
  checkModeCompleteness(artifact, out);
  checkDuplicateIds(artifact, out);
  checkPathCollisions(artifact.tokens, out);
  return out;
}

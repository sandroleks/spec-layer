/**
 * The unit a token's stated usage implies, for tokens whose own scopes state
 * none. A name is still not evidence (`units.ts`); this reads two things that
 * are: a scope on a token that aliases this one, and a property a component
 * binds this one to.
 *
 * Every answer carries its evidence so a reader can audit it. Conflicting
 * evidence produces no answer, and refutation travels exactly as far as
 * evidence: carrying "length" down an alias chain while leaving "not a length"
 * at the first hop would settle a contradiction by whichever side moved.
 */
import type { CollectionV5, TokenV5 } from './entities';
import type { FoundationArtifactV5 } from './canonical';
import type { ComponentBindingV5 } from './componentContext';
import type { LibraryBundleV1 } from '../libraryBundle';
import { compareCodeUnits } from './diagnostics';
import { dtcgPathOf } from './dtcg';
import { scopesStateNumber, scopesStateUnit } from './units';

/** Why a token's unit is known, so a reader can audit the claim. */
export interface UnitEvidence {
  unit: 'px';
  /** 'alias-scope' — a scope-pinned token aliases this one.
   *  'binding' — a component binds this token to a length property. */
  via: 'alias-scope' | 'binding';
  /** The DTCG path or component name that supplied the evidence. */
  source: string;
  /** The scope or property name that pinned it. */
  reason: string;
}

/** Keyed by Figma variable id. */
export type UsageUnitMap = Map<string, UnitEvidence>;

/** Figma scopes that state a length, and so state one for what they alias. */
const LENGTH_SCOPES = ['CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'FONT_SIZE', 'STROKE_FLOAT'];

/**
 * The extractor's own length properties, closed: `border` and `fill` are colours
 * in this schema. A property outside the list is not length evidence, and a
 * token bound to one as well as to a length is contradicted (see `vetoedIds`).
 */
const LENGTH_PROPERTIES = [
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'gap', 'height', 'padding-x', 'padding-y', 'width',
];

/** A cycle is bad input (`validate.ts` reports ALIAS_CYCLE); the cap only keeps
 *  a walk from hanging on one. */
const MAX_ALIAS_DEPTH = 16;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The bundle's foundation artifact, or null. The envelope only promises a
 *  content hash, so the shape is checked, not assumed. */
function foundationOf(bundle: LibraryBundleV1): FoundationArtifactV5 | null {
  const artifact: unknown = bundle.foundation?.artifact;
  if (!isRecord(artifact)) return null;
  if (!Array.isArray(artifact.tokens) || !Array.isArray(artifact.collections)) return null;
  return artifact as unknown as FoundationArtifactV5;
}

/** A fixed total order over evidence. Evidence for one token always agrees on
 *  the unit, so this only picks the citation, independent of publish order. */
function precedes(a: UnitEvidence, b: UnitEvidence): boolean {
  return (compareCodeUnits(a.via, b.via)
    || compareCodeUnits(a.source, b.source)
    || compareCodeUnits(a.reason, b.reason)) < 0;
}

/** A component artifact's variable bindings, shape-checked as in `foundationOf`. */
function bindingsOf(artifact: unknown): ComponentBindingV5[] {
  if (!isRecord(artifact) || !isRecord(artifact.references)) return [];
  const bindings = artifact.references.bindings;
  if (!Array.isArray(bindings)) return [];
  return bindings.filter((b): b is ComponentBindingV5 => isRecord(b)
    && b.kind === 'variable' && typeof b.source_id === 'string' && typeof b.property === 'string');
}

/** Every alias target a token names across its modes, deduplicated in mode order. */
function aliasTargets(token: TokenV5): string[] {
  const out: string[] = [];
  for (const value of Object.values(token.values)) {
    if (value.kind !== 'alias' || value.reference.external) continue;
    const id = value.reference.target_id;
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

export function usageUnits(bundle: LibraryBundleV1): UsageUnitMap {
  const evidence: UsageUnitMap = new Map();
  const artifact = foundationOf(bundle);
  if (artifact === null) return evidence;

  const tokenById = new Map<string, TokenV5>(artifact.tokens.map((t) => [t.id, t]));
  const collectionById = new Map<string, CollectionV5>(artifact.collections.map((c) => [c.id, c]));

  // The smallest (component, property) by code unit is reported, so publish
  // order does not change the evidence.
  const lengthUse = new Map<string, UnitEvidence>();
  const nonLengthUse: string[] = [];
  for (const component of bundle.components) {
    for (const binding of bindingsOf(component.artifact)) {
      if (!LENGTH_PROPERTIES.includes(binding.property)) {
        nonLengthUse.push(binding.source_id);
        continue;
      }
      const found: UnitEvidence = {
        unit: 'px', via: 'binding', source: component.name, reason: binding.property,
      };
      const prior = lengthUse.get(binding.source_id);
      if (prior === undefined || precedes(found, prior)) lengthUse.set(binding.source_id, found);
    }
  }

  const vetoedIds = new Set<string>();

  /**
   * Breadth-first over alias edges from `startId`, each token once. A token
   * whose own scopes state a unit is a barrier carrying no evidence past itself
   * either way (a length one seeds its own walk). The start is exempt.
   */
  const walkChain = (startId: string, includeStart: boolean, visit: (id: string) => void): void => {
    const seen = new Set<string>([startId]);
    let frontier = [startId];
    for (let depth = 0; depth <= MAX_ALIAS_DEPTH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const token = tokenById.get(id);
        if (id !== startId && token !== undefined && scopesStateUnit(token.scopes)) continue;
        if (id !== startId || includeStart) visit(id);
        if (token === undefined) continue;
        for (const target of aliasTargets(token)) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
        }
      }
      frontier = next;
    }
  };

  // Contradictions first, since `record` consults them: a component binding the
  // token to a non-length property, or the token's own unitless-number scopes
  // (OPACITY, FONT_WEIGHT). Both walk the chain (see the module header).
  for (const id of nonLengthUse) walkChain(id, true, (reached) => vetoedIds.add(reached));
  for (const token of artifact.tokens) {
    if (!scopesStateNumber(token.scopes)) continue;
    walkChain(token.id, false, (reached) => vetoedIds.add(reached));
  }

  /** A number token whose own scopes state no unit, so it would be written bare. */
  const isCandidate = (id: string): boolean => {
    const token = tokenById.get(id);
    return token !== undefined && token.type === 'number' && !scopesStateUnit(token.scopes);
  };

  const record = (id: string, found: UnitEvidence): void => {
    if (!isCandidate(id) || vetoedIds.has(id)) return;
    const prior = evidence.get(id);
    if (prior === undefined || precedes(found, prior)) evidence.set(id, found);
  };

  /** `includeStart` is false when the evidence is the start token's own scopes. */
  const pin = (startId: string, found: UnitEvidence, includeStart: boolean): void =>
    walkChain(startId, includeStart, (id) => record(id, found));

  // Rule A: a scope-pinned token states the unit of everything it aliases. Of
  // several length scopes the smallest by code unit is reported.
  for (const token of artifact.tokens) {
    const scopes = token.scopes.filter((s) => LENGTH_SCOPES.includes(s)).sort(compareCodeUnits);
    if (scopes.length === 0) continue;
    const collection = collectionById.get(token.collection_id);
    if (collection === undefined) continue;
    pin(token.id, {
      unit: 'px', via: 'alias-scope',
      source: dtcgPathOf(collection.name, token.name), reason: scopes[0],
    }, false);
  }

  // Rule B: a component binding a token to a length property states the unit of
  // the token and everything it aliases. Seeded in artifact token order from
  // `lengthUse`, so bundle order does not reach the answer.
  for (const token of artifact.tokens) {
    const found = lengthUse.get(token.id);
    if (found !== undefined) pin(token.id, found, true);
  }

  return evidence;
}

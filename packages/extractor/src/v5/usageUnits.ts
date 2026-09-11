/**
 * The unit a token's stated USAGE implies, for tokens whose own scopes state
 * none.
 *
 * `units.ts` refuses to read a unit off a token's name, and that rule stands:
 * a name is not evidence. `spacing/400` meaning 16px and `font-weight/fw-600`
 * not meaning 600px are indistinguishable by name, and v4 got it wrong exactly
 * that way. This module reads two things that ARE evidence: a scope the
 * designer set on a token that aliases this one, and a property a component
 * binds this one to. Both are extracted, not guessed.
 *
 * Every answer carries the evidence that produced it, because an inference a
 * reader cannot audit is a guess wearing better clothes. Conflicting evidence
 * produces no answer at all, and evidence and refutation travel exactly as far
 * as each other: a rule that carried "this is a length" down an alias chain
 * while leaving "this is not one" at the first hop would resolve a
 * contradiction to whichever side happened to move.
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
 * The extractor's own property vocabulary for a length, and nothing else.
 *
 * Closed on purpose. `border` and `fill` also appear in real bindings and are
 * COLORS in this schema; reading `border` as a length because the word sounds
 * dimensional would pin a unit on a colour token. A property outside this list
 * is not length evidence, and a token that carries one alongside a length is
 * contradicted rather than resolved (see `vetoedIds`).
 */
const LENGTH_PROPERTIES = [
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'gap', 'height', 'padding-x', 'padding-y', 'width',
];

/** A cycle is a bad input (`validate.ts` reports ALIAS_CYCLE), not something to
 *  preserve; the cap is here so a walk cannot hang on one regardless. */
const MAX_ALIAS_DEPTH = 16;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The foundation artifact in the bundle, or null when it carries none this
 *  pass can read. The envelope contract only promises a content hash, so the
 *  shape is checked here rather than assumed. */
function foundationOf(bundle: LibraryBundleV1): FoundationArtifactV5 | null {
  const artifact: unknown = bundle.foundation?.artifact;
  if (!isRecord(artifact)) return null;
  if (!Array.isArray(artifact.tokens) || !Array.isArray(artifact.collections)) return null;
  return artifact as unknown as FoundationArtifactV5;
}

/** A total order over evidence. Two pieces of evidence for one token always
 *  agree on the unit and differ only in what they cite, so this decides which
 *  citation is reported; it is arbitrary but fixed, which is what keeps the
 *  answer independent of the order components were published in. */
function precedes(a: UnitEvidence, b: UnitEvidence): boolean {
  return (compareCodeUnits(a.via, b.via)
    || compareCodeUnits(a.source, b.source)
    || compareCodeUnits(a.reason, b.reason)) < 0;
}

/** The variable bindings a component artifact states, or none when it carries
 *  none this pass can read. Same reason as `foundationOf`: the bundle envelope
 *  promises a content hash and nothing more. */
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

  // Every component binding, by the token it names. The smallest (component,
  // property) pair by code unit is the one reported, so a token bound in two
  // components reports the same evidence whatever order they were published in.
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
   * Breadth-first over alias edges from `startId`, visiting each token once.
   *
   * A token whose own scopes answer the unit question is a barrier: it needs
   * nobody's evidence and must not carry anybody's past itself, in either
   * direction. Its own answer governs the chain below it, and if that answer
   * is a length it seeds its own walk anyway. The start is exempt, since the
   * start is where the walk's own claim comes from.
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

  // Contradiction, before any evidence is collected, because `record` below
  // consults the result. Two sources, and they are the same fact seen from the
  // two places the library states it:
  //
  //   - a component binds the token to something that is not a length, so what
  //     it aliases is not reached through a length either;
  //   - the token's own scopes say it is a unitless number (OPACITY,
  //     FONT_WEIGHT), which contradicts any length claim on what it aliases
  //     just as a CORNER_RADIUS scope supports one.
  //
  // Both walk the chain, for the reason in this module's header: refutation
  // has to travel as far as the evidence it refutes.
  for (const id of nonLengthUse) walkChain(id, true, (reached) => vetoedIds.add(reached));
  for (const token of artifact.tokens) {
    if (!scopesStateNumber(token.scopes)) continue;
    walkChain(token.id, false, (reached) => vetoedIds.add(reached));
  }

  /** A token the projection writes as a bare number BECAUSE its own scopes
   *  state nothing. A token whose scopes state a unit already has its answer,
   *  and one that is not a number has no unit to find. */
  const isCandidate = (id: string): boolean => {
    const token = tokenById.get(id);
    return token !== undefined && token.type === 'number' && !scopesStateUnit(token.scopes);
  };

  const record = (id: string, found: UnitEvidence): void => {
    if (!isCandidate(id) || vetoedIds.has(id)) return;
    const prior = evidence.get(id);
    if (prior === undefined || precedes(found, prior)) evidence.set(id, found);
  };

  /** Carries one piece of evidence down a token's alias chain. `includeStart`
   *  is false when the evidence came from the start token's OWN scopes, which
   *  already state its unit. */
  const pin = (startId: string, found: UnitEvidence, includeStart: boolean): void =>
    walkChain(startId, includeStart, (id) => record(id, found));

  // Rule A: a scope-pinned token states the unit of everything it aliases.
  // A token may carry several length scopes; the smallest by code unit is
  // reported, so the answer does not depend on Figma's scope order.
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

  // Rule B: a component that binds a token to a length property states that
  // token's unit, and the unit of everything it aliases. Bundle order does not
  // reach the answer: `lengthUse` already resolved which evidence is reported,
  // and the walk below is seeded from it in artifact token order.
  for (const token of artifact.tokens) {
    const found = lengthUse.get(token.id);
    if (found !== undefined) pin(token.id, found, true);
  }

  return evidence;
}

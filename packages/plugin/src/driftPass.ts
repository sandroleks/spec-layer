import { memoizedResolver } from './resolverMemo';
import type { NodeResolver, SerializedNode } from './serialize';

/**
 * One resolver memo per Library drift pass.
 *
 * Every component doc in a file binds the same few dozen variables and
 * styles, so a memo per `requestDrift` (the shape before this) refetched
 * them once per document. The publish pass already holds one memo for its
 * whole batch; this does the same for drift, keyed by the pass id the UI
 * sends with each request. A new id replaces the memo, which is what bounds
 * its lifetime: resolverMemo.ts warns against a memo that outlives a pass,
 * because a rename between passes would serve the old name.
 */
export class DriftPassResolvers {
  private held: { passId: string; memo: NodeResolver } | null = null;

  constructor(private readonly base: NodeResolver) {}

  forPass(passId: string): NodeResolver {
    if (this.held === null || this.held.passId !== passId) {
      this.held = { passId, memo: memoizedResolver(this.base) };
    }
    return this.held.memo;
  }

  reset(): void { this.held = null; }
}

/** Node count of a serialized tree, for the timing log only. */
export function countSerializedNodes(node: SerializedNode): number {
  let count = 1;
  for (const child of node.children ?? []) count += countSerializedNodes(child);
  return count;
}

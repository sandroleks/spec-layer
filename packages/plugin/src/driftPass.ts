import { memoizedResolver } from './resolverMemo';
import type { NodeResolver } from './serialize';
import type { SerializedNode } from '@spec-layer/extractor';

/**
 * One resolver memo per Library drift pass.
 *
 * Every component doc in a file binds the same few dozen variables and
 * styles, so one memo serves a whole pass, keyed by the id the UI sends with
 * each request. A new id replaces the memo, which bounds its lifetime: a memo
 * that outlived its pass would serve a renamed variable's old name.
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

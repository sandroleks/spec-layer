import { memoizedResolver } from './resolverMemo';
import type { NodeResolver } from './serialize';
import type { SerializedNode } from '@spec-layer/extractor';

/** One resolver memo per Library drift pass, keyed by the UI's pass id. A new
 *  id replaces it: a memo that outlived its pass would serve a renamed
 *  variable's old name. */
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

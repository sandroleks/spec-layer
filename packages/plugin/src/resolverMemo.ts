import type { NodeResolver } from './serialize';

/**
 * One answer per id for the life of one serialization pass.
 *
 * serializeNode awaits resolver.variable(id) for every binding on every node
 * in every variant, so a component set that binds the same few dozen
 * variables across forty variants makes hundreds of Figma round trips for a
 * few dozen distinct ids. Caching the PROMISE (not the value) means the
 * second request for an id joins the first in flight instead of starting
 * another. Null is cached too: the base resolver already turns failures into
 * null, and a pass must see one answer per id, not a retry.
 *
 * mainComponent is keyed by a node object, not an id, so it passes through.
 * The cache dies with the wrapper; create one per pass, never one per session,
 * or a rename between two selections would serve the old name.
 */
export function memoizedResolver(base: NodeResolver): NodeResolver {
  const variables = new Map<string, ReturnType<NodeResolver['variable']>>();
  const styles = new Map<string, ReturnType<NodeResolver['style']>>();
  return {
    variable(id) {
      let pending = variables.get(id);
      if (!pending) {
        pending = base.variable(id);
        variables.set(id, pending);
      }
      return pending;
    },
    style(id) {
      let pending = styles.get(id);
      if (!pending) {
        pending = base.style(id);
        styles.set(id, pending);
      }
      return pending;
    },
    mainComponent(node) {
      return base.mainComponent(node);
    },
  };
}

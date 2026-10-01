import type { NodeResolver } from './serialize';

/**
 * One answer per id for one serialization pass. Caches the promise, so a
 * second request joins the first in flight; null is cached too, since a pass
 * must see one answer per id. mainComponent is keyed by node, so it passes
 * through. Create one per pass, never per session, or a rename serves the old
 * name.
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

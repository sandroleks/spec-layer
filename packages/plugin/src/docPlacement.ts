/// <reference types="@figma/plugin-typings" />
/**
 * The Figma side of doc placement: finds the Section a doc nests in and the
 * node it sits beside, reads rects in that Section's space, runs the pure
 * geometry in placement.ts, and applies the result. Nodes are read through
 * their Figma types; tests hand in plain objects.
 */
import { DOC_LINK_KEY } from './docLink';
import {
  rankDoc, rankFrom, isClear, growthClear, rightOfAll,
  type Box, type Size, type Placement,
} from './placement';

/** What a doc Section can be appended to: Figma allows a page or a Section. */
export type Host = SectionNode | PageNode;

export interface DocSpot { host: Host; x: number; y: number; grow: Size | null }

/** A Section a doc may nest in: any Section but a Spec Layer doc. */
function isHostSection(node: BaseNode): node is SectionNode {
  return node.type === 'SECTION' && (node as SectionNode).getPluginData(DOC_LINK_KEY) === '';
}

/** A doc Section's own parent, when it is one a Section can live in. */
function parentHost(node: SceneNode): Host | null {
  const parent = node.parent;
  return parent && (parent.type === 'PAGE' || parent.type === 'SECTION') ? parent as Host : null;
}

/** A locked or hidden Section locks or hides everything inside it. */
function isShut(node: BaseNode): boolean {
  return node.type === 'SECTION' && ((node as SectionNode).locked || !(node as SectionNode).visible);
}

/** The nearest host above `node`, and the ancestor of `node` (or `node`
 *  itself) that is that host's direct child. A Section hosts only when it is
 *  not locked or hidden and no Section between it and the page is either;
 *  otherwise the next usable Section up, or the page, does. Null when `node`
 *  is not on a page. */
export function hostAbove(node: BaseNode): { host: Host; anchor: SceneNode } | null {
  // The deepest usable Section seen so far, reset by a shut Section above it.
  let found: { host: Host; anchor: SceneNode } | null = null;
  let cur: BaseNode = node;
  for (;;) {
    const parent: BaseNode | null = cur.parent;
    if (!parent || parent.type === 'DOCUMENT') return null;
    if (parent.type === 'PAGE') return found ?? { host: parent as PageNode, anchor: cur as SceneNode };
    if (isShut(parent)) found = null;
    else if (!found && isHostSection(parent)) found = { host: parent, anchor: cur as SceneNode };
    cur = parent;
  }
}

function originOf(host: Host): { x: number; y: number } {
  if (host.type === 'PAGE') return { x: 0, y: 0 };
  const b = host.absoluteBoundingBox;
  if (!b) throw new Error('The host Section has no bounds.');
  return { x: b.x, y: b.y };
}

/** `node`'s bounding box relative to `origin`, or null when Figma has none. */
function boxFrom(origin: { x: number; y: number }, node: SceneNode): Box | null {
  const b = node.absoluteBoundingBox;
  return b ? { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height } : null;
}

/** `node`'s bounding box in `host`'s space, or null when Figma has none. */
export function boxIn(host: Host, node: SceneNode): Box | null {
  return boxFrom(originOf(host), node);
}

/** A Section's own rect in its own space; a page has no bounds. */
function boundsOf(host: Host): Box | null {
  return host.type === 'PAGE' ? null : { x: 0, y: 0, width: host.width, height: host.height };
}

/** The host's children as obstacles, minus `exclude`. A child that cannot be
 *  read is skipped; a host with no bounds throws, since every child would be
 *  skipped and the host would look empty. */
function obstaclesIn(host: Host, exclude: ReadonlySet<string>): Box[] {
  const origin = originOf(host);
  const out: Box[] = [];
  for (const child of host.children) {
    try {
      if (exclude.has(child.id)) continue;
      const b = boxFrom(origin, child);
      if (b) out.push(b);
    } catch { /* skip unresolved child */ }
  }
  return out;
}

/** Whether `host` can grow to `grow` without running into its siblings. */
function growthFits(host: SectionNode, grow: Size, exclude: ReadonlySet<string>): boolean {
  const parent = parentHost(host);
  if (!parent) return false;
  const box = boxIn(parent, host);
  return box !== null
    && growthClear(box, grow, obstaclesIn(parent, new Set([...exclude, host.id])), boundsOf(parent));
}

/** Take the best of `ranked` in `host` that needs no growth; else, in a
 *  Section, the best whose growth runs into nothing. Only when no growth is
 *  clear, go up a level and rank the spots beside the host instead. A page
 *  never grows, so this ends. */
function settle(host: Host, ranked: readonly Placement[], size: Size, exclude: ReadonlySet<string>): DocSpot {
  let h = host;
  let list = ranked;
  for (;;) {
    const fit = list.find((p) => p.grow === null);
    if (fit) return { host: h, x: fit.x, y: fit.y, grow: null };
    // Never reached: a page has no bounds, so every spot on it fits.
    if (h.type === 'PAGE') throw new Error('No spot on the page.');
    const section = h;
    const grown = list.find((p) => p.grow !== null && growthFits(section, p.grow, exclude));
    if (grown) return { host: h, x: grown.x, y: grown.y, grow: grown.grow };
    const up = hostAbove(h);
    if (!up) throw new Error('The host Section is not on a page.');
    const anchor = boxIn(up.host, up.anchor);
    if (!anchor) throw new Error('The host Section has no bounds.');
    h = up.host;
    list = rankDoc({ anchor, size, obstacles: obstaclesIn(h, exclude), bounds: boundsOf(h) });
  }
}

/** The nearest clear spot beside `anchor` (in `host`'s space). */
export function spotNear(host: Host, anchor: Box, size: Size, exclude: ReadonlySet<string>): DocSpot {
  return settle(host, rankDoc({ anchor, size, obstacles: obstaclesIn(host, exclude), bounds: boundsOf(host) }), size, exclude);
}

/** A doc beside its source, nested in the source's Section. */
export function spotBeside(source: BaseNode, size: Size, exclude: ReadonlySet<string>): DocSpot | null {
  const target = hostAbove(source);
  if (!target) return null;
  const anchor = boxIn(target.host, target.anchor);
  return anchor ? spotNear(target.host, anchor, size, exclude) : null;
}

/** A rebuilt doc keeps its spot and its parent when its new size overlaps
 *  nothing there and stays inside a Section parent. No GAP: a doc the user
 *  placed by hand stays where they put it. */
export function spotInPlace(prior: SectionNode, size: Size, exclude: ReadonlySet<string>): DocSpot | null {
  const host = parentHost(prior);
  if (!host) return null;
  const box: Box = { x: prior.x, y: prior.y, ...size };
  return isClear(box, obstaclesIn(host, exclude), boundsOf(host))
    ? { host, x: prior.x, y: prior.y, grow: null }
    : null;
}

/** A rebuilt doc that no longer fits: as near its old spot as is clear. */
export function spotNearPrior(prior: SectionNode, size: Size, exclude: ReadonlySet<string>): DocSpot | null {
  const host = parentHost(prior);
  if (!host) return null;
  return settle(host, rankFrom({ x: prior.x, y: prior.y }, size, obstaclesIn(host, exclude), boundsOf(host)), size, exclude);
}

/** The last resort: right of every child of the page. Always clear. */
export function spotRightOfAll(page: PageNode, exclude: ReadonlySet<string>): DocSpot {
  const { x, y } = rightOfAll(obstaclesIn(page, exclude));
  return { host: page, x, y, grow: null };
}

/** The first attempt that returns a spot without throwing, else right of
 *  everything on `page`, else its origin. Placement never fails a build. */
export function firstSpot(
  page: PageNode, exclude: ReadonlySet<string>, attempts: ReadonlyArray<() => DocSpot | null>,
): DocSpot {
  for (const attempt of attempts) {
    try {
      const spot = attempt();
      if (spot) return spot;
    } catch { /* try the next one */ }
  }
  try {
    return spotRightOfAll(page, exclude);
  } catch {
    return { host: page, x: 0, y: 0, grow: null };
  }
}

/** Append the doc to its host at the spot, then grow the host right and
 *  down. Growth is cosmetic: a failed resize leaves the doc placed. */
export function applySpot(section: SectionNode, spot: DocSpot): void {
  spot.host.appendChild(section);
  section.x = spot.x;
  section.y = spot.y;
  if (spot.grow && spot.host.type === 'SECTION') {
    try {
      spot.host.resizeWithoutConstraints(spot.grow.width, spot.grow.height);
    } catch { /* the doc is placed; an unsized host is cosmetic */ }
  }
}

/**
 * Usage metrics: one data point per request, written to Workers Analytics
 * Engine through the METRICS binding (wrangler.toml) and read back with SQL.
 * README.md, "Usage metrics", is the human description of the columns.
 *
 * A point is counters, codes and the hashed identity the logs already carry,
 * never content: no prompt, prose, bundle, name, description, key or Figma
 * user id reaches one, and nothing here changes an answer. Analytics Engine
 * columns are positional (blob1, double1, ...), so a field is appended, never
 * inserted, and a changed meaning takes a new dataset name.
 */
import { PLUGIN_VERSION_HEADER } from '@spec-layer/extractor';
import type { Tier } from './quota';

/** Which handler answered; `preflight` is OPTIONS and `unmatched` the 404. */
export type RouteName =
  | 'prose' | 'quota' | 'activate' | 'deactivate'
  | 'publish' | 'pull' | 'rotate' | 'versions'
  | 'events'
  | 'preflight' | 'unmatched';

/** What a handler learns that route() cannot see. Every field has an empty default. */
export interface RequestFacts {
  /** The hashed quota identity the request proved (`lic:` or `free:`), '' when none. The point's one index. */
  identity: string;
  tier: Tier | '';
  /** A route's own category: the prose contract kind, the publish outcome, the license verdict. */
  kind: string;
  /** A route's own detail: the prose contract version, the publish bump, the license call. */
  detail: string;
  /** The library a library route addressed, '' elsewhere. Library ids are not secrets. */
  subject: string;
  /** Bytes read or served, where the handler counted them; else route() takes the Content-Length. */
  bytes: number;
  /** A route's own count: billed generations on prose, components on publish. */
  count: number;
}

export const EMPTY_FACTS: Readonly<RequestFacts> = Object.freeze({
  identity: '', tier: '', kind: '', detail: '', subject: '', bytes: 0, count: 0,
});

export interface FactsCollector {
  /** Merge what a handler knows; a later write wins. */
  record(facts: Partial<RequestFacts>): void;
  snapshot(): RequestFacts;
}

export function factsCollector(): FactsCollector {
  let facts: RequestFacts = { ...EMPTY_FACTS };
  return {
    record: (next) => { facts = { ...facts, ...next }; },
    snapshot: () => ({ ...facts }),
  };
}

/** The shape `AnalyticsEngineDataset.writeDataPoint` takes, declared here so this module needs no binding type. */
export interface RequestDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

export interface MetricsSink {
  write(point: RequestDataPoint): void;
}

/** Analytics Engine caps: 96 bytes per index, 16 KB of blobs per point. These stay far under. */
const MAX_INDEX_CHARS = 96;
const MAX_BLOB_CHARS = 64;

const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,20})?$/;

/**
 * `plugin/7.0.0` from the plugin's header, `cli/0.13.0` from the CLI's
 * `User-Agent: spec-layer/<version> ...`, else ''. Anything that is not a
 * version is dropped, never stored.
 */
export function clientOf(headers: Headers): string {
  const plugin = (headers.get(PLUGIN_VERSION_HEADER) ?? '').trim();
  if (VERSION_RE.test(plugin)) return `plugin/${plugin}`;
  const cli = /^spec-layer\/(\S+)/.exec(headers.get('User-Agent') ?? '')?.[1];
  if (cli && VERSION_RE.test(cli)) return `cli/${cli}`;
  return '';
}

/**
 * `ok` for an answer under 400, else the answer's `error` code, else
 * `http_<status>`. Read from a clone, so the answer itself is untouched;
 * every error body here is a small JSON object.
 */
export async function outcomeOf(res: Response): Promise<string> {
  if (res.status < 400) return 'ok';
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const body = await res.clone().json() as { error?: unknown } | null;
      if (body && typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // Not JSON after all: the status alone names it.
    }
  }
  return `http_${res.status}`;
}

/** The Content-Length when it is a count, else 0. */
function contentLength(headers: Headers): number {
  const n = Number(headers.get('Content-Length'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface RequestRecord {
  route: RouteName;
  outcome: string;
  client: string;
  status: number;
  durationMs: number;
  facts: RequestFacts;
}

/**
 * The one layout, column by column. The SQL names are positional:
 *   index1   identity
 *   blob1    route     blob2    outcome       blob3    tier    blob4    client
 *   blob5    kind      blob6    detail        blob7    subject
 *   double1  status    double2  duration_ms   double3  bytes   double4  count
 */
export function dataPoint(r: RequestRecord): RequestDataPoint {
  const blob = (value: string) => value.slice(0, MAX_BLOB_CHARS);
  const identity = r.facts.identity.slice(0, MAX_INDEX_CHARS);
  return {
    indexes: identity ? [identity] : [],
    blobs: [r.route, r.outcome, r.facts.tier, r.client, r.facts.kind, r.facts.detail, r.facts.subject].map(blob),
    doubles: [r.status, Math.max(0, Math.round(r.durationMs)), r.facts.bytes, r.facts.count],
  };
}

/**
 * Write the request's point. Never throws and never touches the answer: a
 * sink that fails (the binding missing, a per-invocation cap) is logged as
 * `metrics_write_failed` and the request is answered as it would have been.
 */
export async function recordRequest(
  sink: MetricsSink,
  log: (event: string, fields: Record<string, unknown>) => void,
  input: { headers: Headers; res: Response; route: RouteName; facts: RequestFacts; durationMs: number },
): Promise<void> {
  try {
    const facts = input.facts.bytes > 0 ? input.facts : { ...input.facts, bytes: contentLength(input.headers) };
    sink.write(dataPoint({
      route: input.route,
      outcome: await outcomeOf(input.res),
      client: clientOf(input.headers),
      status: input.res.status,
      durationMs: input.durationMs,
      facts,
    }));
  } catch (err) {
    log('metrics_write_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

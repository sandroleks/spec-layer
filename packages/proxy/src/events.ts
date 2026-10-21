/**
 * `POST /v1/events`: usage events from the plugin, one data point each in the
 * `EVENTS` Analytics Engine dataset (wrangler.toml), beside the per-request
 * points `metrics.ts` writes. The catalogue is the extractor's
 * `usageEvents.ts`, shared with the plugin, and `validateUsageBatch` is the
 * whole contract: an envelope that is wrong is refused, an event outside the
 * catalogue is dropped and counted, and no string that is not a token is
 * ever stored. README.md, "Usage events", is the human description.
 */
import { validateUsageBatch } from '@spec-layer/extractor';
import type { UsageEvent } from '@spec-layer/extractor';
import { readBodyCapped } from './body';
import type { HandlerDeps } from './handlers';
import { clientOf, type RequestDataPoint } from './metrics';

/** A batch is at most 50 small objects; 16 KB is several times that. */
export const MAX_EVENTS_BODY_BYTES = 16_384;

const MAX_BLOB_CHARS = 64;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The one layout, column by column. The SQL names are positional:
 *   index1   install
 *   blob1    event     blob2    client    blob3    kind
 *   blob4    outcome   blob5    detail    blob6    tier
 *   double1  count     double2  count2    double3  bytes   double4  duration_ms
 */
export function eventDataPoint(input: { install: string; client: string; tier: string; event: UsageEvent }): RequestDataPoint {
  const blob = (value: string | undefined) => (value ?? '').slice(0, MAX_BLOB_CHARS);
  const { event } = input;
  return {
    indexes: [input.install],
    blobs: [event.name, input.client, blob(event.kind), blob(event.outcome), blob(event.detail), input.tier],
    doubles: [event.count ?? 0, event.count2 ?? 0, event.bytes ?? 0, event.duration_ms ?? 0],
  };
}

export async function handleEvents(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await deps.requestLimiter.allow(`events:${ip}`, deps.now()))) {
    return json(429, { error: 'rate_limited' });
  }
  // Only a stamped plugin build sends events, so a request that names none
  // is refused before its body is read: nothing from a dev build, the
  // harness, the CLI or a stray client reaches the dataset.
  const client = clientOf(req.headers);
  if (!client.startsWith('plugin/')) return json(400, { error: 'client_required' });

  const read = await readBodyCapped(req, MAX_EVENTS_BODY_BYTES);
  if (read.kind === 'too_large') return json(413, { error: 'request_too_large' });
  if (read.kind === 'unreadable') return json(400, { error: 'invalid body' });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(read.bytes));
  } catch {
    return json(400, { error: 'invalid json' });
  }
  const result = validateUsageBatch(body);
  if (!result.ok) return json(400, { error: result.error });

  const { batch } = result;
  let accepted = 0;
  for (const event of batch.events) {
    try {
      deps.events.write(eventDataPoint({ install: batch.install, client, tier: batch.tier ?? '', event }));
      accepted += 1;
    } catch (err) {
      // The binding missing, or a per-invocation cap: the rest of the batch
      // would fail the same way. Logged once, and the answer still says how
      // many landed; the plugin reads none of it either way.
      deps.log('events_write_failed', { message: err instanceof Error ? err.message : String(err) });
      break;
    }
  }
  const dropped = result.dropped + (batch.events.length - accepted);
  deps.record({ count: accepted, ...(dropped > 0 ? { kind: 'partial' } : {}) });
  return json(202, { accepted, dropped });
}

import { route, type HandlerDeps, type QuotaClient } from './handlers';
import { QuotaEngine, type ReserveResult, type QuotaSnapshot, type Tier } from './quota';

export interface Env {
  LICENSE_CACHE: KVNamespace;
  QUOTA: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
  FIGMA_ID_SALT: string;
}

/**
 * One Durable Object per identity: single-threaded execution makes
 * reserve/commit atomic without explicit locking.
 */
export class QuotaDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const stored = await this.state.storage.get<string>('engine');
    const engine = new QuotaEngine(stored ?? undefined);
    const { op, tier, cacheKey, body, now } = (await req.json()) as {
      op: 'reserve' | 'commit' | 'release' | 'snapshot';
      tier: Tier; cacheKey?: string; body?: string; now: number;
    };
    let out: unknown = null;
    if (op === 'reserve') out = engine.reserve(tier, cacheKey as string, now);
    else if (op === 'commit') engine.commit(cacheKey as string, body as string, now);
    else if (op === 'release') engine.release(cacheKey as string);
    else out = engine.snapshot(tier, now);
    if (op !== 'snapshot') await this.state.storage.put('engine', engine.toJSON());
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }
}

function doQuotaClient(ns: DurableObjectNamespace, identityId: string): QuotaClient {
  const stub = ns.get(ns.idFromName(identityId));
  const call = async (payload: Record<string, unknown>) => {
    const res = await stub.fetch('https://do/quota', { method: 'POST', body: JSON.stringify({ ...payload, now: Date.now() }) });
    return res.json();
  };
  return {
    reserve: (tier, cacheKey) => call({ op: 'reserve', tier, cacheKey }) as Promise<ReserveResult>,
    commit: async (cacheKey, body) => { await call({ op: 'commit', tier: 'free', cacheKey, body }); },
    release: async (cacheKey) => { await call({ op: 'release', tier: 'free', cacheKey }); },
    snapshot: (tier) => call({ op: 'snapshot', tier }) as Promise<QuotaSnapshot>,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const deps: HandlerDeps = {
      salt: env.FIGMA_ID_SALT,
      anthropicKey: env.ANTHROPIC_API_KEY,
      fetcher: fetch.bind(globalThis),
      licenseCache: env.LICENSE_CACHE,
      now: () => Date.now(),
      quotaFor: (id) => doQuotaClient(env.QUOTA, id),
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    };
    return route(req, deps);
  },
};

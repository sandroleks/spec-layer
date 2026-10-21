/**
 * Plugin usage events: the one catalogue the plugin sends from
 * (`packages/plugin/src/ui/usage.ts`) and the proxy accepts
 * (`packages/proxy/src/events.ts`), so the proxy refuses anything outside it.
 * Shared the way the library bundle envelope is: defined once, here, with no
 * DOM, Node or Figma.
 *
 * An event is a name from the catalogue, a few tokens from closed
 * vocabularies and a few counts. It never carries content: no node,
 * component, file, token or collection name, no prose, no description, no
 * URL, no key, no Figma user id. The validator drops any string that is not
 * a token, so free text cannot reach the dataset even by mistake. What each
 * column means is fixed by (event, column) below and in the proxy README; a
 * changed meaning takes a new dataset name there, never a reinterpretation.
 */

export const USAGE_EVENTS_PATH = '/v1/events';

/** Events per batch: the plugin flushes at this size, the proxy refuses more. */
export const MAX_USAGE_BATCH = 50;

/** `inst_` and 32 hex digits: a random id the plugin mints when usage data
 *  is on and deletes when it is turned off. Never derived from anything. */
export const INSTALL_ID_RE = /^inst_[0-9a-f]{32}$/;

/** A token: letters, digits, `_`, `.` and `-`, 1 to 64 characters, starting
 *  with a letter or a digit. Event names, kinds, outcomes and details. */
export const USAGE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** The largest count a point carries; anything above is dropped as corrupt. */
export const MAX_USAGE_NUMBER = 1_000_000_000;

export interface UsageEventSpec {
  /** The closed vocabulary of `kind`; any token when absent. */
  kinds?: readonly string[];
  /** The closed vocabulary of `detail`; any token when absent. */
  details?: readonly string[];
}

/**
 * The catalogue. `outcome` is `ok`, `failed`, `manual`, `canceled`,
 * `incomplete`, `unreachable` or a proxy error code; the counts are what each
 * comment says and 0 when the event does not count them.
 */
export const USAGE_EVENTS = {
  /** The plugin UI booted. */
  plugin_opened: {},
  /** A component doc landed on the canvas, or did not. `count` sections
   *  drawn (0 from a Library update), `count2` sections drawn as placeholders. */
  doc_build: { kinds: ['create', 'update', 'rebuild'], details: ['ai', 'no_ai'] },
  /** Foundation docs: a bulk build or one Library row's update. `count`
   *  created, `count2` replaced. */
  foundation_build: { kinds: ['create', 'update'], details: ['ai', 'no_ai'] },
  /** Copy for AI, and the publish pane's two setup copies. `detail` is the
   *  format, `bytes` the text. `manual` means the dialog showed the text. */
  copy_for_ai: {
    kinds: ['component', 'foundation', 'setup_command', 'agent_setup'],
    details: ['md', 'yaml', 'dtcg', 'text'],
  },
  /** The snapshot zip. `detail` the component format, `count` components,
   *  `bytes` the zip. */
  snapshot_download: { details: ['md', 'yaml'] },
  /** A Library source check settled. `count` docs, `count2` with an update
   *  or a rebuild offered, `duration_ms` from the scan to the last row. */
  library_check: {},
  /** Update or rebuild from the Library. `count` docs updated, `count2` asked. */
  library_update: { kinds: ['one', 'all'] },
  /** Annotate in Dev Mode, a run a person started. `kind` is its scope,
   *  `count` components written, `count2` that failed. */
  annotate: { kinds: ['all', 'source', 'doc'] },
  /** To do, Draft with AI. `count` drafts landed, `count2` fields asked. */
  description_draft: {},
  /** To do, descriptions saved into Figma. `count` written, `count2` refused. */
  description_save: {},
  /** A setting changed; `detail` is the new value. */
  setting_changed: {
    kinds: ['ai_writing', 'component_format', 'frame_theme', 'logo', 'annotate_on_update', 'usage_data'],
  },
  /** An outbound link opened; `kind` says which. */
  external_link: { kinds: ['docs', 'site', 'checkout', 'manage', 'support', 'other'] },
  /** The "Something went wrong" toast, or the console line behind it.
   *  `kind` is the realm; `detail` the message type the main thread failed on. */
  unexpected_error: { kinds: ['ui', 'main'] },
} as const satisfies Record<string, UsageEventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;

export const USAGE_EVENT_NAMES = Object.keys(USAGE_EVENTS) as UsageEventName[];

export function isUsageEventName(value: unknown): value is UsageEventName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(USAGE_EVENTS, value);
}

/** Everything but the name, all optional: an absent column reads as '' or 0. */
export interface UsageFields {
  kind?: string;
  outcome?: string;
  detail?: string;
  count?: number;
  count2?: number;
  bytes?: number;
  duration_ms?: number;
}

export interface UsageEvent extends UsageFields {
  name: UsageEventName;
}

export interface UsageBatch {
  install: string;
  /** The plan as the plugin last saw it, when it knows one. */
  tier?: 'free' | 'pro';
  events: UsageEvent[];
}

const USAGE_STRING_FIELDS = ['kind', 'outcome', 'detail'] as const;
const USAGE_NUMBER_FIELDS = ['count', 'count2', 'bytes', 'duration_ms'] as const;
const EVENT_FIELDS = new Set<string>(['name', ...USAGE_STRING_FIELDS, ...USAGE_NUMBER_FIELDS]);
const BATCH_FIELDS = new Set(['install', 'tier', 'events']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A value as the token a column takes: whitespace and anything outside the
 * token characters becomes `_`, and it is cut at 64. For a value the plugin
 * builds from a product constant (a theme preset's name, a message type), so
 * a space can never make the event drop. Never for free text.
 */
export function usageToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[_.-]+/, '').slice(0, 64);
}

/**
 * One event as the proxy stores it, or null when it is outside the catalogue:
 * an unknown name or field, a string that is not a token or not in the
 * event's vocabulary, a number that is not a count. Counts are rounded.
 */
export function validateUsageEvent(value: unknown): UsageEvent | null {
  if (!isRecord(value)) return null;
  if (!Object.keys(value).every((key) => EVENT_FIELDS.has(key))) return null;
  if (!isUsageEventName(value.name)) return null;
  const spec: UsageEventSpec = USAGE_EVENTS[value.name];
  const event: UsageEvent = { name: value.name };
  for (const field of USAGE_STRING_FIELDS) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || !USAGE_TOKEN_RE.test(raw)) return null;
    const allowed = field === 'kind' ? spec.kinds : field === 'detail' ? spec.details : undefined;
    if (allowed && !allowed.includes(raw)) return null;
    event[field] = raw;
  }
  for (const field of USAGE_NUMBER_FIELDS) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MAX_USAGE_NUMBER) return null;
    event[field] = Math.round(raw);
  }
  return event;
}

export type UsageBatchValidation =
  | { ok: true; batch: UsageBatch; dropped: number }
  | { ok: false; error: string };

/**
 * A batch as the proxy accepts it. The envelope must be right or the whole
 * body is refused with the reason; inside it, an event outside the catalogue
 * is dropped and counted, so one bad event never costs the others.
 */
export function validateUsageBatch(body: unknown): UsageBatchValidation {
  if (!isRecord(body)) return { ok: false, error: 'invalid body' };
  if (!Object.keys(body).every((key) => BATCH_FIELDS.has(key))) return { ok: false, error: 'unexpected body field' };
  if (typeof body.install !== 'string' || !INSTALL_ID_RE.test(body.install)) return { ok: false, error: 'bad install' };
  if (body.tier !== undefined && body.tier !== 'free' && body.tier !== 'pro') return { ok: false, error: 'bad tier' };
  if (!Array.isArray(body.events) || body.events.length === 0) return { ok: false, error: 'missing events' };
  if (body.events.length > MAX_USAGE_BATCH) return { ok: false, error: 'too many events' };
  const events: UsageEvent[] = [];
  let dropped = 0;
  for (const raw of body.events) {
    const event = validateUsageEvent(raw);
    if (event) events.push(event);
    else dropped += 1;
  }
  return {
    ok: true,
    dropped,
    batch: { install: body.install, ...(body.tier !== undefined ? { tier: body.tier } : {}), events },
  };
}

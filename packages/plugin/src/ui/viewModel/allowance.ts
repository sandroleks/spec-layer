/**
 * The two allowance readouts as pure functions: the header's AI writing control
 * and the publish screen's free publishes line, plus their shared date formats.
 * `fetched` separates "not asked yet" (loading) from "asked, got nothing"
 * (unknown): the second shown as loading would spin forever, and shown as free
 * would demote a briefly offline Pro user.
 */

import type { ProxyQuota } from '@spec-layer/extractor';
import type { AllowanceState } from './contracts';
import { assertNever } from './contracts';

/**
 * Matches proxy.ts's `lowThreshold` default, so the header and the license
 * meter agree on "low". Fix a failing test's fixture, never this value.
 */
export const LOW_REMAINING = 5;

export function allowanceState(quota: ProxyQuota | null, fetched: boolean): AllowanceState {
  if (!fetched) return { kind: 'loading' };
  if (!quota) return { kind: 'unknown', message: 'Couldn’t check your plan' };
  if (quota.tier === 'pro') return { kind: 'pro' };

  const limit = quota.limit ?? 0;
  const remaining = quota.remaining ?? Math.max(0, limit - quota.used);
  return { kind: 'free', remaining: Math.max(0, remaining), limit, resetsAt: quota.resetsAt };
}

export type AllowanceTone = 'loading' | 'normal' | 'low' | 'exhausted' | 'pro' | 'unknown';

export interface AllowanceCopy {
  tone: AllowanceTone;
  title: string;
  detail: string;
  showUpgrade: boolean;
  ariaLabel: string;
  /** Progress-ring fill, 0..100. */
  fillPct: number;
}

const TITLE = 'AI writing';

export function allowanceCopy(state: AllowanceState): AllowanceCopy {
  switch (state.kind) {
    case 'loading':
      return {
        tone: 'loading', title: TITLE, detail: 'Checking your plan',
        showUpgrade: false, fillPct: 0,
        ariaLabel: 'AI writing: checking your plan. Open License.',
      };

    // No quantity to report, so it reports the plan and the header hides the
    // ring. `Pro plan active` is the reference string in
    // docs/plugin-voice-and-copy.md (not "unlimited": PRO_SOFT_THRESHOLD and the
    // rate limit still apply). The empty detail collapses the copy row to one line.
    case 'pro':
      return {
        tone: 'pro', title: 'Pro plan active', detail: '',
        showUpgrade: false, fillPct: 100,
        ariaLabel: 'AI writing: Pro plan active. Open License.',
      };

    case 'unknown':
      return {
        tone: 'unknown', title: TITLE, detail: state.message,
        showUpgrade: false, fillPct: 0,
        ariaLabel: `AI writing: ${state.message}. Open License.`,
      };

    case 'free': {
      const { remaining, limit } = state;
      const fillPct = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
      if (remaining <= 0) {
        return {
          tone: 'exhausted', title: TITLE, detail: 'No free uses left',
          showUpgrade: true,
          // A full ring: an empty gauge would hide the exhausted amber tone.
          fillPct: 100,
          ariaLabel: 'AI writing: no free uses left. Open License.',
        };
      }
      return {
        tone: remaining < LOW_REMAINING ? 'low' : 'normal',
        title: TITLE,
        detail: `${remaining} of ${limit} free uses left`,
        showUpgrade: true,
        fillPct,
        // The visible detail's own words, so a screen reader hears what is seen.
        ariaLabel: `AI writing: ${remaining} of ${limit} free uses left. Open License.`,
      };
    }

    default:
      return assertNever(state, 'AllowanceState');
  }
}

export type PublishAllowance =
  | { kind: 'hidden' }
  | { kind: 'free'; remaining: number; limit: number; resetsAt: string };

/**
 * The free publishes line, from a quota fetch's or a publish response's
 * snapshot. Pro and "not told yet" both hide it; the server is the authority.
 */
export function publishAllowance(publish: ProxyQuota['publish'] | null): PublishAllowance {
  if (!publish || publish.tier === 'pro') return { kind: 'hidden' };
  // An unstated limit is not zero publishes left: hiding says nothing, while
  // `0 of 0` would say something false.
  if (publish.limit === null) return { kind: 'hidden' };
  const limit = publish.limit;
  const remaining = publish.remaining ?? Math.max(0, limit - publish.used);
  return { kind: 'free', remaining: Math.max(0, remaining), limit, resetsAt: publish.resetsAt };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 1' in UTC, matching the proxy's UTC month boundary. Empty when unparsable. */
export function formatResetDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * When a publish happened, in local time ("8 Sept 2026, 14:32"), since it is a
 * user action, not a server boundary. Null when unparsable, so the caller says
 * "Not recorded" rather than inventing a date. `locale` is for tests.
 */
export function formatPublishedAt(iso: string, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function publishAllowanceCopy(state: PublishAllowance): string | null {
  if (state.kind === 'hidden') return null;
  const reset = formatResetDate(state.resetsAt);
  const tail = reset ? `, resets ${reset}` : '';
  // "publishes", not "updates": the proxy spends one on every publish that
  // writes a version, the first one included.
  if (state.remaining <= 0) return `No free publishes left this month${tail}`;
  return `${state.remaining} of ${state.limit} free publishes left this month${tail}`;
}

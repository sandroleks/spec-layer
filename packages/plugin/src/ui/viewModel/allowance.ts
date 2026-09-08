/**
 * allowance.ts — the two allowance readouts, as pure functions: the header's
 * AI writing control (`allowanceState` / `allowanceCopy`) and the publish
 * screen's monthly updates line (`publishAllowance` /
 * `publishAllowanceCopy`), plus the UTC date formatter both share with the
 * publish error copy.
 *
 * The header shows its control on every screen, so it has to survive every
 * quota shape the proxy can return without changing height or lying about the
 * plan. Two states the server cannot distinguish for us are separated here by
 * the `fetched` flag: "we have not asked yet" (loading) and "we asked and got
 * nothing" (unknown). Reporting the second as the first would spin forever;
 * reporting it as free would demote a Pro user who is briefly offline.
 */

import type { ProxyQuota } from '@spec-layer/extractor';
import type { AllowanceState } from './contracts';
import { assertNever } from './contracts';

/**
 * Matches the `lowThreshold` default in proxy.ts, so the header and the
 * license page's quota meter agree on what "low" means. Do not retune this
 * to make a test pass — fix the test's fixture instead.
 */
export const LOW_REMAINING = 5;

export function allowanceState(quota: ProxyQuota | null, fetched: boolean): AllowanceState {
  if (!fetched) return { kind: 'loading' };
  if (!quota) return { kind: 'unknown', message: 'Plan status unavailable' };
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

    // The one state with no quantity to report, so it reports the plan instead
    // and the header hides the ring. `Pro plan active` is the reference string
    // in docs/plugin-voice-and-copy.md; the old "Unlimited uses" also overstated
    // things, since PRO_SOFT_THRESHOLD and the per-minute rate limit both still
    // apply to Pro. The empty detail is load-bearing: the header collapses the
    // copy row to one line on it.
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
          // A full ring, not an empty one: at 0 remaining a "remaining" gauge
          // has nothing to show regardless of stroke color, so the amber tone
          // on [data-state="exhausted"] would render but never be visible. A
          // brimming amber ring is what carries the urgency instead.
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
        ariaLabel: `AI writing: ${remaining} of ${limit} free uses remaining. Open License.`,
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
 * The publish screen's updates line. Pro and "not told yet" both hide it: the
 * server is the authority, and the publish result carries the answer when the
 * meter could not.
 */
export function publishAllowance(quota: ProxyQuota | null): PublishAllowance {
  const publish = quota?.publish;
  if (!publish || publish.tier === 'pro') return { kind: 'hidden' };
  // A free plan whose limit the server did not state is not a plan with no
  // updates left. Hiding the line says nothing; a `0 of 0` line would say
  // something false.
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

export function publishAllowanceCopy(state: PublishAllowance): string | null {
  if (state.kind === 'hidden') return null;
  const reset = formatResetDate(state.resetsAt);
  const tail = reset ? `, resets ${reset}` : '';
  if (state.remaining <= 0) return `No free updates left this month${tail}`;
  return `${state.remaining} of ${state.limit} free updates left this month${tail}`;
}

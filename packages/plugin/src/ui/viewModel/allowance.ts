/**
 * allowance.ts — the header's AI writing control, as a pure function.
 *
 * The header shows this on every screen, so it has to survive every quota
 * shape the proxy can return without changing height or lying about the plan.
 * Two states the server cannot distinguish for us are separated here by the
 * `fetched` flag: "we have not asked yet" (loading) and "we asked and got
 * nothing" (unknown). Reporting the second as the first would spin forever;
 * reporting it as free would demote a Pro user who is briefly offline.
 */

import type { ProxyQuota } from '@spec-layer/extractor';
import type { AllowanceState } from './contracts';
import { assertNever } from './contracts';

/** Matches the `lowThreshold` default in proxy.ts, so header and license agree. */
export const LOW_REMAINING = 4;

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

    case 'pro':
      return {
        tone: 'pro', title: TITLE, detail: 'Unlimited uses',
        showUpgrade: false, fillPct: 100,
        ariaLabel: 'AI writing: Pro plan, unlimited uses. Open License.',
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
          showUpgrade: true, fillPct: 0,
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

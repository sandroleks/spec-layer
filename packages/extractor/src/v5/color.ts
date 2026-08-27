/**
 * Colour canonicalization — spec §9.6.
 *
 * Figma hands out float RGBA in 0..1. v4 discarded the floats at extraction and
 * kept `{ hex, alpha }`, which is lossy by construction: 0.5 is 127.5 in 8 bits
 * and returns as 0.50196. For CSS that is invisible; for a system round-tripping
 * values back into Figma it is drift from nowhere. So the hex is the portable
 * form and the channels sit beside it WHEN, and only when, they carry something
 * the hex does not.
 *
 * This module REJECTS rather than repairs. An earlier draft clamped and padded,
 * which turned a corrupt channel into a plausible colour and a truncated `#ff`
 * into `#ff0000` -- fabrication, and in direct conflict with the rule that a
 * value not stated by the file is never invented. The caller turns a rejection
 * into `kind: missing` plus an INVALID_SOURCE_COLOR diagnostic, so the fact
 * survives in a form a consumer can act on.
 */
import { canonicalNumber } from './precision';
import type { ColorValue } from './value';

export type ColorResult =
  | { ok: true; value: ColorValue }
  | { ok: false; reason: string };

/** Three or six hex digits, with or without a leading `#`. Case-insensitive on
 *  input; output is always lowercase and six digits. */
export const HEX_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** One unit of the precision policy. A channel within this of the boundary is
 *  float noise from Figma's own arithmetic, not corrupt data. */
const EPSILON = 1e-6;

function snap(channel: number): number | null {
  if (!Number.isFinite(channel)) return null;
  if (channel < 0) return channel >= -EPSILON ? 0 : null;
  if (channel > 1) return channel <= 1 + EPSILON ? 1 : null;
  return channel;
}

const toByte = (channel: number): number => Math.round(channel * 255);
const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0');

/** True when the 8-bit round trip does not return the source number, compared
 *  after the precision policy is applied to both sides so a difference below
 *  the policy's resolution is not treated as a loss. */
function lossy(channel: number): boolean {
  return canonicalNumber(toByte(channel) / 255) !== canonicalNumber(channel);
}

export function canonicalColor(
  rgba: { r: number; g: number; b: number; a: number },
): ColorResult {
  const r = snap(rgba.r);
  const g = snap(rgba.g);
  const b = snap(rgba.b);
  const a = snap(rgba.a);
  if (r === null || g === null || b === null || a === null) {
    return {
      ok: false,
      reason: `colour channel out of range or not finite: `
        + `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
    };
  }
  const value: ColorValue = {
    type: 'color',
    color_space: 'srgb',
    hex: `#${hex2(toByte(r))}${hex2(toByte(g))}${hex2(toByte(b))}`,
    alpha: canonicalNumber(a),
  };
  return {
    ok: true,
    value: (lossy(r) || lossy(g) || lossy(b))
      ? { ...value, channels: [canonicalNumber(r), canonicalNumber(g), canonicalNumber(b)] }
      : value,
  };
}

/**
 * A colour already stored as a hex string — the v4 migration path.
 *
 * No `channels` is emitted, because there are none to emit: v4 threw the floats
 * away. Claiming the hex IS the source precision would be a fabrication, and so
 * would claiming it is not; the absence is the honest statement.
 */
export function colorFromHex(hex: string, alpha: number): ColorResult {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) {
    return { ok: false, reason: `not a valid hex colour: ${JSON.stringify(hex)}` };
  }
  const a = snap(alpha);
  if (a === null) return { ok: false, reason: `alpha out of range: ${alpha}` };
  const raw = trimmed.replace(/^#/, '').toLowerCase();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return {
    ok: true,
    value: { type: 'color', color_space: 'srgb', hex: `#${full}`, alpha: canonicalNumber(a) },
  };
}

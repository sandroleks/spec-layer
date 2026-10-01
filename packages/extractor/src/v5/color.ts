/**
 * Colour canonicalization (spec §9.6). Figma gives float RGBA in 0..1, and 8-bit
 * hex is lossy (0.5 returns as 0.50196), so the float channels sit beside the
 * hex only when they carry something it does not.
 *
 * REJECTS rather than repairs: clamping or padding would invent a plausible
 * colour. The caller turns a rejection into `kind: missing` plus an
 * INVALID_SOURCE_COLOR diagnostic.
 */
import { canonicalNumber } from './precision';
import type { ColorValue } from './value';

/** `reason` is a code from `canonicalColor`, and a sentence from `colorFromHex`
 *  (it reaches the diagnostic's `details.reason`). */
export type ColorResult =
  | { ok: true; value: ColorValue }
  | { ok: false; reason: string };

/** Input is case-insensitive; output is always lowercase and six digits. */
export const HEX_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Within this of the boundary is Figma float noise, not corrupt data. */
const EPSILON = 1e-6;

function snap(channel: number): number | null {
  if (!Number.isFinite(channel)) return null;
  if (channel < 0) return channel >= -EPSILON ? 0 : null;
  if (channel > 1) return channel <= 1 + EPSILON ? 1 : null;
  return channel;
}

const toByte = (channel: number): number => Math.round(channel * 255);
const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0');

/** The 8-bit round trip loses the source number, compared under the precision
 *  policy so sub-resolution differences do not count. */
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
    // A code: the caller reads `ok` only. Covers a non-finite channel too.
    return { ok: false, reason: 'channel_out_of_range' };
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

/** A colour already stored as hex (the v4 migration path). No `channels`: v4
 *  discarded the floats, and the absence is the honest statement. */
export function colorFromHex(hex: string, alpha: number): ColorResult {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) {
    return { ok: false, reason: `The value ${JSON.stringify(hex)} is not a 3-digit or 6-digit hex color.` };
  }
  const a = snap(alpha);
  if (a === null) return { ok: false, reason: `The alpha ${alpha} is not a number from 0 to 1.` };
  const raw = trimmed.replace(/^#/, '').toLowerCase();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return {
    ok: true,
    value: { type: 'color', color_space: 'srgb', hex: `#${full}`, alpha: canonicalNumber(a) },
  };
}

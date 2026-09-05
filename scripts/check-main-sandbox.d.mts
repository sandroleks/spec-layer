export interface SandboxOffender {
  name: string;
  count: number;
}

/**
 * Scan bundle source text for references to globals the Figma sandbox does
 * not provide. Returns a list of offenders (empty when clean).
 */
export function scanSandboxBundle(src: string): SandboxOffender[];

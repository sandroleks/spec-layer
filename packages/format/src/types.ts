export type SpecStatus = 'draft' | 'approved' | 'deprecated';

/** The spec format this build writes. Bumped when a change to the extractor
 *  moves specContentHash for reasons unrelated to the design itself, so a
 *  stale doc reads as "rebuild needed" rather than as content drift. */
export const SPEC_VERSION = '0.2' as const;

/** Versions this build can still read. */
export type SpecVersion = '0.1' | '0.2';

export interface SpecFrontmatter {
  spec_version: SpecVersion;
  status?: SpecStatus;
  component: {
    name: string;
    figma_key: string;
    figma_file: string;
    figma_node: string;
  };
  content_hash: string;
  extracted_at: string; // ISO 8601
  approved_by?: string;
}

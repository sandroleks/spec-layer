import {
  LibraryBundleError, parseLibraryBundle,
  type LibraryBundleArtifact, type LibraryBundleComponent, type LibraryBundleV1,
} from '@spec-layer/extractor';

// The wire shape is defined once in the extractor and inlined here at build
// time, so the plugin, the proxy, and this CLI cannot disagree about it. The
// CLI still never re-derives v5 output; this is envelope parsing only.
export type ArtifactLike = LibraryBundleArtifact;
export type BundleEntry = LibraryBundleComponent;
export type BundleV1 = LibraryBundleV1;

export function parseBundle(raw: string): BundleV1 {
  try {
    return parseLibraryBundle(raw);
  } catch (err) {
    if (!(err instanceof LibraryBundleError)) throw err;
    switch (err.code) {
      case 'not_json': throw new Error('The server response is not valid JSON.');
      case 'not_bundle': throw new Error('The server response is not a Spec Layer library bundle.');
      case 'unsupported_version': throw new Error(`${err.message} Update spec-layer and try again.`);
      case 'malformed': throw new Error(err.message);
    }
  }
}

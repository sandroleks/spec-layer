import { LibraryBundleError, parseLibraryBundle, type LibraryBundleV1 } from '@spec-layer/extractor';

// The wire shape lives in the extractor so plugin, proxy, and CLI agree on it.
// Envelope parsing only: the CLI never re-derives v5 output.
export type BundleV1 = LibraryBundleV1;

export function parseBundle(raw: string): BundleV1 {
  try {
    return parseLibraryBundle(raw);
  } catch (err) {
    if (!(err instanceof LibraryBundleError)) throw err;
    switch (err.code) {
      case 'not_json': throw new Error('The server response is not valid JSON.', { cause: err });
      case 'not_bundle': throw new Error('The server response is not a Spec Layer library bundle.', { cause: err });
      case 'unsupported_version': throw new Error(`${err.message} Update spec-layer and try again.`, { cause: err });
      case 'malformed': throw new Error(err.message, { cause: err });
    }
  }
}

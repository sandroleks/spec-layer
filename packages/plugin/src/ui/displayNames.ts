/**
 * Display names live in the extractor now: the prose prompt needs them and the
 * extractor cannot import plugin code. This re-export keeps every plugin import
 * path stable. Add nothing here.
 */
export { displayComponentName, displayPartName } from '@spec-layer/extractor';

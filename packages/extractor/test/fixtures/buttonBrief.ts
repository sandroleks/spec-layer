/**
 * The golden component brief: its inputs, its rendering, and the generator
 * that writes it.
 *
 * There is exactly ONE definition of the inputs here, imported by both the
 * golden test and the generation step, because two hand-kept copies of
 * `figmaFile`, `figmaFileName` and `generatedAt` is how a golden file silently
 * stops testing anything: change one copy, regenerate, and the test still
 * passes while comparing a payload nobody asked for. With a single exported
 * `renderButtonBrief`, the fixture and the assertion cannot disagree even in
 * principle.
 *
 * Division of labour:
 * - `briefGolden.test.ts` only ever ASSERTS. It must never write the fixture.
 *   A test that writes its own expectation cannot fail the first time it runs,
 *   which is exactly when it should.
 * - `writeButtonBrief` runs only when this file is the process entry point, so
 *   regeneration is a deliberate act by a human and never a side effect of a
 *   test run.
 *
 * Regenerate with:
 *
 *   npx tsx packages/extractor/test/fixtures/buttonBrief.ts
 *
 * then read the diff before committing it. Never hand-edit the YAML: a golden
 * file edited to match a bug documents the bug. Fix the generator's source and
 * regenerate instead.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentBrief, extract, toYaml } from '../../src/index';
import type { SerializedNode } from '../../src/tree';
import button from './button.json';

/**
 * Resolved from this module's own URL rather than from the working directory,
 * so the test and the generator name the same file whatever either is invoked
 * from.
 */
export const GOLDEN_PATH = fileURLToPath(new URL('./button-brief.yaml', import.meta.url));

/**
 * A file name as well as a key: `file_name` comes from extract()'s meta, so
 * passing only `figmaFile` would leave the field absent and the golden file
 * would never exercise it. Both are placeholders, and `generatedAt` is fixed,
 * because a golden file compared byte for byte cannot carry a real clock.
 */
const META = { figmaFile: 'FILE1', figmaFileName: 'Design System' };
const GENERATED_AT = '2026-08-18T00:00:00.000Z';

/** The exact bytes the golden file holds. */
export function renderButtonBrief(): string {
  const spec = extract(button as SerializedNode, META);
  return toYaml(componentBrief(spec, { generatedAt: GENERATED_AT }));
}

/** Overwrite the golden file. Deliberate, human-invoked, never automatic. */
export function writeButtonBrief(): void {
  writeFileSync(GOLDEN_PATH, renderButtonBrief());
}

// Entry-point check, not an import-time side effect: process.argv[1] is this
// file only when a human ran it directly. Under vitest it is the test runner's
// own bin, so importing this module from a test writes nothing.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeButtonBrief();
}

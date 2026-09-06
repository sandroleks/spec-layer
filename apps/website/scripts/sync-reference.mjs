import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const repo = new URL('../../', root);
const pairs = [
  ['packages/extractor/src/v5/schema/component-5.1.0.json', 'public/schemas/component-context/v5.json'],
  ['packages/extractor/src/v5/schema/foundation-5.1.0.json', 'public/schemas/foundation-context/v5.json'],
  ['packages/extractor/test/fixtures/v5/button-component-ai-v5.yaml', 'public/example-button.yaml'],
  ['packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/', 'public/examples/foundation/']
];
for (const [from, to] of pairs) {
  await mkdir(new URL('./', new URL(to, root)), { recursive: true });
  await cp(new URL(from, repo), new URL(to, root), { recursive: true });
}
const cli = JSON.parse(await readFile(new URL('packages/cli/package.json', repo), 'utf8'));
const schema = JSON.parse(await readFile(new URL('public/schemas/component-context/v5.json', root), 'utf8'));
await writeFile(new URL('content/reference.json', root), JSON.stringify({ cliVersion: cli.version, schemaVersion: schema.$defs.envelope.properties.schema_version.const }, null, 2) + '\n');
console.log(`Synced schemas and synthetic examples into ${fileURLToPath(root)}.`);

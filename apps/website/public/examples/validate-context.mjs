import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const [schemaPath, artifactPath, ...dependencyPaths] = process.argv.slice(2);
if (!schemaPath || !artifactPath) {
  console.error('Usage: node validate-context.mjs SCHEMA.json ARTIFACT.json [DEPENDENCY.json ...]');
  process.exitCode = 1;
} else {
  try {
    const [schema, artifact] = await Promise.all(
      [schemaPath, artifactPath].map(async path => JSON.parse(await readFile(path, 'utf8')))
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    for (const path of dependencyPaths) {
      ajv.addSchema(JSON.parse(await readFile(path, 'utf8')));
    }
    const validate = ajv.compile(schema);
    if (validate(artifact)) {
      console.log('Canonical artifact matches the schema.');
    } else {
      console.error(JSON.stringify(validate.errors, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Order defines the sidebar and previous/next navigation. Add future pages here.
export const pages = [
  { slug: 'index', title: 'Documentation', seoTitle: 'Documentation for Figma design systems', nav: 'Overview', group: 'Getting started', description: 'Guides and reference for Spec Layer, from Figma documentation to structured design context in your repository.', source: 'README.md' },
  { slug: 'quickstart', title: 'Get started with Spec Layer', seoTitle: 'Quickstart: Figma docs and CLI setup', nav: 'Quickstart', group: 'Getting started', description: 'Create docs in Figma, copy context for AI, and connect a published library to your repository.', source: 'packages/cli/README.md' },
  { slug: 'outputs', title: 'Understand the output', seoTitle: 'Output formats: component YAML and DTCG tokens', nav: 'Output formats', group: 'Reference', description: 'Canvas documentation, component YAML, foundation DTCG JSON, and the files written by Spec Layer.', source: 'packages/cli/README.md' },
  { slug: 'cli', title: 'CLI command reference', nav: 'CLI commands', group: 'Reference', description: 'Spec Layer CLI setup, init, pull, status, list, and show commands, with flags, examples, and exit codes.', source: 'packages/cli/src/cli.ts' },
  { slug: 'configuration', title: 'Configure your project', seoTitle: 'CLI configuration and design token options', nav: 'Configuration', group: 'Reference', description: 'Configure output selection, pull keys, token formats, unit overrides, and automated Spec Layer pulls.', source: 'packages/cli/src/config.ts' },
  { slug: 'schemas', title: 'Schemas and validation', seoTitle: 'Context JSON schemas and validation', nav: 'Schemas', group: 'Reference', description: 'Canonical Component and Foundation Context v5 schemas, versioning, required fields, and validation boundaries.', source: 'docs/specs/component-context-v5.md' }
];
export const pageUrl = page => page.slug === 'index' ? '/docs/' : `/docs/${page.slug}/`;

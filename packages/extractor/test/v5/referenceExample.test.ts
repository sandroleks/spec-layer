/**
 * Pins that the synthetic reference example exercises every feature the
 * documentation site explains. When a feature assertion here fails, fix the
 * input JSON under `fixtures/reference-example/`, not the assertion: this list
 * is what the site's Example page walks a reader through.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  EXTRACTOR_VERSION, componentAiContext, componentMarkdown, parseLibraryBundle, toYaml, usageUnits, validateLevel1, validateLevel2,
  type YamlValue,
} from '../../src/index';
import {
  REFERENCE_DESCRIPTION, REFERENCE_GENERATED_AT, REFERENCE_LIBRARY_ID,
  buildReferenceBundle, buildReferenceButton, buildReferenceFoundation,
} from '../fixtures/referenceExample';

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed YAML is untyped by nature */
type Doc = Record<string, any>;

const yaml = (): string => toYaml(componentAiContext(buildReferenceButton()) as unknown as YamlValue);
const doc = (): Doc => load(yaml()) as Doc;

const foundationSchema = JSON.parse(readFileSync(
  'packages/extractor/src/v5/schema/foundation-5.1.1.json', 'utf8',
)) as Record<string, unknown>;
const componentSchema = JSON.parse(readFileSync(
  'packages/extractor/src/v5/schema/component-5.2.0.json', 'utf8',
)) as Record<string, unknown>;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true, inlineRefs: false }));
ajv.addSchema(foundationSchema);
const validateComponent = ajv.compile(componentSchema);
const validateFoundation = ajv.getSchema(foundationSchema.$id as string)!;

describe('reference example inputs', () => {
  it('uses a library id the CLI accepts', () => {
    expect(REFERENCE_LIBRARY_ID).toMatch(/^lib_[0-9a-f]{24}$/);
  });

  it('builds schema-valid artifacts', () => {
    const foundation = buildReferenceFoundation();
    expect(validateLevel1(foundation).filter((d) => d.severity === 'error')).toEqual([]);
    expect(validateLevel2(foundation).filter((d) => d.severity === 'error')).toEqual([]);
    expect(validateFoundation(foundation), ajv.errorsText(validateFoundation.errors)).toBe(true);
    const button = buildReferenceButton();
    expect(validateComponent(button), ajv.errorsText(validateComponent.errors)).toBe(true);
    expect(button.spec_layer.export.generated_at).toBe(REFERENCE_GENERATED_AT);
  });

  it('resolves every component reference against the foundation', () => {
    const button = buildReferenceButton();
    expect(button.diagnostics).toEqual([]);
    expect(button.references.used.every((ref) => ref.status === 'resolved')).toBe(true);
  });

  it('carries written guidelines and the designer description', () => {
    const d = doc();
    expect(d.component.description).toBe(REFERENCE_DESCRIPTION);
    expect(typeof d.guidelines.definition).toBe('string');
    expect(typeof d.guidelines.accessibility).toBe('string');
    expect(d.guidelines.dos.length).toBeGreaterThan(0);
    expect(d.guidelines.donts.length).toBeGreaterThan(0);
  });

  it('has a binding that covers several layers', () => {
    // toYaml writes a short path list as a flow sequence on the item line.
    expect(yaml()).toMatch(/^\s+- paths: \[[^\]]+, [^\]]+\]$/m);
    const grouped = (doc().references.bindings as Doc[]).filter((b) => Array.isArray(b.paths));
    expect(grouped.some((b) => b.paths.length > 1)).toBe(true);
  });

  it('models states as switches in when clauses', () => {
    expect(yaml()).toMatch(/when:[\s\S]*hover:/);
    const d = doc();
    expect(d.api.states).toEqual(expect.arrayContaining(['hover', 'disabled']));
    const whens = (d.references.bindings as Doc[]).flatMap((b) => (b.when ? [b.when] : []));
    expect(whens.some((w) => Array.isArray(w.hover) && w.hover.map(String).includes('True')))
      .toBe(true);
  });

  it('references a text style and resolves aliased values across modes', () => {
    const text = yaml();
    expect(text).toContain('kind: text-style');
    expect(text).toMatch(/alias:/);
    expect(text).toMatch(/resolved:/);
    const d = doc();
    expect((d.references.foundation.styles.typography as Doc[])
      .some((s) => s.properties.font_size.alias !== undefined
        && s.properties.font_size.resolved !== undefined)).toBe(true);
    const tokens = (d.references.foundation.collections as Doc[]).flatMap((c) => c.tokens as Doc[]);
    const acrossModes = tokens.filter((t) => t.values.Light?.alias && t.values.Dark?.alias
      && JSON.stringify(t.values.Light.resolved) !== JSON.stringify(t.values.Dark.resolved));
    expect(acrossModes.length).toBeGreaterThan(0);
  });

  it('turns foundation findings into validation rows, not bare issue counts', () => {
    expect(yaml()).toMatch(/validation:/);
    const rows = doc().references.foundation.validation as Doc[] | undefined;
    expect(rows?.length ?? 0).toBeGreaterThan(0);
    expect(rows!.every((row) => typeof row.message === 'string' && row.message.length > 0)).toBe(true);
  });

  it('reports an unbound literal padding value', () => {
    const unbound = doc().unbound as Doc[];
    expect(unbound.some((row) => String(row.property).startsWith('padding')
      && row.issue === 'hardcoded-value' && typeof row.value === 'number')).toBe(true);
  });

  it('derives at least one unit from usage for the CSS output', () => {
    const units = usageUnits(buildReferenceBundle());
    expect(units.size).toBeGreaterThan(0);
    // radius/200 is unscoped; the CORNER_RADIUS-scoped radius/control aliases it.
    expect(units.get('VariableID:ref/radius-200')).toMatchObject({ unit: 'px', via: 'alias-scope' });
  });

  it('renders the Markdown projection with the description and guidelines', () => {
    const page = componentMarkdown(buildReferenceButton());
    expect(page).toContain(REFERENCE_DESCRIPTION);
    expect(page).toContain('Use the Filled style for the single most important action');
  });

  it('builds a bundle the library reader accepts', () => {
    const bundle = parseLibraryBundle(JSON.parse(JSON.stringify(buildReferenceBundle())));
    expect(bundle.fileName).toBe('Reference Design System');
    expect(bundle.pluginVersion).toBe('6.0.0');
    expect(bundle.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(bundle.components.map((c) => c.name)).toEqual(['Button']);
    expect(bundle.components[0].variants?.length).toBeGreaterThan(1);
  });
});

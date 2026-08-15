/**
 * brief.ts — the public YAML brief projections.
 *
 * These are the product's only export contract now that Markdown is retired,
 * so they are deliberately a PROJECTION of the internal types rather than a
 * dump of them: internal ids, minimized token conditions, and rendering
 * concerns stay inside, and the shapes here can stay stable while the
 * extractor's internals change.
 */

import type { FoundationSpec, FoundationValue, FoundationVariable } from './foundation';
import { EXTRACTOR_VERSION } from './version';
import type { YamlValue } from './yaml';

/** Brief schema version. Bumped when the brief's shape or field meanings
 *  change, independently of EXTRACTOR_VERSION. */
export const BRIEF_VERSION = 1;

function envelope(kind: 'component' | 'foundation', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/** A resolved value flattened to what a consumer can act on. */
function valueOf(v: FoundationValue): YamlValue {
  switch (v.kind) {
    case 'color': return v.alpha === 1 ? v.hex : { hex: v.hex, alpha: v.alpha };
    case 'number': return v.value;
    case 'string': return v.value;
    case 'boolean': return v.value;
    case 'alias':
      return {
        alias: v.targetName,
        resolved: v.resolved ? valueOf(v.resolved) : undefined,
        external: v.external ? true : undefined,
      };
    case 'unresolved': return { unresolved: v.reason };
  }
}

function tokenOf(variable: FoundationVariable, modeName: (id: string) => string): YamlValue {
  const values: Record<string, YamlValue> = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    values[modeName(modeId)] = valueOf(value);
  }
  const code = Object.keys(variable.codeSyntax).length > 0 ? variable.codeSyntax : undefined;
  return {
    name: variable.name,
    type: variable.resolvedType.toLowerCase(),
    description: variable.description || undefined,
    code: code as YamlValue,
    values,
  };
}

export function foundationBrief(foundation: FoundationSpec, generatedAt: string): YamlValue {
  return {
    spec_layer: envelope('foundation', generatedAt),
    source: { file: foundation.fileKey },
    collections: foundation.collections.map((c) => {
      const byId = new Map(c.modes.map((m) => [m.modeId, m.name]));
      const modeName = (id: string) => byId.get(id) ?? id;
      return {
        name: c.name,
        modes: c.modes.map((m) => m.name),
        default_mode: modeName(c.defaultModeId),
        tokens: c.variables.map((v) => tokenOf(v, modeName)),
      };
    }),
    text_styles: foundation.textStyles.map((t) => ({
      name: t.name,
      font: { family: t.fontFamily, style: t.fontStyle, size: t.fontSize },
      line_height: { unit: t.lineHeight.unit, value: t.lineHeight.value },
      letter_spacing: { unit: t.letterSpacing.unit, value: t.letterSpacing.value },
    })),
  };
}

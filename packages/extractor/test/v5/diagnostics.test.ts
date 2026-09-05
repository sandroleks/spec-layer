import { describe, it, expect } from 'vitest';
import {
  diagnostic, sortDiagnostics, promoteToErrors, hasErrors,
  DEFAULT_SEVERITY, compareCodeUnits,
} from '../../src/v5/diagnostics';

describe('diagnostics', () => {
  it('carries every code in the spec table with its default severity', () => {
    const expected: Record<string, string> = {
      UNRESOLVED_ALIAS: 'error', UNRESOLVED_EXTERNAL_ALIAS: 'error',
      ALIAS_CYCLE: 'error', ALIAS_TYPE_MISMATCH: 'error',
      MISSING_MODE_VALUE: 'error', DUPLICATE_SOURCE_ID: 'error',
      PATH_COLLISION: 'error', UNSUPPORTED_VALUE_TYPE: 'error',
      INCONSISTENT_VALUE_SHAPE: 'error',
      STYLE_BINDING_DRIFT: 'warning', CONFUSABLE_NAME: 'warning',
      INFERRED_LIFECYCLE: 'warning', DEPRECATED_REFERENCE: 'warning',
      GENERATED_NAME_COLLISION: 'warning',
      MODE_VALUES_IDENTICAL: 'info', MISSING_DESCRIPTION: 'info',
    };
    for (const [code, severity] of Object.entries(expected)) {
      expect(DEFAULT_SEVERITY[code as keyof typeof DEFAULT_SEVERITY]).toBe(severity);
    }
  });

  it('has dedicated codes for the migration facts, not overloaded ones', () => {
    expect(DEFAULT_SEVERITY.SYNTHETIC_IDENTITY).toBe('warning');
    expect(DEFAULT_SEVERITY.AMBIGUOUS_ALIAS_TARGET).toBe('error');
    expect(DEFAULT_SEVERITY.UNIT_METADATA_UNAVAILABLE).toBe('warning');
    expect(DEFAULT_SEVERITY.SOURCE_PARTIALLY_UNAVAILABLE).toBe('error');
    expect(DEFAULT_SEVERITY.INVALID_SOURCE_COLOR).toBe('error');
    expect(DEFAULT_SEVERITY.METADATA_UNAVAILABLE).toBe('info');
    expect(DEFAULT_SEVERITY.EXPORT_SCOPED).toBe('info');
  });

  it('takes its severity from the table without the caller restating it', () => {
    const d = diagnostic('ALIAS_CYCLE', { entity_id: 'V:1', message: 'a -> b -> a' });
    expect(d.severity).toBe('error');
    expect(d.entity_id).toBe('V:1');
  });

  it('orders by code unit, not by locale', () => {
    // localeCompare orders ['_','a','ä','B']; code units give ['B','_','a','ä'].
    // Only the second is a byte-stability guarantee.
    expect(['a', 'B', '_', 'ä'].sort(compareCodeUnits)).toEqual(['B', '_', 'a', 'ä']);
  });

  it('orders deterministically: severity, then code, then entity, then mode', () => {
    const unsorted = [
      diagnostic('MODE_VALUES_IDENTICAL', { entity_id: 'V:2', message: 'm' }),
      diagnostic('UNRESOLVED_ALIAS', { entity_id: 'V:2', message: 'm' }),
      diagnostic('UNRESOLVED_ALIAS', { entity_id: 'V:1', message: 'm' }),
      diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' }),
    ];
    expect(sortDiagnostics(unsorted).map((d) => [d.code, d.entity_id])).toEqual([
      ['UNRESOLVED_ALIAS', 'V:1'],
      ['UNRESOLVED_ALIAS', 'V:2'],
      ['CONFUSABLE_NAME', 'V:1'],
      ['MODE_VALUES_IDENTICAL', 'V:2'],
    ]);
  });

  it('is total: findings differing only in message or details still order stably', () => {
    // Array.sort is stable, so a comparator that returns 0 here would let the
    // CALLER's order decide -- and the caller's order follows Figma's internal
    // iteration. Two runs would then produce byte-different artifacts with no
    // design change behind them.
    const a = diagnostic('MISSING_MODE_VALUE', { entity_id: 'V:1', message: 'second' });
    const b = diagnostic('MISSING_MODE_VALUE', { entity_id: 'V:1', message: 'first' });
    expect(sortDiagnostics([a, b]).map((d) => d.message)).toEqual(['first', 'second']);
    expect(sortDiagnostics([b, a]).map((d) => d.message)).toEqual(['first', 'second']);

    const c = diagnostic('PATH_COLLISION', { entity_id: 'V:1', message: 'm', details: { n: 2 } });
    const d = diagnostic('PATH_COLLISION', { entity_id: 'V:1', message: 'm', details: { n: 1 } });
    expect(sortDiagnostics([c, d])).toEqual(sortDiagnostics([d, c]));
  });

  it('reports whether any error is present, for §14.2 exit behaviour', () => {
    expect(hasErrors([diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' })])).toBe(false);
    expect(hasErrors([diagnostic('ALIAS_CYCLE', { entity_id: 'V:1', message: 'm' })])).toBe(true);
  });

  it('promotes only the named codes in strict mode', () => {
    const given = [
      diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' }),
      diagnostic('MODE_VALUES_IDENTICAL', { entity_id: 'V:2', message: 'm' }),
    ];
    const strict = promoteToErrors(given, ['CONFUSABLE_NAME']);
    expect(strict[0].severity).toBe('error');
    expect(strict[1].severity).toBe('info');
  });
});

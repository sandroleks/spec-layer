/**
 * Foundation Context v5 statistics — spec §15.
 *
 * Derived from finished artifact sections only. No extraction-time counters
 * enter this function, so every reported number can be independently rebuilt
 * from the artifact a consumer received.
 */
import type { Diagnostic } from './diagnostics';
import type { CollectionV5, TokenV5 } from './entities';
import type { SemanticPayload } from './canonical';

export function computeFoundationStatistics(input: {
  collections: CollectionV5[];
  tokens: TokenV5[];
  styles: SemanticPayload['styles'];
  diagnostics: Diagnostic[];
}): Record<string, unknown> {
  const { collections, tokens, styles, diagnostics } = input;

  const modes = collections.reduce((sum, collection) => sum + collection.modes.length, 0);

  const allValues = tokens.flatMap((token) => Object.values(token.values));
  const aliasValues = allValues.filter((value) => value.kind === 'alias');
  const resolvedAliases = aliasValues
    .filter((value) => value.resolved.status === 'resolved').length;

  const lifecycle = { active: 0, deprecated: 0, archived: 0 };
  for (const token of tokens) {
    // Absence is unknown, not active. A missing lifecycle record therefore
    // contributes to none of the three buckets.
    if (token.lifecycle !== undefined) lifecycle[token.lifecycle.status] += 1;
  }

  const diagnosticCounts = { error: 0, warning: 0, info: 0 };
  for (const finding of diagnostics) diagnosticCounts[finding.severity] += 1;

  return {
    collections: collections.length,
    modes,
    tokens: tokens.length,
    styles: { typography: styles.typography.length, effects: styles.effects.length },
    aliases: {
      total: aliasValues.length,
      resolved: resolvedAliases,
      unresolved: aliasValues.length - resolvedAliases,
    },
    lifecycle,
    diagnostics: diagnosticCounts,
  };
}

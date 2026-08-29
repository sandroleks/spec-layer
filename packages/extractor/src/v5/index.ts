/**
 * Foundation Context v5 public surface.
 *
 * Keeping the versioned contract behind one barrel makes the package root the
 * supported import path while preserving `src/v5/` as the boundary between the
 * shipping v4 brief and the next contract.
 */
export * from './value';
export * from './entities';
export * from './precision';
export * from './color';
export * from './units';
export * from './diagnostics';
export * from './canonical';
export * from './validate';
export * from './normalize';
export * from './statistics';
export * from './fromFoundation';
export * from './aiContext';
export * from './componentContext';

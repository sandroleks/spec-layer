export * from './tree';
export * from './anatomy';
export * from './props';
export * from './naming';
export * from './tokens';
export * from './layout';
export * from './rawValues';
export * from './extract';
export * from './foundation';
export * from './hash';
export * from './version';
export * from './resolve';
export * from './statesMatrix';
export * from './contrast';
export {
  colorRole, barsCleared, colorContrast, CONTRAST_AXIS_CAP,
  // The classifier's vocabulary, so a consumer telling a user how to name their
  // tokens can derive that guidance from the real sets instead of restating them.
  // A hand-kept second copy is exactly how the foundation frame's guidance copy
  // went stale. ReadonlySet at the source, so a consumer cannot mutate it.
  FOREGROUND_WORDS, BACKGROUND_WORDS,
  type ColorRole, type ContrastBar, type ContrastCell, type ContrastMatrix,
  type ContrastFailure, type ColorContrastReport,
} from './colorContrast';
export * from './prose/prompt';
export * from './prose/foundationPrompt';
export * from './prose/client';
export * from './yaml';
export * from './brief';
export * from './validate';

/** §21.1's acceptance criteria and the implementation plan that grades each. */
export const ACCEPTANCE_COVERAGE = {
  1: { criterion: 'six collections with stable ids', gradedBy: 'plan-2' },
  2: { criterion: 'every declared mode has a stable id', gradedBy: 'plan-2' },
  3: { criterion: 'every token and style has a stable source id', gradedBy: 'plan-2' },
  4: { criterion: 'internal aliases resolve with complete chains', gradedBy: 'plan-2' },
  5: { criterion: 'three deprecated external refs are unresolved errors', gradedBy: 'plan-2' },
  6: { criterion: 'every v4 value shape normalizes to one canonical shape', gradedBy: 'plan-1' },
  '7a': { criterion: 'dimensional floats keep their numeric value', gradedBy: 'plan-1' },
  '7b': { criterion: 'dimensional floats receive explicit units', gradedBy: 'plan-2' },
  8: { criterion: 'the Cyrillic С is preserved and flagged', gradedBy: 'plan-1' },
  9: { criterion: 'archived text styles get lifecycle and INFERRED_LIFECYCLE', gradedBy: 'plan-3' },
  10: { criterion: 'identical typography mode values are preserved', gradedBy: 'plan-3' },
  11: { criterion: 'card shadow representations stay independent', gradedBy: 'plan-3' },
  12: { criterion: 'repeated extraction produces one semantic hash', gradedBy: 'plan-1' },
} as const;

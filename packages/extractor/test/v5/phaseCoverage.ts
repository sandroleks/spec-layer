/** §21.1's acceptance criteria and the implementation plan that grades each. */
export const ACCEPTANCE_COVERAGE = {
  1: {
    criterion: 'six Company DS collections with stable ids',
    implementedBy: 'plan-2', gradedBy: 'pending-real-fixture',
  },
  2: {
    criterion: 'every Company DS declared mode has a stable id',
    implementedBy: 'plan-2', gradedBy: 'pending-real-fixture',
  },
  3: {
    criterion: 'every token and style has a stable source id',
    implementedBy: 'plan-3', gradedBy: 'plan-3',
  },
  4: {
    criterion: 'Company DS internal aliases resolve with complete chains',
    implementedBy: 'plan-2', gradedBy: 'pending-real-fixture',
  },
  5: {
    criterion: 'three Company DS deprecated external refs are unresolved errors',
    implementedBy: 'plan-2', gradedBy: 'pending-real-fixture',
  },
  6: {
    criterion: 'every v4 value shape normalizes to one canonical shape',
    implementedBy: 'plan-1', gradedBy: 'plan-1',
  },
  '7a': {
    criterion: 'dimensional floats keep their numeric value',
    implementedBy: 'plan-1', gradedBy: 'plan-1',
  },
  '7b': {
    criterion: 'Company DS dimensional floats receive explicit units',
    implementedBy: 'plan-2', gradedBy: 'pending-real-fixture',
  },
  8: {
    criterion: 'the Cyrillic С is preserved and flagged',
    implementedBy: 'plan-1', gradedBy: 'plan-1',
  },
  9: {
    criterion: 'archived text styles get lifecycle and INFERRED_LIFECYCLE',
    implementedBy: 'plan-3', gradedBy: 'plan-3',
  },
  10: {
    criterion: 'identical typography mode values are preserved',
    implementedBy: 'plan-3', gradedBy: 'plan-3',
  },
  11: {
    criterion: 'card shadow representations stay independent',
    implementedBy: 'plan-3', gradedBy: 'plan-3',
  },
  12: {
    criterion: 'repeated extraction produces one semantic hash',
    implementedBy: 'plan-1', gradedBy: 'plan-1',
  },
} as const;

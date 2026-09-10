/**
 * redos.test.ts — the four regexes CodeQL flagged as `js/polynomial-redos`,
 * replaced by linear scans and pinned against the regexes they replaced.
 *
 * Each rewrite has to return the SAME string the regex returned, for every
 * input, not merely for the happy path. Two of them are identity in this
 * extractor: `cleanPartName` feeds anatomy and token paths, `stateBaseName`
 * feeds `spec.states`, and both reach `specContentHash`, so a single
 * disagreement would move every committed document's drift baseline. The old
 * regexes live here as oracles rather than in a comment, so the equivalence is
 * executable rather than asserted.
 *
 * The subtle one is `stateBaseName`: `[^)]*` happily contains `(`, and the
 * engine takes the leftmost start that matches, so `a ((x)` strips from the
 * FIRST paren. A right-to-left scan that stops at the nearest `(` passes every
 * obvious case and fails that one.
 *
 * The timing assertions are deliberately loose. They exist to catch a
 * reintroduced quadratic, not to benchmark: measured at n = 10k the originals
 * took 406ms (hashes), 174ms (en dash) and 9ms (fence), each quadrupling on
 * every doubling, so anything still backtracking blows a 2-second budget at
 * n = 200k long before a linear scan notices.
 */
import { describe, it, expect } from 'vitest';
import { cleanPartName } from '../src/naming';
import { parseProseResponse } from '../src/prose/prompt';
import { stateBaseName } from '../src/statesMatrix';

// --- The regexes as they were, before the rewrites -------------------------

const oldCleanPartName = (name: string): string => name.replace(/#+\s*$/, '').trim();

const oldNormalizeProseText = (value: string): string => value
  .replace(/[ \t]*—[ \t]*/g, ', ')
  .replace(/[ \t]+–[ \t]+/g, ', ');

const oldStateBaseName = (v: string): string =>
  v.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();

const oldFencedBlock = (text: string): string | null => {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1] : null;
};

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function fuzz(seed: number, alphabet: readonly string[], maxLen: number): string {
  const next = rng(seed);
  const len = Math.floor(next() * maxLen);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(next() * alphabet.length)];
  return out;
}

describe('cleanPartName is exactly the regex it replaced', () => {
  // Every shape the pattern can meet: hashes, whitespace of both kinds,
  // ordinary characters, and the interleavings that decide where the leftmost
  // match starts.
  const CASES = [
    '', '#', '##', '###', 'a', 'a#', 'a##', '#a', '#a#', 'a#b#',
    ' ', '   ', '#  ', '  #  ', 'a#  ', 'a #', 'a # ', 'a## ##  ', 'a#  #',
    'icon-primary#', 'icon#2', 'icon#2#', '#icon', 'a\t#\t', 'a#\n', 'a#\n\n',
    '  a  ', ' # ', 'a# ', '# a #', 'a#b', '#'.repeat(20),
    'a' + '#'.repeat(20), '#'.repeat(20) + 'a', 'a' + '#'.repeat(20) + '  ',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(cleanPartName(input), JSON.stringify(input)).toBe(oldCleanPartName(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = ['#', ' ', '\t', '\n', 'a', 'b', ' '] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 24);
      expect(cleanPartName(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldCleanPartName(input));
    }
  });

  it('is linear on a long run of hashes that does not end the string', () => {
    // The original's worst case: `#+` retried from every start position.
    // 40k hashes measured 6.7 seconds.
    const input = '#'.repeat(200000) + 'x';
    const started = performance.now();
    expect(cleanPartName(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('prose dash normalization is exactly the regexes it replaced', () => {
  /** Push a string through the shipped path: `dos` entries are mapped straight
   *  through `normalizeProseText` with nothing else applied. */
  const normalized = (value: string): string => {
    const out = parseProseResponse(JSON.stringify({
      definition: 'D', accessibility: 'A', dos: [value], donts: [],
    }));
    return out.dos[0];
  };

  const CASES = [
    '', 'a—b', 'a — b', 'a  —  b', '—', ' — ', 'a—', '—b', 'a—​—b', 'a — — b',
    'a  —  —  b', 'a–b', 'a – b', 'a  –  b', '–', ' – ', 'a–', '–b', 'a -– b',
    '3-5', '3–5', 'a\t—\tb', 'a \t— \tb', 'a\n—\nb', 'a—\nb', 'a \n– \n b',
    'one — two – three', 'one – two — three', 'a — b – c — d',
    // A line break must survive: the classes are `[ \t]`, not `\s`.
    'first line — x\nsecond – line', 'a –\nb', 'a\n– b',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(normalized(input), JSON.stringify(input)).toBe(oldNormalizeProseText(input));
    }
  });

  it('agrees on 2000 random strings over the alphabet that matters', () => {
    const alphabet = [' ', '\t', '\n', '—', '–', 'a', 'b', '-'] as const;
    for (let seed = 1; seed <= 2000; seed++) {
      const input = fuzz(seed, alphabet, 20);
      expect(normalized(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldNormalizeProseText(input));
    }
  });

  it('is linear on a long whitespace run that never reaches a dash', () => {
    // The en-dash rule's worst case. 40k spaces measured 2.5 seconds.
    const input = ' '.repeat(200000) + '–x';
    const started = performance.now();
    expect(normalized(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('fence extraction is exactly the regex it replaced', () => {
  const BODY = '{"definition":"D","accessibility":"A","dos":[],"donts":[]}';

  /**
   * `fencedBlock` is private, so this reads it through the only thing that
   * observes it: whether the text parses, and to what. The oracle says what the
   * old regex would have handed `JSON.parse`, and the two must agree on both
   * the success and the failure cases.
   */
  const parses = (text: string): string | 'threw' => {
    try {
      return parseProseResponse(text).definition;
    } catch {
      return 'threw';
    }
  };

  const oracle = (text: string): string | 'threw' => {
    const extracted = oldFencedBlock(text);
    const cleaned = extracted !== null ? extracted.trim() : text.trim();
    try {
      return (JSON.parse(cleaned) as { definition: string }).definition;
    } catch {
      return 'threw';
    }
  };

  const CASES = [
    BODY,
    '```json\n' + BODY + '\n```',
    '```\n' + BODY + '\n```',
    '```json' + BODY + '```',
    'Here you go:\n```json\n' + BODY + '\n```\nHope that helps.',
    '```json   \t\n  ' + BODY + '  ```',
    // Unclosed fence: the regex found no match and fell through to the raw text.
    '```json\n' + BODY,
    '```',
    '``````',
    '`````',
    '````````',
    '``` ``',
    '```json```',
    '``````' + BODY + '```',
    // Two fences: the first closed one wins, lazily.
    '```json\n' + BODY + '\n```\n```json\n{"definition":"OTHER"}\n```',
    // "json" that is not the language tag.
    '```jsonx\n' + BODY + '\n```',
    '```\njson ' + BODY + '\n```',
    '',
    'not json at all',
  ];

  it('agrees on every hand-picked shape, success and failure alike', () => {
    for (const input of CASES) {
      expect(parses(input), JSON.stringify(input)).toBe(oracle(input));
    }
  });

  it('agrees on 2000 random fence-shaped strings', () => {
    const alphabet = ['`', ' ', '\n', '\t', 'j', 's', 'o', 'n', 'x'] as const;
    for (let seed = 1; seed <= 2000; seed++) {
      const noise = fuzz(seed, alphabet, 14);
      for (const input of [noise, noise + BODY + '```', '```' + noise + BODY + '```']) {
        expect(parses(input), `seed ${seed}: ${JSON.stringify(input)}`).toBe(oracle(input));
      }
    }
  });

  it('is linear on an opened fence that never closes', () => {
    // The original gave back one whitespace character at a time and rescanned
    // the remainder for a closing fence on each step.
    const input = '```' + ' '.repeat(200000);
    const started = performance.now();
    expect(parses(input)).toBe('threw');
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('stateBaseName is exactly the regex it replaced', () => {
  const CASES = [
    '', 'active', 'active (filled)', 'Active (Filled)', 'active(filled)',
    'active  (filled)  ', '(filled)', '()', 'a()', 'a ()', 'a)', ')(x)',
    // The one that defeats a naive right-to-left scan: `[^)]*` may contain
    // `(`, and the leftmost start wins, so this strips from the FIRST `(`.
    'a ((x)', 'a (((x)', '((x)', 'a ((x) ', 'a (x) (y)', 'a (x)(y)',
    'a (x))', 'a )(x)', 'hover (mouse)', 'disabled (soft) ',
    'a (x) trailing', 'no parens here', '   ', '(', ')', '(()',
    'a\t(x)\t', 'a\n(x)\n', 'a (\nx)',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(stateBaseName(input), JSON.stringify(input)).toBe(oldStateBaseName(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = ['(', ')', ' ', ' ', '\t', 'a', 'b', 'x'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 20);
      expect(stateBaseName(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldStateBaseName(input));
    }
  });

  it('is linear on a long run of open parens that never closes', () => {
    const input = '('.repeat(200000) + 'x';
    const started = performance.now();
    expect(stateBaseName(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('is linear on a long whitespace run before an unmatched paren', () => {
    const input = 'a' + ' '.repeat(200000) + '(x';
    const started = performance.now();
    expect(stateBaseName(input)).toBe(oldStateBaseNameFast(input));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

/** The old regex cannot be run on the 200k inputs above (that is the bug), so
 *  the expected value for those is stated directly: neither input ends in `)`,
 *  so the pattern does not match and the answer is the lowercased trim. */
function oldStateBaseNameFast(v: string): string {
  return v.trim().toLowerCase();
}

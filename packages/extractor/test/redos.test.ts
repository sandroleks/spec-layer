/**
 * redos.test.ts — the regexes CodeQL flagged as `js/polynomial-redos` (four in
 * PR #56, two more in the v1 prose upgrade), replaced by linear scans and
 * pinned against the regexes they replaced.
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
 * every doubling, so anything still backtracking blows a 5-second budget at
 * n = 200k long before a linear scan notices. Each timed case retries twice,
 * because a loaded CI runner can stall a linear scan past the budget once
 * without telling us anything about the regex; a real quadratic fails all
 * three attempts.
 */
import { describe, it, expect } from 'vitest';
import { cleanPartName } from '../src/naming';
import { fencedBlock } from '../src/prose/prompt';
import { stateBaseName } from '../src/statesMatrix';
import { slugify } from '../src/componentSlugs';
import { headingText, normalizeDashes, variantBullet } from '../src/prose/v2';
import { collapseLineBreaks } from '../src/prose/promptV2';
import { collapseDashes } from '../src/prose/foundationPrompt';

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
    '  a  ', ' # ', 'a#\u2028', '# a #', 'a#b', '#'.repeat(20),
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

  it('is linear on a long run of hashes that does not end the string', { retry: 2 }, () => {
    // The original's worst case: `#+` retried from every start position.
    // 40k hashes measured 6.7 seconds.
    const input = '#'.repeat(200000) + 'x';
    const started = performance.now();
    expect(cleanPartName(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('prose dash normalization is exactly the regexes it replaced', () => {
  /** The shipped cleaner itself: every v2 string field runs through it. */
  const normalized = (value: string): string => normalizeDashes(value);

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

  it('is linear on a long whitespace run that never reaches a dash', { retry: 2 }, () => {
    // The en-dash rule's worst case. 40k spaces measured 2.5 seconds.
    const input = ' '.repeat(200000) + '–x';
    const started = performance.now();
    expect(normalized(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('fence extraction is exactly the regex it replaced', () => {
  const BODY = '{"overview":{"lede":"D","body":[]}}';

  /** `fencedBlock` is exported now, so the equivalence is pinned directly on
   *  the extracted span rather than through whatever the JSON parse made of
   *  it: what the old regex captured, position for position. */
  const oracle = oldFencedBlock;

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
    '```json\n' + BODY + '\n```\n```json\n{"overview":{"lede":"OTHER","body":[]}}\n```',
    // "json" that is not the language tag.
    '```jsonx\n' + BODY + '\n```',
    '```\njson ' + BODY + '\n```',
    '',
    'not json at all',
  ];

  it('agrees on every hand-picked shape, success and failure alike', () => {
    for (const input of CASES) {
      expect(fencedBlock(input), JSON.stringify(input)).toBe(oracle(input));
    }
  });

  it('agrees on 2000 random fence-shaped strings', () => {
    const alphabet = ['`', ' ', '\n', '\t', 'j', 's', 'o', 'n', 'x'] as const;
    for (let seed = 1; seed <= 2000; seed++) {
      const noise = fuzz(seed, alphabet, 14);
      for (const input of [noise, noise + BODY + '```', '```' + noise + BODY + '```']) {
        expect(fencedBlock(input), `seed ${seed}: ${JSON.stringify(input)}`).toBe(oracle(input));
      }
    }
  });

  it('is linear on an opened fence that never closes', { retry: 2 }, () => {
    // The original gave back one whitespace character at a time and rescanned
    // the remainder for a closing fence on each step.
    const input = '```' + ' '.repeat(200000);
    const started = performance.now();
    expect(fencedBlock(input)).toBeNull();
    expect(performance.now() - started).toBeLessThan(5000);
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

  it('is linear on a long run of open parens that never closes', { retry: 2 }, () => {
    const input = '('.repeat(200000) + 'x';
    const started = performance.now();
    expect(stateBaseName(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('is linear on a long whitespace run before an unmatched paren', { retry: 2 }, () => {
    const input = 'a' + ' '.repeat(200000) + '(x';
    const started = performance.now();
    expect(stateBaseName(input)).toBe(oldStateBaseNameFast(input));
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

/** The old regex cannot be run on the 200k inputs above (that is the bug), so
 *  the expected value for those is stated directly: neither input ends in `)`,
 *  so the pattern does not match and the answer is the lowercased trim. */
function oldStateBaseNameFast(v: string): string {
  return v.trim().toLowerCase();
}

describe('slugify is exactly the regex it replaced', () => {
  // A slug decides the filename every pull and every downloaded snapshot
  // writes, so a single disagreement renames a file in a user's repository on
  // their next pull. The old expression is the oracle rather than a comment.
  const CASES = [
    '', '-', '--', '---', 'a', '-a', 'a-', '-a-', '--a--', 'a--b',
    'Button', 'Button Primary', '  Button  ', 'Card / Header', '///',
    'a/b', 'A/B/C', '2', '-2-', 'icon#2', '  ', '\t', '\n', '_', '__',
    'Émoji Ünicode', '日本語', 'a_b', 'a.b', 'a  b', 'a---b', 'a-_-b',
    '-'.repeat(20), 'a' + '-'.repeat(20), '-'.repeat(20) + 'a',
    '-'.repeat(20) + 'a' + '-'.repeat(20), '!@#$%^&*()',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(slugify(input), JSON.stringify(input)).toBe(oldSlugify(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = ['-', ' ', '_', '/', 'a', 'B', '2', '.', '#'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 24);
      expect(slugify(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldSlugify(input));
    }
  });

  it('is linear on a long run of separators', { retry: 2 }, () => {
    // The original's worst case: `-+$` retried from every position in the run.
    // The collapse ahead of it means callers cannot reach this today, which is
    // exactly why the guarantee should not rest on the collapse.
    const input = '/'.repeat(200000) + 'x';
    const started = performance.now();
    expect(slugify(input)).toBe('x');
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

/** `slugify` as it was, before the trim became a scan. */
function oldSlugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

// --- The two v1-upgrade line matchers (CodeQL alerts 65 and 66) -------------

/** The variants-guide bullet regex as `upgradeProseV1` ran it, on a trimmed
 *  line. `\s*:?\s*(.*)` could split one run of spaces three ways, so a failed
 *  `$` retried every split: 66ms at 500 spaces, 511ms at 1000, 4163ms at
 *  2000, eight times per doubling. */
const oldVariantBullet = (line: string): { name: string; guidance: string } | null => {
  const m = /^[-*]\s+\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(line);
  return m ? { name: m[1].trim(), guidance: m[2].trim() } : null;
};

/** The heading regex as `upgradeProseV1` ran it, on a trimmed line. `\s+` and
 *  `.+` both take a space, so a failed `$` retried every split of the run:
 *  38ms at 5k spaces, 150ms at 10k, 671ms at 20k. */
const oldHeadingText = (line: string): string | null => {
  const m = /^#{1,6}\s+(.+)$/.exec(line);
  return m ? m[1] : null;
};

describe('variantBullet is exactly the regex it replaced', () => {
  // The shapes that decide the answer: where the bold run ends, whether a
  // colon follows, how much whitespace sits on either side of it, and the
  // characters `.` refuses (`\r`, `\n`, U+2028) placed before and after the
  // first non-space character of the guidance, which is what turns a match
  // into a failure for the old pattern.
  const CASES = [
    '', '-', '- ', '- **', '- **a', '- **a*', '- **a**', '* **a**', '-**a**',
    '- **a**:', '- **a** :', '- **a**: b', '- **a** : b', '- **a**:b',
    '- **a**  :  b c', '- **a**::b', '- **a**: : b', '- **a** b', '- **a**\tb',
    '- **a b**: c d', '- ****: b', '- **a**b**c**', '- **a** **b**',
    '- **a**\r', '- **a** \r', '- **a**\rb', '- **a** \r b', '- **a**: \r b',
    '- **a** b\rc', '- **a**: b\rc', '- **a**\nb', '- **a** b\nc',
    '- **a**\u2028b', '- **a** b\u2028c', '- **a**:\u2029b',
    '+ **a**: b', 'a - **b**: c', ' - **a**: b', '- **a**: b ',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(variantBullet(input), JSON.stringify(input)).toEqual(oldVariantBullet(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = ['-', '*', '*', ' ', ' ', '\t', ':', 'a', 'b', '\r', '\u2028'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 24);
      expect(variantBullet(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toEqual(oldVariantBullet(input));
    }
  });

  it('is linear on a long run of spaces before a line terminator', { retry: 2 }, () => {
    // The old pattern cannot run on this (that is the bug); the expected
    // answer is stated directly: `\r` after `x` is where `(.*)$` fails, so the
    // line is not a bullet.
    const input = '* **)**' + ' '.repeat(200000) + 'x\ry';
    const started = performance.now();
    expect(variantBullet(input)).toBeNull();
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('headingText is exactly the regex it replaced', () => {
  // `upgradeProseV1` trims each line before either pattern sees it, so trimmed
  // lines are the whole input space, and the fuzz trims for the same reason.
  // On an untrimmed `#` followed only by whitespace the old regex backtracked
  // into capturing one space; no caller can reach that.
  const CASES = [
    '', '#', '##', '######', '#######', '#x', '# x', '#\tx', '## x y', '###### x',
    '####### x', '#  x', '# #', '# x\ry', '#  \r  x', '#\u2028x', '# x\u2028y',
    '# x\ny', '# Keyboard', '# keyboard shortcuts', 'x # y', '#'.repeat(20) + ' x',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(headingText(input), JSON.stringify(input)).toBe(oldHeadingText(input));
    }
  });

  it('agrees on 4000 random trimmed strings over the alphabet that matters', () => {
    const alphabet = ['#', '#', ' ', ' ', '\t', '\r', '\u2028', 'a', 'x'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 20).trim();
      expect(headingText(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldHeadingText(input));
    }
  });

  it('is linear on a long run of spaces before a line terminator', { retry: 2 }, () => {
    const input = '#' + ' '.repeat(200000) + 'x\ry';
    const started = performance.now();
    expect(headingText(input)).toBeNull();
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

// --- The two Plan 2 prompt-builder regexes (CodeQL alert 67 and its twin) ---

/** The v9 builder's description collapse as it was. Both `\s*` overlap the
 *  `\n` they surround, so a run of spaces with no line break retries the whole
 *  run from every position inside it. Runs over the designer's description. */
const oldCollapseLineBreaks = (text: string): string => text.replace(/\s*\n\s*/g, ' ');

/** The foundation group parser's dash rule as it was. Same shape with a dash
 *  in the middle; runs over model output. */
const oldCollapseDashes = (value: string): string => value.replace(/\s*[—–]\s*/g, ', ');

describe('collapseLineBreaks is exactly the regex it replaced', () => {
  // Runs with and without a line break, runs that mix every `\s` character,
  // several breaks in one run, breaks at either end, and no whitespace at all.
  const CASES = [
    '', 'a', ' ', '\n', 'a b', 'a\nb', 'a \n b', 'a  \n\n  b', 'a\n\nb', 'a \t\n\t b',
    'a\r\nb', 'a \r\n b', 'a\rb', 'a \r b', '\na', 'a\n', ' \n a \n ', 'a b', 'a  \n b',
    'a   b', 'a\t\tb', 'a\n b\n c', 'a\n\n\n', '\n\n\na', 'a \n b   c \n d',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(collapseLineBreaks(input), JSON.stringify(input)).toBe(oldCollapseLineBreaks(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = [' ', ' ', '\t', '\n', '\n', '\r', 'a', 'b'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 24);
      expect(collapseLineBreaks(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldCollapseLineBreaks(input));
    }
  });

  it('is linear on a long run of spaces that never reaches a line break', { retry: 2 }, () => {
    const input = 'a' + ' '.repeat(200000) + 'b';
    const started = performance.now();
    expect(collapseLineBreaks(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('collapseDashes is exactly the regex it replaced', () => {
  // Both dashes, whitespace of every kind on either side or neither, adjacent
  // dashes (the second one starts where the first match ended), a dash at
  // either end, and a hyphen, which is not a dash.
  const CASES = [
    '', 'a', '—', '–', 'a—b', 'a — b', 'a  —  b', 'a–b', 'a – b', 'a\n—\nb', 'a \t– \t b',
    'a — — b', 'a——b', 'a –— b', '—a', 'a—', ' — ', 'a - b', '3-5', 'a — b – c',
    'a — b', 'a\r\n—\r\nb', 'one—two–three',
  ];

  it('agrees on every hand-picked shape', () => {
    for (const input of CASES) {
      expect(collapseDashes(input), JSON.stringify(input)).toBe(oldCollapseDashes(input));
    }
  });

  it('agrees on 4000 random strings over the alphabet that matters', () => {
    const alphabet = [' ', ' ', '\t', '\n', '—', '–', 'a', 'b', '-'] as const;
    for (let seed = 1; seed <= 4000; seed++) {
      const input = fuzz(seed, alphabet, 20);
      expect(collapseDashes(input), `seed ${seed}: ${JSON.stringify(input)}`)
        .toBe(oldCollapseDashes(input));
    }
  });

  it('is linear on a long run of spaces that never reaches a dash', { retry: 2 }, () => {
    const input = 'a' + ' '.repeat(200000) + 'b';
    const started = performance.now();
    expect(collapseDashes(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

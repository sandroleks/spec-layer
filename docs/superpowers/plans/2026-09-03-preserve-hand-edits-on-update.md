# Preserve Hand Edits on Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Library Update rebuilds the generated parts of a component doc from the live component while keeping the writing sections exactly as they read on the canvas, without calling the AI.

**Architecture:** The renderer tags every editorial node with pluginData (a slot name, and a line kind inside prose blocks). A new Figma-free module `canvasProse.ts` reads those tags back into a `ProseDrafts` overlay and merges it over the stored prose blob. The main thread hands that merged prose to the UI with the source snapshot, and the Update path builds from it instead of regenerating. The self-edit hash shrinks to the generated lane so only edits Update would actually lose count as "Manually edited".

**Tech Stack:** TypeScript, Vitest, Figma Plugin API (main thread), vanilla DOM iframe UI. Spec: `docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md`.

## Global Constraints

- Node >= 22, npm workspaces. Run tests with `npx vitest run <file>` from the repo root.
- The plugin main thread has no browser globals (`TextEncoder`, `window`, `document`). `canvasProse.ts` is imported by `main.ts`, so it may use only ECMAScript built-ins. `npm run check:sandbox` verifies this after `npm run build:plugin`.
- `packages/extractor` stays Figma-free. Nothing in this plan touches it.
- Plugin UI copy: sentence case, second person, no em dashes, no hype. See `docs/plugin-voice-and-copy.md`.
- Never fabricate: an absent value is absent or null, never invented.
- `EXTRACTOR_VERSION` stays `'2'`. This plan changes rendering structure, not extraction output.
- Commits: single-line conventional, lowercase, scoped. End each commit message with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line after a blank line.
- Do not commit `docs/strategy/2026-09-02-design-conformance-pivot.md`. It is an unrelated untracked file. Always `git add` explicit paths.
- Before the final commit run `npm run check` and read its exit status directly.

---

## File map

| File | Responsibility |
|---|---|
| Create `packages/plugin/src/canvasProse.ts` | Tag constants, `ProseNodeLike`, `readCanvasProse`, `mergeProse`, `collectGeneratedText`, `textToMarkdown`. Pure, Figma-free. |
| Create `packages/plugin/test/canvasProse.test.ts` | Unit tests with hand-built node objects. |
| Create `packages/plugin/test/docFrameProse.test.ts` | Build a doc with the fake Figma, read it back, assert the round trip. |
| Modify `packages/plugin/test/fakeFigma.ts` | pluginData on every fake node, `type` on frames and sections, range fonts and `getStyledTextSegments` on fake text, `remove()`. |
| Modify `packages/plugin/src/docFrame.ts` | Tag slots and lines while rendering. |
| Modify `packages/plugin/src/ui/docModel.ts` | Treat empty prose strings and an empty do/don't list as placeholders. |
| Modify `packages/plugin/src/main.ts` | Generated-lane self hash; merged prose on `docSource`, `docProse`, `publishSources`. |
| Modify `packages/plugin/src/messages.ts` | `docSource` carries `prose`. |
| Modify `packages/plugin/src/ui/actions.ts` | `DocSource.prose`; `updateFromSource` builds from it and never calls the AI. |
| Modify `packages/plugin/src/ui/ui-vnext.ts` | Pass `msg.prose` through; new confirm copy. |
| Modify `packages/plugin/src/docLink.ts` | Comment on `selfHash` describes the generated lane. |
| Modify `CHANGELOG.md`, `docs/plugin-knowledge-map.md`, `packages/plugin/TESTING.md`, `docs/feature-backlog-2026-07.md` | Record the behaviour change. |

---

### Task 1: `canvasProse.ts` read-back and merge

**Files:**
- Create: `packages/plugin/src/canvasProse.ts`
- Test: `packages/plugin/test/canvasProse.test.ts`

**Interfaces:**
- Consumes: `ProseDrafts`, `AnatomyPartProse` from `@spec-layer/extractor`.
- Produces (used by Tasks 2, 4):
  - `SLOT_KEY = 'specLayerSlot'`, `SLOT_PART_KEY = 'specLayerSlotKey'`, `LINE_KEY = 'specLayerLine'`
  - `type ProseSlot`, `type LineKind`, `PLACEHOLDER_TEXT = 'To be written.'`
  - `interface ProseNodeLike`
  - `type CanvasProse = Partial<ProseDrafts>`
  - `readCanvasProse(root: ProseNodeLike): CanvasProse`
  - `mergeProse(stored: ProseDrafts | null, canvas: CanvasProse): ProseDrafts | null`
  - `collectGeneratedText(root: ProseNodeLike): string[]`
  - `textToMarkdown(node: ProseNodeLike): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin/test/canvasProse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ProseDrafts } from '@spec-layer/extractor';
import {
  SLOT_KEY, SLOT_PART_KEY, LINE_KEY, PLACEHOLDER_TEXT,
  readCanvasProse, mergeProse, collectGeneratedText, textToMarkdown,
  type ProseNodeLike,
} from '../src/canvasProse';

// --- node builders ----------------------------------------------------------

type Font = { family: string; style: string };
const REGULAR: Font = { family: 'Inter', style: 'Regular' };
const BOLD: Font = { family: 'Inter', style: 'Bold' };

interface Seg { characters: string; fontName: Font }

function text(chars: string, opts: { segments?: Seg[]; data?: Record<string, string> } = {}): ProseNodeLike {
  const data = opts.data ?? {};
  return {
    type: 'TEXT',
    characters: chars,
    getPluginData: (k: string) => data[k] ?? '',
    ...(opts.segments
      ? { getStyledTextSegments: () => opts.segments as Seg[] }
      : {}),
  };
}

function frame(children: ProseNodeLike[], data: Record<string, string> = {}, type = 'FRAME'): ProseNodeLike {
  return { type, children, getPluginData: (k: string) => data[k] ?? '' };
}

const slot = (name: string, extra: Record<string, string> = {}) => ({ [SLOT_KEY]: name, ...extra });
const line = (kind: string) => ({ [LINE_KEY]: kind });

/** A bullet row as makeBulletRow builds it: marker text, then content text. */
function bulletRow(content: string, segments?: Seg[]): ProseNodeLike {
  return frame([text('•'), text(content, { segments })], line('bullet'));
}

// --- textToMarkdown ---------------------------------------------------------

describe('textToMarkdown', () => {
  it('returns the characters when the node cannot report segments', () => {
    expect(textToMarkdown(text('Plain words'))).toBe('Plain words');
  });

  it('wraps bold segments in double asterisks', () => {
    const node = text('Keyboard: focusable', {
      segments: [
        { characters: 'Keyboard:', fontName: BOLD },
        { characters: ' focusable', fontName: REGULAR },
      ],
    });
    expect(textToMarkdown(node)).toBe('**Keyboard:** focusable');
  });

  it('does not wrap whitespace-only bold segments', () => {
    const node = text('a b', {
      segments: [
        { characters: 'a', fontName: REGULAR },
        { characters: ' ', fontName: BOLD },
        { characters: 'b', fontName: REGULAR },
      ],
    });
    expect(textToMarkdown(node)).toBe('a b');
  });
});

// --- readCanvasProse --------------------------------------------------------

describe('readCanvasProse', () => {
  it('reads nothing from an untagged section', () => {
    const section = frame([frame([text('Usage'), text('Some table cell')])], {}, 'SECTION');
    expect(readCanvasProse(section)).toEqual({});
  });

  it('reads a prose block back as markdown lines', () => {
    const block = frame([
      text('First paragraph.', { data: line('paragraph') }),
      frame([text('Mouse')], line('heading')),
      bulletRow('Click to activate', [
        { characters: 'Click', fontName: BOLD },
        { characters: ' to activate', fontName: REGULAR },
      ]),
      text('Second paragraph.', { data: line('paragraph') }),
    ], slot('accessibility'));
    expect(readCanvasProse(frame([block]))).toEqual({
      accessibility: 'First paragraph.\n### Mouse\n- **Click** to activate\nSecond paragraph.',
    });
  });

  it('skips the untouched placeholder so the slot reads as absent', () => {
    const block = frame([text(PLACEHOLDER_TEXT, { data: line('placeholder') })], slot('interactions'));
    expect(readCanvasProse(frame([block]))).toEqual({});
  });

  it('reads a placeholder that was typed over as a paragraph', () => {
    const block = frame([text('Tap once to open.', { data: line('placeholder') })], slot('interactions'));
    expect(readCanvasProse(frame([block]))).toEqual({ interactions: 'Tap once to open.' });
  });

  it('reads an untagged text node added inside a slot as a paragraph', () => {
    const block = frame([
      text('Generated line.', { data: line('paragraph') }),
      text('Added by the designer.'),
    ], slot('contentConsiderations'));
    expect(readCanvasProse(frame([block]))).toEqual({
      contentConsiderations: 'Generated line.\nAdded by the designer.',
    });
  });

  it('joins the header lead and the definition body, lead first', () => {
    const lead = text('A button.', { data: slot('definitionLead') });
    const body = frame([text('Use it for the main action.', { data: line('paragraph') })], slot('definition'));
    // Header sits in a different frame from the body, as on canvas.
    const section = frame([frame([lead]), frame([body])], {}, 'SECTION');
    expect(readCanvasProse(section)).toEqual({ definition: 'A button.\nUse it for the main action.' });
  });

  it('reads a lead with no body and a body with no lead', () => {
    const lead = text('A button.', { data: slot('definitionLead') });
    expect(readCanvasProse(frame([lead]))).toEqual({ definition: 'A button.' });
    const body = frame([text('Body only.', { data: line('paragraph') })], slot('definition'));
    expect(readCanvasProse(frame([body]))).toEqual({ definition: 'Body only.' });
  });

  it('reads dos and donts one row each, in order, including a duplicated row', () => {
    const dos = frame([bulletRow('Do A'), bulletRow('Do B'), bulletRow('Do B')], slot('dos'));
    const donts = frame([bulletRow("Don't C")], slot('donts'));
    expect(readCanvasProse(frame([dos, donts]))).toEqual({ dos: ['Do A', 'Do B', 'Do B'], donts: ["Don't C"] });
  });

  it('reads an emptied bullet container as an empty list, not as absent', () => {
    const donts = frame([], slot('donts'));
    expect(readCanvasProse(frame([donts]))).toEqual({ donts: [] });
  });

  it('reads a placeholder-only bullet container as absent', () => {
    const dos = frame([frame([text(PLACEHOLDER_TEXT)])], slot('dos'));
    expect(readCanvasProse(frame([dos]))).toEqual({});
  });

  it('reads a plain text node dropped into a bullet container as an item', () => {
    const dos = frame([bulletRow('Do A'), text('Do Z')], slot('dos'));
    expect(readCanvasProse(frame([dos]))).toEqual({ dos: ['Do A', 'Do Z'] });
  });

  it('reads the anatomy summary and variants summary', () => {
    const summary = text('Three parts.', { data: slot('anatomySummary') });
    const variants = frame([
      text('Two styles.', { data: line('paragraph') }),
      bulletRow('Filled for the main action', [
        { characters: 'Filled', fontName: BOLD },
        { characters: ' for the main action', fontName: REGULAR },
      ]),
    ], slot('variantsSummary'));
    expect(readCanvasProse(frame([summary, variants]))).toEqual({
      anatomySummary: 'Three parts.',
      variantsSummary: 'Two styles.\n- **Filled** for the main action',
    });
  });

  it('reads anatomy part descriptions by tag name, splitting at the first colon', () => {
    const rows = frame([
      frame([text('1'), text('Label: The visible text.')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Label' })),
      frame([text('2'), text('Icon  ·  component')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Icon' })),
      frame([text('3'), text('Badge: Count: unread items')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Badge' })),
    ]);
    expect(readCanvasProse(frame([rows]))).toEqual({
      anatomyParts: [
        { name: 'Label', description: 'The visible text.' },
        { name: 'Badge', description: 'Count: unread items' },
      ],
    });
  });

  it('reads anatomy rows with every description removed as an empty list', () => {
    const rows = frame([
      frame([text('1'), text('Label')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Label' })),
    ]);
    expect(readCanvasProse(frame([rows]))).toEqual({ anatomyParts: [] });
  });

  it('never descends into component instances', () => {
    const inst = frame([frame([text('Mirror')], slot('definition'))], {}, 'INSTANCE');
    expect(readCanvasProse(frame([inst]))).toEqual({});
  });

  it('ignores a slot name it does not know', () => {
    const block = frame([text('x')], slot('somethingNew'));
    expect(readCanvasProse(frame([block]))).toEqual({});
  });
});

// --- mergeProse -------------------------------------------------------------

describe('mergeProse', () => {
  const stored: ProseDrafts = {
    definition: 'Stored definition.', accessibility: 'Stored a11y.',
    dos: ['Stored do'], donts: ['Stored dont'],
    interactions: 'Stored interactions.', designConsiderations: 'Stored design.',
    anatomyParts: [{ name: 'Label', description: 'Stored label.' }],
  };

  it('returns null when neither side has anything', () => {
    expect(mergeProse(null, {})).toBeNull();
  });

  it('returns the stored prose unchanged when the canvas shows nothing', () => {
    expect(mergeProse(stored, {})).toEqual(stored);
  });

  it('lets the canvas win per field and keeps stored fields the canvas does not show', () => {
    const merged = mergeProse(stored, { definition: 'Canvas definition.', dos: [], anatomyParts: [] });
    expect(merged).toEqual({
      ...stored,
      definition: 'Canvas definition.',
      dos: [],
      anatomyParts: [],
    });
  });

  it('fills required fields with empty values when only the canvas has content', () => {
    expect(mergeProse(null, { interactions: 'Tap.' })).toEqual({
      definition: '', accessibility: '', dos: [], donts: [], interactions: 'Tap.',
    });
  });

  it('does not add optional keys that neither side has', () => {
    const merged = mergeProse(null, { definition: 'Only this.' });
    expect(merged).toEqual({ definition: 'Only this.', accessibility: '', dos: [], donts: [] });
    expect(merged && 'variantsSummary' in merged).toBe(false);
  });
});

// --- collectGeneratedText ---------------------------------------------------

describe('collectGeneratedText', () => {
  it('collects every text outside slots and skips instances', () => {
    const section = frame([
      text('Heading'),
      frame([text('Cell A'), text('Cell B')]),
      frame([text('Mirror')], {}, 'INSTANCE'),
    ], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['Heading', 'Cell A', 'Cell B']);
  });

  it('skips a slot container and everything under it', () => {
    const section = frame([
      text('Heading'),
      frame([text('Editorial line')], slot('accessibility')),
      text('Lead', { data: slot('definitionLead') }),
      text('Footer'),
    ], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['Heading', 'Footer']);
  });

  it('collects all text from an untagged legacy section', () => {
    const section = frame([text('A'), frame([text('B')])], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/canvasProse.test.ts`
Expected: FAIL, cannot resolve `../src/canvasProse`.

- [ ] **Step 3: Write the module**

Create `packages/plugin/src/canvasProse.ts`:

```ts
/**
 * canvasProse.ts — read the editorial lane of a component doc back off the
 * canvas.
 *
 * A doc has two lanes. The generated lane (tables, matrices, chrome) is
 * derived from the component and is always rebuilt. The editorial lane (the
 * writing sections) is authored, first by the AI or a placeholder and then by
 * whoever edits the canvas, so the canvas is its source of truth. docFrame.ts
 * tags editorial nodes with pluginData at render time; this module turns
 * those tags back into a ProseDrafts overlay so an Update can rebuild the
 * generated lane without losing a word anyone wrote.
 *
 * No Figma globals. The main thread passes real nodes; tests pass plain
 * objects. This module is imported by main.ts, which runs in Figma's bare
 * sandbox realm, so it may use only ECMAScript built-ins.
 */
import type { ProseDrafts, AnatomyPartProse } from '@spec-layer/extractor';

/** pluginData key naming which editorial slot a node (and its subtree) fills. */
export const SLOT_KEY = 'specLayerSlot';
/** pluginData key on an `anatomyPart` row holding the part's name. */
export const SLOT_PART_KEY = 'specLayerSlotKey';
/** pluginData key on a node inside a prose slot saying what kind of line it is. */
export const LINE_KEY = 'specLayerLine';

export type ProseSlot =
  | 'definitionLead' | 'definition' | 'accessibility' | 'interactions'
  | 'contentConsiderations' | 'dos' | 'donts' | 'variantsSummary'
  | 'anatomySummary' | 'anatomyPart';

export type LineKind = 'paragraph' | 'heading' | 'bullet' | 'placeholder';

/** The placeholder as it reads on canvas: docModel's `_To be written._` with
 *  the emphasis markers stripped by the renderer. */
export const PLACEHOLDER_TEXT = 'To be written.';

/** The slice of a Figma node this module reads. Structural so tests can pass
 *  plain objects and the main thread can pass SceneNodes (cast, since the
 *  typings' overloaded generic `getStyledTextSegments` is not assignable). */
export interface ProseNodeLike {
  type: string;
  characters?: string;
  children?: readonly ProseNodeLike[];
  getPluginData(key: string): string;
  getStyledTextSegments?(fields: ['fontName']):
    readonly { characters: string; fontName: { family: string; style: string } }[];
}

/** Every field optional: absent means the canvas does not show that slot, or
 *  shows only the untouched placeholder. */
export type CanvasProse = Partial<ProseDrafts>;

type BlockSlot = 'definition' | 'accessibility' | 'interactions' | 'contentConsiderations' | 'variantsSummary';
const BLOCK_SLOTS: ReadonlySet<string> = new Set<BlockSlot>([
  'definition', 'accessibility', 'interactions', 'contentConsiderations', 'variantsSummary',
]);

/**
 * A text node's characters as markdown: bold segments wrapped in `**`, which
 * is exactly the markup parseRuns understands, so a rebuilt node bolds the
 * same characters. Other styling is not carried.
 */
export function textToMarkdown(node: ProseNodeLike): string {
  const chars = node.characters ?? '';
  if (!node.getStyledTextSegments) return chars;
  let segments: ReturnType<NonNullable<ProseNodeLike['getStyledTextSegments']>>;
  try {
    segments = node.getStyledTextSegments(['fontName']);
  } catch {
    return chars;
  }
  return segments
    .map((s) => (s.fontName.style === 'Bold' && s.characters.trim() !== '' ? `**${s.characters}**` : s.characters))
    .join('');
}

function allTexts(node: ProseNodeLike, out: ProseNodeLike[] = []): ProseNodeLike[] {
  if (node.type === 'TEXT') out.push(node);
  for (const c of node.children ?? []) allTexts(c, out);
  return out;
}

/** One markdown line per child of a prose slot container. */
function readLines(container: ProseNodeLike): string[] {
  const lines: string[] = [];
  for (const child of container.children ?? []) {
    const kind = child.getPluginData(LINE_KEY);
    const texts = allTexts(child);
    if (texts.length === 0) continue;
    if (kind === 'heading') {
      lines.push(`### ${texts[0].characters ?? ''}`);
      continue;
    }
    if (kind === 'bullet') {
      lines.push(`- ${textToMarkdown(texts[texts.length - 1])}`);
      continue;
    }
    const md = textToMarkdown(texts[0]);
    if (kind === 'placeholder' && md.trim() === PLACEHOLDER_TEXT) continue;
    if (md.trim() === '') continue;
    lines.push(md);
  }
  return lines;
}

/**
 * One item per row of a dos/donts container. The marker node is skipped and
 * the content node is read. Returns null when the container holds only the
 * placeholder, so the slot reads as absent rather than as an empty list; an
 * empty container is a real empty list, since someone deleted every row.
 */
function readBullets(container: ProseNodeLike): string[] | null {
  const items: string[] = [];
  let sawPlaceholder = false;
  for (const row of container.children ?? []) {
    const texts = allTexts(row);
    if (texts.length === 0) continue;
    const md = textToMarkdown(texts[texts.length - 1]);
    if (texts.length === 1 && md.trim() === PLACEHOLDER_TEXT) {
      sawPlaceholder = true;
      continue;
    }
    if (md.trim() === '') continue;
    items.push(md);
  }
  return items.length === 0 && sawPlaceholder ? null : items;
}

/** Walk a Section and collect what its editorial slots currently say. */
export function readCanvasProse(root: ProseNodeLike): CanvasProse {
  const blocks = new Map<BlockSlot, string[]>();
  let lead: string | undefined;
  let anatomySummary: string | undefined;
  let dos: string[] | undefined;
  let donts: string[] | undefined;
  let parts: AnatomyPartProse[] | undefined;

  const visit = (node: ProseNodeLike): void => {
    // Instance text mirrors the source component; it is never editorial.
    if (node.type === 'INSTANCE') return;
    const slot = node.getPluginData(SLOT_KEY);
    if (slot === '') {
      for (const c of node.children ?? []) visit(c);
      return;
    }
    if (BLOCK_SLOTS.has(slot)) {
      blocks.set(slot as BlockSlot, readLines(node));
      return;
    }
    switch (slot) {
      case 'definitionLead':
        lead = textToMarkdown(node);
        return;
      case 'anatomySummary':
        anatomySummary = textToMarkdown(node);
        return;
      case 'dos':
        dos = readBullets(node) ?? undefined;
        return;
      case 'donts':
        donts = readBullets(node) ?? undefined;
        return;
      case 'anatomyPart': {
        // Seeing any row means the anatomy legend is on canvas, so an empty
        // list is a real answer: every description was removed.
        if (!parts) parts = [];
        const name = node.getPluginData(SLOT_PART_KEY);
        const texts = allTexts(node);
        const chars = texts.length ? (texts[texts.length - 1].characters ?? '') : '';
        const i = chars.indexOf(': ');
        if (!name || i < 0) return;
        const description = chars.slice(i + 2).trim();
        if (description) parts.push({ name, description });
        return;
      }
      default:
        // A slot this build does not know (written by a newer plugin): leave
        // it alone rather than guess which field it belongs to.
        return;
    }
  };
  visit(root);

  const out: CanvasProse = {};
  const definitionLines = [...(lead && lead.trim() ? [lead] : []), ...(blocks.get('definition') ?? [])];
  if (definitionLines.length) out.definition = definitionLines.join('\n');
  for (const slot of ['accessibility', 'interactions', 'contentConsiderations', 'variantsSummary'] as const) {
    const lines = blocks.get(slot);
    if (lines && lines.length) out[slot] = lines.join('\n');
  }
  if (anatomySummary !== undefined && anatomySummary.trim()) out.anatomySummary = anatomySummary;
  if (dos) out.dos = dos;
  if (donts) out.donts = donts;
  if (parts) out.anatomyParts = parts;
  return out;
}

const OPTIONAL_KEYS = [
  'variantsSummary', 'anatomySummary', 'anatomyParts',
  'interactions', 'designConsiderations', 'contentConsiderations',
] as const;

/**
 * Canvas wins per field; stored fills whatever the canvas does not show. A
 * section the config does not render leaves no tags, so its stored text
 * survives. Null only when neither side has anything at all.
 */
export function mergeProse(stored: ProseDrafts | null, canvas: CanvasProse): ProseDrafts | null {
  if (!stored && Object.keys(canvas).length === 0) return null;
  const out: ProseDrafts = {
    definition: canvas.definition ?? stored?.definition ?? '',
    accessibility: canvas.accessibility ?? stored?.accessibility ?? '',
    dos: canvas.dos ?? stored?.dos ?? [],
    donts: canvas.donts ?? stored?.donts ?? [],
  };
  for (const key of OPTIONAL_KEYS) {
    const value = canvas[key] ?? stored?.[key];
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * The generated lane's text, in document order: every text node that is not
 * inside an editorial slot or a component instance. This is what selfHash
 * covers, so an edit here means "Update will replace this" and an edit in a
 * slot means nothing, because Update keeps it. A doc rendered before tagging
 * has no slots, so this returns all its text, matching its stored hash.
 */
export function collectGeneratedText(root: ProseNodeLike): string[] {
  const out: string[] = [];
  const visit = (n: ProseNodeLike): void => {
    if (n.type === 'INSTANCE') return;
    if (n.getPluginData(SLOT_KEY) !== '') return;
    if (n.type === 'TEXT') {
      out.push(n.characters ?? '');
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/canvasProse.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/canvasProse.ts packages/plugin/test/canvasProse.test.ts
git commit -m "feat(plugin): read editorial prose back from a doc's canvas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tag editorial nodes in the renderer, with a round-trip test

**Files:**
- Modify: `packages/plugin/test/fakeFigma.ts`
- Modify: `packages/plugin/src/docFrame.ts` (imports at top; `buildProse` ~151-193; `anatomyLegendRow` ~564-581; `buildSection` ~760-800; the `variantsMatrix` summary ~925-935; `buildHeader` ~974-990)
- Test: `packages/plugin/test/docFrameProse.test.ts`

**Interfaces:**
- Consumes from Task 1: `SLOT_KEY`, `SLOT_PART_KEY`, `LINE_KEY`, `ProseSlot`, `LineKind`, `readCanvasProse`, `mergeProse`, `ProseNodeLike`.
- Produces: tagged canvas structure that Task 4's main-thread read-back depends on. No new exports.

- [ ] **Step 1: Extend the fake Figma**

In `packages/plugin/test/fakeFigma.ts`, make these edits.

Add to `FakeFrame` (inside the class, after `fills: unknown = [];`):

```ts
  type = 'FRAME';
  pluginData: Record<string, string> = {};

  setPluginData(key: string, value: string): void {
    this.pluginData[key] = value;
  }

  getPluginData(key: string): string {
    return this.pluginData[key] ?? '';
  }

  /** Detaching a frame that was never appended is a no-op here, as in Figma. */
  remove(): void {}
```

Add to `FakeSection` (after `y = 0;`):

```ts
  type = 'SECTION';
  pluginData: Record<string, string> = {};

  setPluginData(key: string, value: string): void {
    this.pluginData[key] = value;
  }

  getPluginData(key: string): string {
    return this.pluginData[key] ?? '';
  }
```

Replace `fakeText()` with a class that models range fonts, since the
round trip depends on reading bold segments back:

```ts
interface FakeFont { family: string; style: string }

/**
 * A text node that remembers per-range fonts, enough for
 * getStyledTextSegments to report bold runs the way Figma does: one segment
 * per maximal run of identical style, in order.
 */
export class FakeText {
  type = 'TEXT';
  height = TEXT_H;
  characters = '';
  fontName: FakeFont = { family: 'Inter', style: 'Regular' };
  pluginData: Record<string, string> = {};
  private ranges: { start: number; end: number; font: FakeFont }[] = [];
  [k: string]: unknown;

  setPluginData(key: string, value: string): void {
    this.pluginData[key] = value;
  }

  getPluginData(key: string): string {
    return this.pluginData[key] ?? '';
  }

  setRangeFontName(start: number, end: number, font: FakeFont): void {
    this.ranges.push({ start, end, font });
  }

  getStyledTextSegments(_fields: ['fontName']): { characters: string; fontName: FakeFont; start: number; end: number }[] {
    const styles: FakeFont[] = Array.from(this.characters, () => this.fontName);
    for (const r of this.ranges) {
      for (let i = r.start; i < r.end && i < styles.length; i += 1) styles[i] = r.font;
    }
    const out: { characters: string; fontName: FakeFont; start: number; end: number }[] = [];
    let start = 0;
    for (let i = 1; i <= styles.length; i += 1) {
      const boundary = i === styles.length
        || styles[i].family !== styles[start].family || styles[i].style !== styles[start].style;
      if (!boundary) continue;
      out.push({ characters: this.characters.slice(start, i), fontName: styles[start], start, end: i });
      start = i;
    }
    return out;
  }

  remove(): void {}
}

function fakeText(): FakeText {
  return new FakeText();
}
```

`FakeFrame.textChars()` already reads `child.type === 'TEXT'` and `characters`, so it keeps working.

Run: `npx vitest run packages/plugin/test/foundationFrame.test.ts packages/plugin/test/frameKit.test.ts packages/plugin/test/brandHeader.test.ts`
Expected: PASS. These suites share the fake and must not change behaviour.

- [ ] **Step 2: Write the failing round-trip test**

Create `packages/plugin/test/docFrameProse.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IntermediateSpec, ProseDrafts, RefIdentity } from '@spec-layer/extractor';
import { installFakeFigma, uninstallFakeFigma, FakeSection } from './fakeFigma';
import { buildDocFrames } from '../src/docFrame';
import { buildDocModel, type SectionId } from '../src/ui/docModel';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import {
  readCanvasProse, mergeProse, collectGeneratedText, SLOT_KEY, type ProseNodeLike,
} from '../src/canvasProse';

const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [
    { name: 'Label', nested: false, id: '1:3', depth: 0, type: 'TEXT' },
    { name: 'Icon', nested: true, id: '1:4', depth: 0, type: 'INSTANCE', component: 'Icon' },
  ],
  anatomyComponentId: '1:2',
  props: [], variants: [], states: [],
  tokens: [{ part: 'Label', property: 'fill', ...ident('color/text'), conditions: {} }],
  rawValues: [], related: [], gaps: [], layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose: ProseDrafts = {
  definition: 'A button. Use it for the main action on a screen.',
  accessibility: '- **Keyboard:** focusable and activates on Enter\n### Screen readers\nThe label is announced.',
  dos: ['Keep labels short', 'Use one primary button'],
  donts: ['Stack two primary buttons'],
  interactions: 'Press to trigger the action.',
  contentConsiderations: 'Start with a verb.',
  anatomySummary: 'Two parts: a label and an optional icon.',
  anatomyParts: [{ name: 'Label', description: 'The visible text.' }],
};

const SECTIONS = new Set<SectionId>([
  'definition', 'accessibility', 'dosDonts', 'interactions', 'contentConsiderations', 'anatomy',
]);

async function build(p: ProseDrafts | null): Promise<FakeSection> {
  const model = buildDocModel(spec, p, SECTIONS, new Set(), { measureViews: [] });
  const section = await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null);
  return section as unknown as FakeSection;
}

const asNode = (s: FakeSection): ProseNodeLike => s as unknown as ProseNodeLike;

describe('docFrame editorial tags', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('reads every editorial slot back from a freshly built doc', async () => {
    const read = readCanvasProse(asNode(await build(prose)));
    expect(read).toEqual({
      // The lead sentence is lifted into the header, so the definition comes
      // back as lead + body on separate lines. Same words, same order.
      definition: 'A button.\nUse it for the main action on a screen.',
      accessibility: prose.accessibility,
      dos: prose.dos,
      donts: prose.donts,
      interactions: prose.interactions,
      contentConsiderations: prose.contentConsiderations,
      anatomySummary: prose.anatomySummary,
      anatomyParts: prose.anatomyParts,
    });
  });

  it('is a fixed point: building from the read-back and reading again changes nothing', async () => {
    const first = readCanvasProse(asNode(await build(prose)));
    const second = readCanvasProse(asNode(await build(mergeProse(null, first))));
    expect(second).toEqual(first);
  });

  it('reads nothing from a doc built without prose', async () => {
    expect(readCanvasProse(asNode(await build(null)))).toEqual({});
  });

  it('keeps editorial text out of the generated lane', async () => {
    const generated = collectGeneratedText(asNode(await build(prose)));
    const joined = generated.join('\n');
    expect(joined).toContain('Accessibility');           // a section heading, generated
    expect(joined).not.toContain('Keep labels short');   // a do, editorial
    expect(joined).not.toContain('The label is announced.');
    expect(joined).not.toContain('A button.');           // the header lead, editorial
  });

  it('tags the header lead and not the header title', async () => {
    const section = await build(prose);
    const tagged: string[] = [];
    const visit = (n: ProseNodeLike): void => {
      if (n.getPluginData(SLOT_KEY) === 'definitionLead') tagged.push(n.characters ?? '');
      for (const c of n.children ?? []) visit(c);
    };
    visit(asNode(section));
    expect(tagged).toEqual(['A button.']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/docFrameProse.test.ts`
Expected: FAIL. The first test gets `{}` because nothing is tagged yet. If the build itself throws on a missing fake member, add that member to `fakeFigma.ts` with the smallest honest behaviour and re-run before going on.

- [ ] **Step 4: Tag in `docFrame.ts`**

Add to the imports at the top:

```ts
import type { SectionId } from './ui/docModel';
import { SLOT_KEY, SLOT_PART_KEY, LINE_KEY, type ProseSlot, type LineKind } from './canvasProse';
```

Add, after the `CONTENT_WIDTH` declaration block:

```ts
// ---------------------------------------------------------------------------
// Editorial tags — see canvasProse.ts. Anything tagged with a slot is text
// the designer owns; an Update reads it back instead of regenerating it.
// ---------------------------------------------------------------------------

function tagSlot(node: SceneNode, slot: ProseSlot): void {
  node.setPluginData(SLOT_KEY, slot);
}

function tagLine(node: SceneNode, kind: LineKind): void {
  node.setPluginData(LINE_KEY, kind);
}

/** Which prose sections are editorial slots. Every `kind: 'prose'` section
 *  today is one; a future generated prose section would simply be absent. */
const PROSE_SLOT_BY_SECTION: Partial<Record<SectionId, ProseSlot>> = {
  definition: 'definition',
  accessibility: 'accessibility',
  interactions: 'interactions',
  contentConsiderations: 'contentConsiderations',
};

/** Render markdown into a tagged slot container. */
function buildProseSlot(text: string, slot: ProseSlot, spacing: number): FrameNode {
  const holder = vstack(spacing);
  tagSlot(holder, slot);
  for (const node of buildProse(text)) {
    holder.appendChild(node);
    (node as TextNode).layoutSizingHorizontal = 'FILL';
  }
  return holder;
}
```

In `buildProse`, tag each line as it is produced. The function becomes:

```ts
function buildProse(text: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;

    const placeholder = emphasisOnly(line);
    if (placeholder) {
      const node = makeText(placeholder, 'Regular', 15, palette.muted, 155);
      tagLine(node, 'placeholder');
      out.push(node);
      continue;
    }

    const subheading = headingLine(line);
    if (subheading !== null) {
      // "### Mouse" → a small subheading. Wrapped in a padded frame so it gets
      // extra separation from the bullet group above (body spacing is a flat 10).
      const wrap = vstack(0);
      wrap.paddingTop = 8;
      const node = makeText(subheading, 'Bold', 17, palette.heading, 130);
      node.fontName = headingFont('Bold');
      wrap.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
      node.textAutoResize = 'HEIGHT';
      tagLine(wrap, 'heading');
      out.push(wrap);
      continue;
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const runs = parseRuns(bulletMatch[1]);
      const plain = runs.map((r) => r.text).join('');
      const row = makeBulletRow({ runs, text: plain });
      tagLine(row, 'bullet');
      out.push(row);
    } else {
      const runs = parseRuns(line);
      const plain = runs.map((r) => r.text).join('');
      const node = makeText(plain, 'Regular', 15, palette.body, 155);
      applyBoldRuns(node, runs, 0);
      tagLine(node, 'paragraph');
      out.push(node);
    }
  }
  if (out.length === 0) {
    const empty = makeText('', 'Regular', 15, palette.body, 155);
    tagLine(empty, 'paragraph');
    out.push(empty);
  }
  return out;
}
```

In `anatomyLegendRow`, after `const row = hstack(12);` add:

```ts
  // The description is editorial; the tag carries the part name so a rebuilt
  // legend can find each description again even if the row text was edited.
  tagSlot(row, 'anatomyPart');
  row.setPluginData(SLOT_PART_KEY, part.name);
```

In `buildSection`, replace the `prose` and `bullets` branches:

```ts
  if (section.kind === 'prose') {
    const slot = PROSE_SLOT_BY_SECTION[section.id];
    if (slot) {
      const holder = buildProseSlot(section.text, slot, bodySpacing);
      body.appendChild(holder);
      holder.layoutSizingHorizontal = 'FILL';
    } else {
      for (const node of buildProse(section.text)) {
        body.appendChild(node);
        (node as TextNode).layoutSizingHorizontal = 'FILL';
      }
    }
  } else if (section.kind === 'bullets' && section.id === 'dosDonts') {
    // Dos and don'ts are two slots sharing one section. Rows are routed by
    // their marker; the placeholder (no marker) lands in `dos`, where the
    // read-back recognises it and reports the slot as absent.
    const dos = vstack(bodySpacing);
    const donts = vstack(bodySpacing);
    for (const b of section.items) {
      const row = makeBulletRow(b);
      const holder = b.text.startsWith('❌') ? donts : dos;
      holder.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
    }
    for (const [holder, slot] of [[dos, 'dos'], [donts, 'donts']] as const) {
      if (holder.children.length === 0) {
        holder.remove();
        continue;
      }
      tagSlot(holder, slot);
      body.appendChild(holder);
      holder.layoutSizingHorizontal = 'FILL';
    }
  } else if (section.kind === 'bullets') {
    for (const b of section.items) {
      const row = makeBulletRow(b);
      body.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
    }
  }
```

In the `anatomy` branch, tag the summary:

```ts
    if (section.summary) {
      const summary = makeText(section.summary, 'Regular', 15, palette.body, 155);
      tagSlot(summary, 'anatomySummary');
      body.appendChild(summary);
      summary.layoutSizingHorizontal = 'FILL';
      summary.textAutoResize = 'HEIGHT';
    }
```

In the `variantsMatrix` branch, replace the summary loop:

```ts
    if (section.summary) {
      const holder = buildProseSlot(section.summary, 'variantsSummary', 10);
      body.appendChild(holder);
      holder.layoutSizingHorizontal = 'FILL';
    }
```

In `buildHeader`, tag the subtitle node through the existing hook:

```ts
    styleSubtitle: runs
      ? (node) => {
          applyBoldRuns(node, runs, 0);
          // The lead is the first sentence of the Definition, lifted here.
          tagSlot(node, 'definitionLead');
        }
      : undefined,
```

- [ ] **Step 5: Run the round trip and the neighbouring suites**

Run: `npx vitest run packages/plugin/test/docFrameProse.test.ts packages/plugin/test/docModel.test.ts packages/plugin/test/foundationFrame.test.ts`
Expected: PASS.

If `definition` comes back with different line breaks than the test expects, the test's expectation is wrong, not the renderer: fix the expected string to match how `splitLead` splits the lead sentence, and keep the fixed-point test as the real guard.

- [ ] **Step 6: Typecheck, lint, build, sandbox scan**

Run: `npm run typecheck && npm run lint && npm run build:plugin && npm run check:sandbox`
Expected: all exit 0. The sandbox scan is what proves `canvasProse.ts` brought no browser global into `dist/main.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/docFrame.ts packages/plugin/test/fakeFigma.ts packages/plugin/test/docFrameProse.test.ts
git commit -m "feat(plugin): tag editorial nodes so a doc's prose can be read back

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Doc model treats empty prose as a placeholder

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts:282-313` (the `definition`, `accessibility`, `interactions`, `contentConsiderations`, `dosDonts` cases) and the `anatomy` summary (~344) and `variants` summary (~402)
- Test: `packages/plugin/test/docModel.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildDocModel` renders the placeholder for `''` and for an empty do/don't pair. Task 4 relies on this because `mergeProse` fills required fields with `''`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/docModel.test.ts`, inside a new `describe`:

```ts
describe('buildDocModel placeholders for merged prose', () => {
  const empty = { definition: '', accessibility: '', dos: [], donts: [] };

  it('renders the placeholder when a required prose field is an empty string', () => {
    const model = buildDocModel(spec, empty, new Set<SectionId>(['definition', 'accessibility']), new Set());
    const texts = model.sections.map((s) => (s.kind === 'prose' ? s.text : ''));
    expect(texts).toEqual(['_To be written._', '_To be written._']);
  });

  it('renders the placeholder when both dos and donts are empty', () => {
    const model = buildDocModel(spec, empty, new Set<SectionId>(['dosDonts']), new Set());
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') expect(block.items.map((b) => b.text)).toEqual(['To be written.']);
  });

  it('renders the placeholder for an empty optional prose field', () => {
    const model = buildDocModel(
      spec, { ...empty, interactions: '' }, new Set<SectionId>(['interactions']), new Set(),
    );
    const block = model.sections[0];
    if (block.kind === 'prose') expect(block.text).toBe('_To be written._');
  });

  it('drops an empty anatomy summary rather than rendering a blank line', () => {
    const model = buildDocModel(
      spec, { ...empty, anatomySummary: '' }, new Set<SectionId>(['anatomy']), new Set(),
    );
    const block = model.sections[0];
    if (block.kind === 'anatomy') expect(block.summary).toBeNull();
  });
});
```

Check the existing test file's `spec` has `anatomyComponentId`; if it does not, the anatomy case falls back to a bullets block and the last test must instead assert `block.kind === 'bullets'`. Read the fixture at the top of the file before deciding.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docModel.test.ts`
Expected: the new tests FAIL (an empty string is rendered as-is; empty items renders no bullets).

- [ ] **Step 3: Change the model**

In `buildSection` in `packages/plugin/src/ui/docModel.ts`:

```ts
    case 'definition': {
      return {
        id, heading: label, kind: 'prose',
        // `||`, not `??`: a merged prose object fills a field it has no text
        // for with '', and a blank section is a claim of emptiness while the
        // placeholder is an honest "nobody wrote this yet".
        text: prose?.definition || AI_PLACEHOLDER,
      };
    }

    case 'accessibility': {
      return {
        id, heading: label, kind: 'prose',
        text: prose?.accessibility || AI_PLACEHOLDER,
      };
    }

    case 'interactions': {
      return { id, heading: label, kind: 'prose', text: prose?.interactions || AI_PLACEHOLDER };
    }

    case 'contentConsiderations': {
      return { id, heading: label, kind: 'prose', text: prose?.contentConsiderations || AI_PLACEHOLDER };
    }

    case 'dosDonts': {
      const items: Bullet[] = prose
        ? [
            ...prose.dos.map((d) => makeBullet(`✅ ${d}`)),
            ...prose.donts.map((d) => makeBullet(`❌ ${d}`)),
          ]
        : [];
      return {
        id, heading: label, kind: 'bullets',
        items: items.length ? items : [makeBullet(AI_PLACEHOLDER)],
      };
    }
```

For the anatomy summary (currently `summary: prose?.anatomySummary ?? null`):

```ts
          summary: prose?.anatomySummary || null,
```

For the variants summary (currently `const summary = prose?.variantsSummary ?? null;`):

```ts
      const summary = prose?.variantsSummary || null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docFrameProse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts
git commit -m "fix(plugin): render the placeholder for empty prose fields

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Main thread: generated-lane hash and merged prose

**Files:**
- Modify: `packages/plugin/src/main.ts` (imports ~1-26; `collectText` ~380-395; call sites at ~720, ~813, ~1054, ~1219, ~1369; `requestDocProse` ~1323-1340; `requestDocSource` ~1342-1376; `requestPublishSources` ~1412)
- Modify: `packages/plugin/src/messages.ts:105` (the `docSource` message)
- Modify: `packages/plugin/src/docLink.ts:140` (the `selfHash` comment)

**Interfaces:**
- Consumes from Task 1: `readCanvasProse`, `mergeProse`, `collectGeneratedText`, `ProseNodeLike`.
- Produces: `docSource` message gains `prose: ProseDrafts | null`. Task 5 reads it.

`main.ts` is excluded from coverage and has no unit tests. The logic it calls is tested in Task 1; here the work is wiring, verified by typecheck, build, and the sandbox scan.

- [ ] **Step 1: Extend the `docSource` message**

In `packages/plugin/src/messages.ts`, replace the `docSource` line:

```ts
  /** `prose` is what the doc currently says in its writing sections: the
   *  canvas read back through its editorial tags, falling back to the stored
   *  DOC_PROSE_KEY blob for anything the canvas does not show. Update builds
   *  from this and never regenerates. */
  | { type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; fileName?: string; config: DocConfig; selfEdited: boolean; prose: ProseDrafts | null; intent: DocSourceIntent }
```

`ProseDrafts` is already imported in that file (it is used by `docProse`).

- [ ] **Step 2: Wire `main.ts`**

Add to the imports:

```ts
import { readCanvasProse, mergeProse, collectGeneratedText, type ProseNodeLike } from './canvasProse';
import type { ProseDrafts } from '@spec-layer/extractor';
```

(Merge the type import into the existing `@spec-layer/extractor` import block if the linter prefers one import per module.)

Replace `collectText` (the whole function and its comment) with:

```ts
/**
 * The generated lane's text: everything selfHash covers. Editorial slots are
 * skipped because an Update keeps them, so an edit there is not something the
 * user can lose. Instances are skipped because their text mirrors the source
 * component. See canvasProse.ts for the lane rule and its tests.
 */
function collectGeneratedLane(node: BaseNode): string[] {
  return collectGeneratedText(node as unknown as ProseNodeLike);
}

/**
 * The guidelines a doc currently carries: what its canvas says, with the
 * stored blob filling any slot the canvas does not render.
 */
function docProse(section: SectionNode): ProseDrafts | null {
  return mergeProse(
    parseProse(section.getPluginData(DOC_PROSE_KEY)),
    readCanvasProse(section as unknown as ProseNodeLike),
  );
}
```

Replace every `collectText(section)` call with `collectGeneratedLane(section)`. There are five: the `renderDocFrame` stamp (~720), the library scan (~813), the foundation bulk build (~1054), the foundation update (~1219), and `requestDocSource` (~1369). Search with:

```bash
grep -n "collectText" packages/plugin/src/main.ts
```

Expected after the edit: no matches.

In `requestDocProse`, change the reply:

```ts
      figma.ui.postMessage({
        type: 'docProse',
        docId: msg.docId,
        prose: section ? docProse(section) : null,
      } as MainToUi);
```

In `requestDocSource`, add `prose` to the reply:

```ts
        figma.ui.postMessage({
          type: 'docSource', docId: msg.docId, node, fileKey, fileName: figma.root.name,
          config: data.config, selfEdited, prose: docProse(section), intent: msg.intent,
        } as MainToUi);
```

In `requestPublishSources`, change the component entry:

```ts
            components.push({ docId, name: node.name, node, prose: docProse(section) });
```

- [ ] **Step 3: Update the `selfHash` comment in `docLink.ts`**

Replace line 140:

```ts
  /** Hash of the built Section's GENERATED text (hand-edit baseline). Text
   *  inside editorial slots is excluded: an Update reads those back and keeps
   *  them, so only an edit outside them is something Update would destroy.
   *  Docs rendered before slot tagging have no slots, so their hash covers
   *  all text, which is exactly what their stored value was computed over. */
  selfHash: string;
```

- [ ] **Step 4: Typecheck, build, sandbox scan, full tests**

Run: `npm run typecheck && npm run lint && npm run build:plugin && npm run check:sandbox && npm test`
Expected: typecheck will FAIL in `ui-vnext.ts` if the `docSource` handler builds a `DocSource` without `prose`; that is Task 5. If it fails only there, continue to Task 5 before committing. Otherwise all exit 0.

- [ ] **Step 5: Commit (together with Task 5 if typecheck required it)**

```bash
git add packages/plugin/src/main.ts packages/plugin/src/messages.ts packages/plugin/src/docLink.ts
git commit -m "feat(plugin): hand the canvas prose to update, copy, and publish

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Update builds from the canvas prose and never calls the AI

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:434-500` (`DocSource`, `updateFromSource`, and the comment above them)
- Modify: `packages/plugin/src/ui/ui-vnext.ts` (~852-860 batch confirm; ~2318-2324 `src` object; ~2345-2350 per-doc confirm)
- Test: `packages/plugin/test/fromSource.test.ts`
- Test: `packages/plugin/test/copyBrief.test.ts` (fixture gains `prose: null`)

**Interfaces:**
- Consumes from Task 4: `docSource.prose`.
- Produces: `DocSource.prose: ProseDrafts | null`. `updateFromSource(state, src, ui)` keeps its signature.

- [ ] **Step 1: Write the failing test**

Replace `packages/plugin/test/fromSource.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProseDrafts, SerializedNode } from '@spec-layer/extractor';

// Prove Update never reaches the AI: the module is mocked and asserted unused.
vi.mock('../src/ui/ai', () => ({
  generateProse: vi.fn(async () => { throw new Error('updateFromSource must not call the AI'); }),
}));

import { generateProse } from '../src/ui/ai';
import {
  createState,
  updateFromSource,
  type BuildPresenter,
  type DocSource,
} from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[]; progress: string[][] } {
  const errors: string[] = [];
  const progress: string[][] = [];
  return {
    errors,
    progress,
    clear: vi.fn(),
    error: (message: string) => { errors.push(message); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: (messages: string[]) => { progress.push(messages); },
    stopProgress: vi.fn(),
  };
}

/** A minimal component set: one variant, one bound fill, one text child. */
function buttonNode(): SerializedNode {
  return {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    visible: true,
    key: 'component-key',
    propertyDefinitions: {
      Type: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary'] },
    },
    children: [
      {
        id: '1:2',
        name: 'Type=Primary',
        type: 'COMPONENT',
        visible: true,
        layout: { mode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, itemSpacing: 8 },
        bindings: [{ property: 'fills', id: 'VariableID:1', name: 'color/bg/brand',
                     kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' }],
        children: [
          { id: '1:3', name: 'Label', type: 'TEXT', visible: true },
        ],
      },
    ],
  };
}

const prose: ProseDrafts = {
  definition: 'Edited by hand on the canvas.',
  accessibility: 'Focusable.',
  dos: ['Do this'],
  donts: [],
};

const badSource: DocSource = {
  docId: 'd1',
  node: { id: 'n1', name: 'broken' } as unknown as SerializedNode,
  fileKey: 'f1',
  config: { sections: [], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [] },
  prose: null,
};

const goodSource: DocSource = {
  docId: 'd2',
  node: buttonNode(),
  fileKey: 'f1',
  // aiEnabled is on, and Update still must not call the model.
  config: { sections: ['definition', 'dosDonts', 'tokens'], variantIds: [], aiEnabled: true, anatomyView: 'diagram', measureViews: [] },
  prose,
};

let sent: unknown[];

beforeEach(() => {
  sent = [];
  vi.clearAllMocks();
  vi.stubGlobal('parent', {
    postMessage: (m: { pluginMessage: unknown }) => { sent.push(m.pluginMessage); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateFromSource', () => {
  it('narrates before it starts working', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.progress[0]).toEqual([
      'Reading the component',
      'Composing sections',
      'Placing the frame on the canvas',
    ]);
  });

  it('reports failure through the presenter rather than throwing', async () => {
    const ui = fakePresenter();
    await expect(updateFromSource(createState(), badSource, ui)).resolves.toBe(false);
    expect(ui.errors.length).toBeGreaterThan(0);
  });

  it('builds from the prose it was given and never calls the AI', async () => {
    const ui = fakePresenter();
    const state = createState();
    state.licenseKey = 'k';
    await expect(updateFromSource(state, goodSource, ui)).resolves.toBe(true);
    expect(generateProse).not.toHaveBeenCalled();

    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      prose?: ProseDrafts; model: { sections: { id: string; kind: string; text?: string }[] };
    };
    expect(msg).toBeDefined();
    expect(msg.prose).toEqual(prose);
    const definition = msg.model.sections.find((s) => s.id === 'definition');
    expect(definition?.kind === 'prose' && definition.text).toBe('Edited by hand on the canvas.');
  });

  it('omits prose from the render request when the doc has none', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), { ...goodSource, prose: null }, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as { prose?: unknown };
    expect('prose' in msg).toBe(false);
  });
});
```

Check `createState()` exposes `licenseKey` as a writable field; if the state shape differs, drop the `state.licenseKey = 'k'` line. The point of that line is only to show that a licensed user still gets no AI call.

Also update `packages/plugin/test/copyBrief.test.ts` so `SRC` includes `prose: null` (the `DocSource` type now requires it).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/fromSource.test.ts`
Expected: FAIL. Either a type error on `prose` (run with `npm run typecheck` to see it) or `generateProse` called, since `aiEnabled: true` and a license key are set.

- [ ] **Step 3: Change `updateFromSource`**

In `packages/plugin/src/ui/actions.ts`, add `prose` to `DocSource`:

```ts
export type DocSource = {
  docId: string;
  node: SerializedNode;
  fileKey: string;
  /** The file NAME the main thread sent alongside the key, when it had one.
   *  Optional so a caller without one compiles and the brief simply omits
   *  `file_name`. */
  fileName?: string;
  config: DocConfig;
  /** What the doc's writing sections currently say, read off the canvas by the
   *  main thread with the stored blob filling anything the canvas does not
   *  show. Null when the doc has never had guidelines. */
  prose: ProseDrafts | null;
};
```

Replace the comment above `updateFromSource` (the one beginning `// is deterministic; prose runs only when the stored config had AI on`) and the function body:

```ts
// ---------------------------------------------------------------------------
// Update from source (My Library) — regenerate the doc from its live source.
//
// The generated lane is rebuilt from a fresh extraction. The editorial lane
// comes from `src.prose`, which the main thread read back from the canvas, so
// hand edits survive and the model is never asked again. An Update is a
// source refresh, not a reason to re-bill the quota, the same rule the
// foundation Update follows. Fresh AI prose is what Create is for.
// ---------------------------------------------------------------------------
export async function updateFromSource(
  _state: UiState,
  src: DocSource,
  ui: BuildPresenter,
): Promise<boolean> {
  // The caller acquires the shared build lock before requesting this source.
  // Success deliberately leaves progress running until docFrameDone or
  // docFrameError releases that lock; only a synchronous failure tears down
  // here. The vNext Library must preserve that caller-owned lifecycle.
  ui.clear();
  ui.startProgress(['Reading the component', 'Composing sections', 'Placing the frame on the canvas']);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey, ...(src.fileName ? { figmaFileName: src.fileName } : {}) });
    const selected = new Set<SectionId>(src.config.sections);
    const variantIds = new Set<string>(src.config.variantIds);
    const model = buildDocModel(spec, src.prose, selected, variantIds, {
      measureViews: src.config.measureViews,
    });
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: specContentHash(spec),
      extractorVersion: EXTRACTOR_VERSION,
      config: src.config,
      ...(src.prose ? { prose: src.prose } : {}),
    });
    // Loader stops on docFrameDone/docFrameError (ui-vnext.ts).
    return true;
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Update failed: ${msg}`);
    return false;
  }
}
```

The `_state` prefix satisfies the lint rule's `argsIgnorePattern`. Keeping the parameter avoids touching every caller and test. If `generateProse`, `effectiveAuth`, or `proseKeysForSections` are now unused imports in this file, lint will say so; remove only the ones it names (all three are still used by the Create path today).

- [ ] **Step 4: Pass `msg.prose` through and change the confirm copy in `ui-vnext.ts`**

In the `docSource` handler (~2318), the `src` object becomes:

```ts
      const src = {
        docId: msg.docId,
        node: msg.node,
        fileKey: msg.fileKey,
        ...(msg.fileName ? { fileName: msg.fileName } : {}),
        config: msg.config,
        prose: msg.prose,
      };
```

The Copy path just below still uses `active.prose` from the earlier `docProse` reply, which Task 4 made the merged prose. Leave it.

Replace the per-doc confirm (~2346):

```ts
        if (!window.confirm('You edited generated content in this frame by hand. Updating replaces those edits. Your text in the writing sections is kept.')) {
          finishLibraryOperation('Update canceled because the frame has hand edits to generated content.');
          return;
        }
```

Replace the batch confirm text (~855-858):

```ts
      batch
        ? `${edited.length} selected ${edited.length === 1 ? 'document has' : 'documents have'} hand edits to generated content. Updating replaces those edits. Text in the writing sections is kept.`
        : 'You edited generated content in this frame by hand. Updating replaces those edits. Your text in the writing sections is kept.',
```

Check with `grep -n "em dash\|—" packages/plugin/src/ui/ui-vnext.ts | grep -i "edited"` that no em dash slipped into the new strings. Expected: no output.

- [ ] **Step 5: Run the tests, typecheck, lint**

Run: `npx vitest run packages/plugin/test/fromSource.test.ts packages/plugin/test/copyBrief.test.ts && npm run typecheck && npm run lint`
Expected: PASS and exit 0.

- [ ] **Step 6: Full gate**

Run: `npm run check`
Expected: exit 0. Read the exit status directly (`echo $?` on the next line), never through a pipe.

- [ ] **Step 7: Commit**

If Task 4 was left uncommitted because of the typecheck dependency, include its files here.

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui-vnext.ts packages/plugin/test/fromSource.test.ts packages/plugin/test/copyBrief.test.ts
git commit -m "feat(plugin): update keeps canvas prose and never regenerates it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Record the change in the changelog, knowledge map, test matrix, and backlog

**Files:**
- Modify: `CHANGELOG.md` (top of `## [Unreleased]`)
- Modify: `docs/plugin-knowledge-map.md:80-92`
- Modify: `packages/plugin/TESTING.md:160-161` (row 5 of the Library matrix)
- Modify: `docs/feature-backlog-2026-07.md:52` (item 4.2)
- Modify: `docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md` (status line)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]`, add a `### Changed` section (or add to it if one exists) with:

```markdown
### Changed

- A Library Update keeps what is written in a component doc's writing
  sections. The renderer tags the definition, accessibility, interactions,
  content considerations, dos and don'ts, variants and anatomy summaries, and
  anatomy part descriptions as editorial. Update reads that text back off the
  canvas, rebuilds every generated table and matrix from the live component,
  and renders the two together. It no longer calls the AI, so it spends no
  quota and never replaces prose a designer rewrote. Rebuild needed and
  Update all follow the same path. Copy for AI and Publish read the same
  canvas text, so hand edits reach the coding agent's brief.

  "Manually edited" now means an edit to generated content, the only kind an
  Update replaces. Editing the writing sections reads as In sync. The confirm
  before an Update names what is at stake and says the writing sections are
  kept. Creating documentation again from the component screen still starts
  over with fresh AI prose; that is the one way to ask the model again.

  An empty prose field now renders the placeholder instead of a blank line,
  and an empty dos and don'ts pair shows the placeholder rather than nothing.
```

- [ ] **Step 2: Knowledge map**

Replace lines 90-92 of `docs/plugin-knowledge-map.md` (the paragraph beginning `Updates replace the linked Section in place.`) with:

```markdown
Updates replace the linked Section in place, but the doc has two lanes.
Generated content (tables, matrices, anatomy structure, chrome) is rebuilt
from the live source. Editorial content (the writing sections) is tagged with
pluginData at render time (`canvasProse.ts`), read back from the canvas on
Update, and rendered again unchanged; Update never calls the AI. `selfHash`
covers the generated lane only, so "manually edited" means an edit Update
would replace. Source drift uses deterministic content hashes and excludes
AI prose. Copy for AI and Publish read the same canvas text, with the stored
`DOC_PROSE_KEY` blob filling any section the doc does not render.
```

- [ ] **Step 3: Test matrix**

Replace row 5 in `packages/plugin/TESTING.md`:

```markdown
5. Edit text in a writing section (the definition, a do or don't, an
   accessibility line, an anatomy part description). Refresh Library and
   confirm the row still reads **In sync**. Change the source, run **Update
   documentation**, and confirm the rebuilt frame keeps your edited text
   word for word, bold included, while its tables reflect the source change.
   Duplicate a do row before updating and confirm the extra row survives.
   Then edit a generated cell (a token table value). Confirm **Manually
   edited**, the confirm that says generated edits are replaced and writing
   sections are kept, and that an accepted Update replaces the cell edit and
   keeps the writing sections. Run **Copy for AI** on the edited doc and
   confirm the brief carries the edited text.
```

- [ ] **Step 4: Backlog**

Replace item 4.2's row in `docs/feature-backlog-2026-07.md`:

```markdown
| 4.2 | **[feat] Manual-edit preservation on Update** ✅ built (2026-09-03) | Narrowed from a three-way merge to a two-lane model: writing sections are tagged as editorial and read back from the canvas on Update; generated sections are rebuilt. Spec `docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md`. Open follow-ups: the same tagging for Foundation group descriptions, and a hand-edit warning on Create over an existing doc. |
```

- [ ] **Step 5: Spec status**

In the spec, change `**Status:** approved, ready for planning` to `**Status:** implemented 2026-09-03`.

- [ ] **Step 6: NUL scan of the docs you touched**

`npm run check:nul` covers `packages/` only. Run:

```bash
for f in CHANGELOG.md docs/plugin-knowledge-map.md packages/plugin/TESTING.md docs/feature-backlog-2026-07.md docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md docs/superpowers/plans/2026-09-03-preserve-hand-edits-on-update.md; do printf '%s: ' "$f"; tr -d -c '\000' < "$f" | wc -c; done
```

Expected: `0` for every file.

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md docs/plugin-knowledge-map.md packages/plugin/TESTING.md docs/feature-backlog-2026-07.md docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md docs/superpowers/plans/2026-09-03-preserve-hand-edits-on-update.md
git commit -m "docs: record how update keeps hand edits to component docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Slots and tags: Task 2. Read-back rules and merge: Task 1. Empty-string placeholder rule: Task 3. Lane-aware self hash and confirm copy: Tasks 4 and 5. Update flow without AI: Task 5. Copy and Publish using merged prose: Task 4. Tests listed in the spec: Tasks 1, 2, 3, 5 plus the TESTING.md row in Task 6. Docs: Task 6. Out-of-scope items are not implemented, by design.

**Known deviation from the spec.** The spec's round-trip test says "expect equality for every slot". The definition slot cannot be byte-identical after one cycle because the renderer lifts the first sentence into the header and rejoins it on a new line. Task 2 asserts the exact expected form and adds a fixed-point test so the second cycle is lossless. The spec's intent (no words lost, no words changed) holds.

**Type consistency.** `ProseNodeLike`, `CanvasProse`, `readCanvasProse`, `mergeProse`, `collectGeneratedText`, `textToMarkdown`, `SLOT_KEY`, `SLOT_PART_KEY`, `LINE_KEY`, `PLACEHOLDER_TEXT` are defined in Task 1 and used with the same names in Tasks 2, 4. `DocSource.prose: ProseDrafts | null` is defined in Task 5 and matched by the `docSource` message in Task 4. `collectGeneratedLane` and `docProse` are `main.ts` locals defined and used only in Task 4.

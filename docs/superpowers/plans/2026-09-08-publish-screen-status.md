# Publish Screen Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the plugin's Publish for developers screen a status block (last published, library id, free updates), a CLI docs link, a separated Rotate key row, and a publish date that survives sessions because the file stores it.

**Architecture:** Presentation stays in `packages/plugin/src/ui/screens/publish.ts`, state and proxy calls in `packages/plugin/src/ui/publish.ts`, pure formatting in `viewModel/allowance.ts`. The date is persisted by the main thread in root plugin data beside the library id, carried by the existing `publishInfo` reply, and written by one new `setPublishedAt` message. No proxy change.

**Tech Stack:** TypeScript, vanilla DOM string templates, Vitest, esbuild. Spec: `docs/superpowers/specs/2026-09-08-publish-screen-status-design.md`.

## Global Constraints

- Plugin UI copy: sentence case, second person, no em dashes, no hype words (`docs/plugin-voice-and-copy.md`). Every screen test asserts `not.toContain('—')`.
- Never fabricate: a date that is unknown renders "Not recorded", never today's date or a guessed one.
- The main thread (`packages/plugin/src/main.ts`) has no browser globals. `Intl` is fine in the iframe (`src/ui/**`) but nothing new goes into `main.ts` except plugin data reads and writes.
- Do not touch `EXTRACTOR_VERSION`, any hash, the bundle format, or the proxy.
- Conventional commit subjects, lowercase, scoped, with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Run from the worktree root: `/Users/sandrolek/Documents/Projects/Design System Docs/.claude/worktrees/feat-publish-screen-status`. Single test file: `npx vitest run packages/plugin/test/<file>`.
- `main` is protected; the work ships as a squash PR that passes `verify`.

---

### Task 1: `formatPublishedAt` in the allowance view model

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/allowance.ts` (after `formatResetDate`, around line 175)
- Test: `packages/plugin/test/allowance.test.ts` (after the `formatResetDate` describe, line 194)

**Interfaces:**
- Produces: `export function formatPublishedAt(iso: string, locale?: string): string | null` — local-time medium date plus short time; `null` for empty or unparsable input.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/allowance.test.ts`, and add `formatPublishedAt` to the import on line 3:

```ts
describe('formatPublishedAt', () => {
  it('formats a medium date and a short time in the given locale', () => {
    // 12:00 UTC lands on the same calendar day in every timezone this repo
    // runs tests in, so the date part is stable; the hour is asserted loosely.
    const out = formatPublishedAt('2026-09-08T12:00:00.000Z', 'en-GB');
    expect(out).not.toBeNull();
    expect(out).toContain('8 Sept 2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
  it('returns null for empty or unparsable input, never a made-up date', () => {
    expect(formatPublishedAt('', 'en-GB')).toBeNull();
    expect(formatPublishedAt('nope', 'en-GB')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/allowance.test.ts`
Expected: FAIL, `formatPublishedAt` is not exported.

- [ ] **Step 3: Implement**

Add to `packages/plugin/src/ui/viewModel/allowance.ts` after `formatResetDate`:

```ts
/**
 * The moment a publish happened, in the user's local time: "8 Sept 2026,
 * 14:32". Local, not UTC, because this is when the user pressed Publish, not
 * a server boundary; `formatResetDate` keeps its UTC rule for the month reset.
 * `locale` exists for deterministic tests; the plugin passes none. Null for
 * anything unparsable, so the caller can say "Not recorded" instead of
 * inventing a date.
 */
export function formatPublishedAt(iso: string, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/allowance.test.ts`
Expected: PASS. If the `en-GB` medium date renders as `8 Sep 2026` on this Node version, change the assertion to `toMatch(/8 Sept? 2026/)` rather than the implementation.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/allowance.ts packages/plugin/test/allowance.test.ts
git commit -m "feat(plugin): format a publish date in local time

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Store the publish date in the file

**Files:**
- Modify: `packages/plugin/src/messages.ts:163-171` (the `publishInfo` reply and `PublishInfo`), `:215-218` (UI-to-main messages)
- Modify: `packages/plugin/src/main.ts:336-348` (keys and `readPublishInfo`), `:1426-1439` (`setPublishInfo` / `clearPublishInfo` handlers)

**Interfaces:**
- Produces: `PublishInfo { libraryId: string | null; pullKey: string | null; publishedAt: string | null }`; new message `{ type: 'setPublishedAt'; libraryId: string; publishedAt: string }`.
- Consumers: Task 3 (controller sends `setPublishedAt`, reads `publishedAt` from replies), Task 4 tests build `PublishInfo` fixtures with the new field.

There is no unit test for `main.ts` message handlers in this repo; the type
change is what verifies this task, plus the sandbox scan of the built bundle.

- [ ] **Step 1: Extend the message contract**

In `packages/plugin/src/messages.ts` replace line 171:

```ts
/** What identifies a published library: the id lives in the file (root plugin
 *  data, shared by every editor) and the pull key lives per user in
 *  clientStorage, since it is a secret and the file is not. `publishedAt` is
 *  the ISO time of the last publish the plugin recorded, stored in the file
 *  beside the id because it is a fact about the library, not a secret. Null
 *  when the file was published by a build that did not record it. */
export interface PublishInfo {
  libraryId: string | null;
  pullKey: string | null;
  publishedAt: string | null;
}
```

After the `setPublishInfo` line (215) add:

```ts
  /** Record when this file's library was last published. Ignored by the main
   *  thread when `libraryId` is not the id the file holds, so a slow reply for
   *  a library the file has since dropped cannot label the new one. */
  | { type: 'setPublishedAt'; libraryId: string; publishedAt: string }
```

- [ ] **Step 2: Run typecheck to see what breaks**

Run: `npm run typecheck`
Expected: errors in `main.ts` (`readPublishInfo` returns an object missing `publishedAt`), `ui/harness.ts` or tests that build `PublishInfo` literals (`publish.test.ts` line 514 and others). Note each; Tasks 3 and 4 fix the UI ones.

- [ ] **Step 3: Main thread storage**

In `packages/plugin/src/main.ts` replace lines 336-348 with:

```ts
const PUBLISH_LIBRARY_KEY = 'speclayer.publish.libraryId';
/** ISO time of the last recorded publish. Lives in the file, like the id. */
const PUBLISH_DATE_KEY = 'speclayer.publish.publishedAt';
const publishKeyStorageKey = (libraryId: string): string => `publishKey:${libraryId}`;

async function readPublishInfo(): Promise<PublishInfo> {
  const libraryId = figma.root.getPluginData(PUBLISH_LIBRARY_KEY) || null;
  if (!libraryId) return { libraryId: null, pullKey: null, publishedAt: null };
  let pullKey: string | null = null;
  try {
    const raw = await figma.clientStorage.getAsync(publishKeyStorageKey(libraryId)) as unknown;
    pullKey = typeof raw === 'string' && raw ? raw : null;
  } catch { pullKey = null; }
  const publishedAt = figma.root.getPluginData(PUBLISH_DATE_KEY) || null;
  return { libraryId, pullKey, publishedAt };
}
```

Add a handler after `case 'setPublishInfo'` (ends line 1430):

```ts
    case 'setPublishedAt': {
      // Only for the library this file currently holds. A reply that races a
      // clearPublishInfo, or belongs to an id the file no longer stores, must
      // not date the wrong library.
      if (figma.root.getPluginData(PUBLISH_LIBRARY_KEY) === msg.libraryId) {
        figma.root.setPluginData(PUBLISH_DATE_KEY, msg.publishedAt);
      }
      break;
    }
```

In `case 'clearPublishInfo'` add after `figma.root.setPluginData(PUBLISH_LIBRARY_KEY, '');`:

```ts
      figma.root.setPluginData(PUBLISH_DATE_KEY, '');
```

- [ ] **Step 4: Typecheck main.ts is clean**

Run: `npm run typecheck 2>&1 | grep -v "src/ui\|test/" ; echo done`
Expected: no `main.ts` errors remain. UI and test errors are expected until Tasks 3 and 4.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): store the last publish date in the file beside the library id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Controller records and seeds the date

**Files:**
- Modify: `packages/plugin/src/ui/publish.ts:313-360` (`onPublishSources`), `:384-388` (`onPublishInfo`)
- Test: `packages/plugin/test/publish.test.ts` (fixture on line 514, new tests after the `onPublishInfo seeds` test around line 750)

**Interfaces:**
- Consumes: `PublishInfo.publishedAt`, message `setPublishedAt` (Task 2).
- Produces: `PublishState.lastPublishedAt` populated from the file on open, and `setPublishedAt` sent after `created`, `updated`, `unchanged`.

- [ ] **Step 1: Fix the fixture and write failing tests**

In `packages/plugin/test/publish.test.ts` change line 514 to:

```ts
      publishInfo: { libraryId: null, pullKey: null, publishedAt: null },
```

Every other `publishInfo:` literal and `onPublishInfo({ type: 'publishInfo', ... })` call in the file needs `publishedAt: null` added (lines 707, 726, 739, 747, 774, 784, 794, 818 at the time of writing; use `grep -n "publishInfo" packages/plugin/test/publish.test.ts`).

Add these tests inside `describe('publish controller')`, after the `onPublishInfo seeds libraryId/pullKey only while idle` test:

```ts
  it('records the publish date in the file after a create, an update, and an unchanged publish', async () => {
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(201, {
      libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-09-01T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({ type: 'setPublishedAt', libraryId: 'lib_1', publishedAt: '2026-09-01T00:00:01.000Z' });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z',
    })));
    expect(sent).toContainEqual({ type: 'setPublishedAt', libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z' });

    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(200, {
      libraryId: 'lib_1', publishedAt: '2026-09-02T00:00:01.000Z', unchanged: true,
    })));
    // The unchanged answer carries the stored library's existing date, which
    // is the true last-published time, so it is recorded too.
    expect(sent.filter((m) => m.type === 'setPublishedAt')).toHaveLength(3);
    expect(publish.publishState().lastPublishedAt).toBe('2026-09-02T00:00:01.000Z');
  });

  it('records no date after a failed publish', async () => {
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(500, {})));
    expect(sent.some((m) => m.type === 'setPublishedAt')).toBe(false);
  });

  it('seeds the date from the file while idle, and falls back to the sources reply', async () => {
    publish.onPublishInfo({
      type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z',
    });
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');

    vi.resetModules();
    publish = await import('../src/ui/publish');
    sent = [];
    publish.setPublishHost({ repaint: () => {}, send: (m) => sent.push(m), onPublishQuota: () => {} });
    publish.onPublishClick(AUTH);
    // The publish fails, so the only date the state can hold is the one the
    // main thread read from the file in the same round trip as the sources.
    await publish.onPublishSources(
      sourcesMsg({ publishInfo: { libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z' } }),
      AUTH, vi.fn(async () => jsonResponse(500, {})),
    );
    expect(publish.publishState().lastPublishedAt).toBe('2026-08-30T09:12:00.000Z');
  });

  it('drops the date with the id when the library is gone', async () => {
    publish.onPublishInfo({
      type: 'publishInfo', libraryId: 'lib_1', pullKey: 'sl_1', publishedAt: '2026-08-30T09:12:00.000Z',
    });
    publish.onPublishClick(AUTH);
    await publish.onPublishSources(sourcesMsg(), AUTH, vi.fn(async () => jsonResponse(404, { error: 'not_found' })));
    expect(publish.publishState().lastPublishedAt).toBeNull();
  });
```

Check the `setPublishHost` shape used by `beforeEach` (around line 525) and match it exactly in the re-import above.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/publish.test.ts`
Expected: the four new tests FAIL (no `setPublishedAt` sent; `lastPublishedAt` null).

- [ ] **Step 3: Implement**

In `packages/plugin/src/ui/publish.ts`:

Replace lines 313-316 with:

```ts
  const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
  const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
  const lastPublishedAt = state.lastPublishedAt ?? msg.publishInfo.publishedAt;
  state = { ...state, status: 'uploading', libraryId, pullKey, lastPublishedAt };
  host.repaint();
```

After the `case 'created'` `host.send({ type: 'setPublishInfo', ... })` line add:

```ts
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
```

In `case 'updated'` and `case 'unchanged'`, after the `state = {...}` block and before `break;`, add the same line:

```ts
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
```

In `case 'gone'` change the state line to:

```ts
      state = { ...state, status: 'error', libraryId: null, pullKey: null, lastPublishedAt: null, message: GONE_MESSAGE };
```

Replace `onPublishInfo` body:

```ts
export function onPublishInfo(msg: PublishInfoMsg): void {
  if (state.status !== 'idle') return;
  state = { ...state, libraryId: msg.libraryId, pullKey: msg.pullKey, lastPublishedAt: msg.publishedAt };
  host.repaint();
}
```

Update the doc comment above it: "Seed libraryId/pullKey" becomes "Seed libraryId, pullKey and lastPublishedAt".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/plugin/test/publish.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/publish.ts packages/plugin/test/publish.test.ts
git commit -m "feat(plugin): record and seed the last publish date

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The screen: status block, docs link, separated rotate row

**Files:**
- Modify: `packages/plugin/src/ui/proxy.ts:10` (add `CLI_DOCS_URL`)
- Modify: `packages/plugin/src/ui/screens/publish.ts` (whole `publishScrollMarkup`, constants)
- Modify: `packages/plugin/src/ui/design-system/patterns.css:1321-1350` (publish rules), `:2121-2157` (About list and link selectors)
- Test: `packages/plugin/test/publishScreen.test.ts`

**Interfaces:**
- Consumes: `formatPublishedAt` (Task 1), `PublishState.lastPublishedAt` (Task 3), `publishAllowance` / `PublishAllowance` / `formatResetDate` (existing).
- Produces: markup classes `sl-publish-facts`, `sl-publish-docs`, `sl-publish-rotate`; the constant `CLI_DOCS_URL = 'https://spec-layer.com/docs/cli/'`.

- [ ] **Step 1: Add the URL constant**

In `packages/plugin/src/ui/proxy.ts` after line 10:

```ts
// The CLI command reference, linked from the publish screen's Developer setup.
export const CLI_DOCS_URL = 'https://spec-layer.com/docs/cli/';
```

- [ ] **Step 2: Rewrite the screen tests that change**

In `packages/plugin/test/publishScreen.test.ts`:

Add to the imports:

```ts
import { CLI_DOCS_URL } from '../src/ui/proxy';
```

Replace the test `puts rotate beside copy as a secondary button in danger colour` with:

```ts
  /**
   * Rotating is the one destructive action on the screen. It keeps the
   * secondary tone with `is-danger` on the label, and it sits in its own row
   * under the docs link, not in the copy row: two copy buttons and a cut-off
   * in one row made the consequence line read as belonging to all three.
   */
  it('puts rotate in its own row after the copy row and the docs link', () => {
    const markup = proScroll(PUBLISHED);
    const rotate = /<button[^>]*data-publish-rotate[^>]*>/.exec(markup)?.[0] ?? '';
    expect(rotate).toContain('data-tone="secondary"');
    expect(rotate).toContain('is-danger');
    expect(rotate).not.toContain('data-tone="danger"');
    const copyRow = /<div class="sl-publish-command-actions">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
    expect(copyRow).toContain('data-publish-copy-command');
    expect(copyRow).toContain('data-publish-copy-agent');
    expect(copyRow).not.toContain('data-publish-rotate');
    const rotateRow = /<div class="sl-publish-rotate">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
    expect(rotateRow).toContain('data-publish-rotate');
    expect(markup.indexOf('sl-publish-docs')).toBeLessThan(markup.indexOf('sl-publish-rotate'));
    expect(markup.indexOf('sl-publish-command-actions')).toBeLessThan(markup.indexOf('sl-publish-docs'));
  });
```

Replace the test `names rotating in the consequence under the two-button row` with:

```ts
  it('keeps the rotate consequence directly under the rotate button', () => {
    const markup = proScroll(PUBLISHED);
    expect(markup).toContain(
      'Rotating cuts off everyone using the current key within about a minute.',
    );
    expect(markup.indexOf('sl-publish-hint'))
      .toBeGreaterThan(markup.indexOf('data-publish-rotate'));
  });
```

In the `Copy for an AI agent` test, delete the two lines asserting `data-publish-copy-agent` comes before `data-publish-rotate` inside `row` (rotate is no longer in that row).

Replace the whole `describe('publish screen definition and allowance')` block with:

```ts
describe('publish screen status block', () => {
  it('says not published yet, and nothing else, before the first publish', () => {
    const markup = proScroll(state());
    const facts = /<dl class="sl-publish-facts">([\s\S]*?)<\/dl>/.exec(markup)?.[1] ?? '';
    expect(facts).toContain('<dt>Status</dt><dd>Not published yet</dd>');
    expect(facts).not.toContain('Last published');
    expect(facts).not.toContain('Library id');
    expect(markup.indexOf('sl-publish-facts')).toBeLessThan(markup.indexOf('<h2>What gets published</h2>'));
  });

  it('shows the recorded date in local time and the library id once published', () => {
    const markup = publishScrollMarkup(PUBLISHED, { kind: 'hidden' }, 'en-GB');
    const facts = /<dl class="sl-publish-facts">([\s\S]*?)<\/dl>/.exec(markup)?.[1] ?? '';
    expect(facts).not.toContain('Not published yet');
    expect(facts).toMatch(/<dt>Last published<\/dt><dd>1 Sept? 2026, \d{2}:\d{2}<\/dd>/);
    expect(facts).toContain(`<dt>Library id</dt><dd><code>${LIBRARY_ID}</code></dd>`);
  });

  it('never invents a date: an id without one reads "Not recorded"', () => {
    const markup = proScroll(state({ libraryId: LIBRARY_ID, pullKey: PULL_KEY, lastPublishedAt: null }));
    expect(markup).toContain('<dt>Last published</dt><dd>Not recorded</dd>');
    expect(proScroll(state({ libraryId: LIBRARY_ID, lastPublishedAt: 'garbage' })))
      .toContain('<dd>Not recorded</dd>');
  });

  it('shows the free updates row on a free plan and no row on pro or unknown', () => {
    expect(publishScrollMarkup(state(), FREE))
      .toContain('<dt>Free updates</dt><dd>3 of 10 left this month, resets Oct 1</dd>');
    expect(publishScrollMarkup(state(), { ...FREE, remaining: 0 }))
      .toContain('<dt>Free updates</dt><dd>None left this month, resets Oct 1</dd>');
    expect(publishScrollMarkup(state(), { kind: 'hidden' })).not.toContain('Free updates');
  });

  it('keeps Publish enabled at zero remaining, since the server decides', () => {
    const footer = publishFooterMarkup(state());
    expect(footer).toContain('data-publish');
    expect(footer).not.toContain('disabled');
  });

  it('drops the old definition caption', () => {
    for (const status of ALL_STATES) {
      expect(publishScrollMarkup(state({ status }), FREE)).not.toContain('A library is this Figma file');
      expect(publishScrollMarkup(state({ status }), FREE)).not.toContain('sl-publish-definition');
      expect(publishScrollMarkup(state({ status }), FREE)).not.toContain('sl-publish-allowance');
    }
  });

  it('always offers rotate to a device holding the key, on every plan', () => {
    expect(publishScrollMarkup(PUBLISHED, FREE)).toContain('data-publish-rotate');
    expect(publishScrollMarkup(state({ libraryId: LIBRARY_ID, pullKey: null }), FREE))
      .toContain('Rotate the key to issue a new one.');
  });

  it('keeps the plugin voice: no em dashes on any plan', () => {
    const all = [
      ...ALL_STATES.map((status) => publishScrollMarkup(state({ status }), FREE)),
      publishScrollMarkup(PUBLISHED, FREE),
      ...ALL_STATES.map((status) => publishFooterMarkup(state({ status }))),
    ].join('');
    expect(all).not.toContain('—');
    expect(all).not.toContain('Pro plan required');
  });
});

describe('publish screen docs link', () => {
  it('links to the CLI reference under the setup command, the way Settings links to the docs', () => {
    const markup = proScroll(PUBLISHED);
    const link = /<a class="sl-publish-docs"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(link).toContain(`href="${CLI_DOCS_URL}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener"');
    expect(markup).toContain('CLI documentation');
    expect(markup).toContain(ICON_PATHS.externalLink);
    expect(CLI_DOCS_URL).toBe('https://spec-layer.com/docs/cli/');
  });

  it('offers the docs link to a device without the key too', () => {
    expect(proScroll(state({ libraryId: LIBRARY_ID, pullKey: null }))).toContain('sl-publish-docs');
  });

  it('shows no docs link before the first publish, since there is nothing to pull yet', () => {
    expect(proScroll(state())).not.toContain('sl-publish-docs');
  });
});
```

Update the existing "names what publishing sends" test: the expected strings become
`'The foundation document and every connected component document in this file, published as AI context.'`
and `'Publishing replaces the version before it.'`.

In `describe('publish screen styling')` add:

```ts
  /** One grid for both label-and-value lists, so the two cannot drift apart. */
  it('shares the About list grid and the docs link style rather than copying them', () => {
    expect(css).toMatch(/\.sl-about-versions,\s*\.sl-publish-facts\s*\{/);
    expect(css).toMatch(/\.sl-about-docs,\s*\.sl-publish-docs\s*\{/);
    expect(rule('.sl-publish-definition')).toBe('');
    expect(rule('.sl-publish-allowance')).toBe('');
    expect(rule('.sl-publish-rotate')).toMatch(/margin-top/);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/plugin/test/publishScreen.test.ts`
Expected: FAIL on every new or changed assertion; the `publishScrollMarkup` three-argument call is also a type error until Step 4.

- [ ] **Step 4: Rewrite the screen module**

In `packages/plugin/src/ui/screens/publish.ts`:

Change imports:

```ts
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { setupCommand, type PublishState } from '../publish';
import { CLI_DOCS_URL } from '../proxy';
import {
  formatPublishedAt, formatResetDate, type PublishAllowance,
} from '../viewModel/allowance';
import { progressMarkup } from './progress';
```

Replace the `WHAT_GETS_PUBLISHED` constant:

```ts
const WHAT_GETS_PUBLISHED =
  'The foundation document and every connected component document in this ' +
  'file, published as AI context. Publishing replaces the version before it.';
```

Delete the `LIBRARY_DEFINITION` constant and its comment.

Add, after `BEFORE_FIRST_PUBLISH`:

```ts
/**
 * The status block: label and value rows, each present only when it has a
 * true value. "Not recorded" covers a library published by a build before
 * the date was stored; the next publish records one. Never a guessed date.
 * `locale` is for deterministic tests; the plugin passes none.
 */
function factsMarkup(state: PublishState, allowance: PublishAllowance, locale?: string): string {
  const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const rows: string[] = [];
  if (!state.libraryId) {
    rows.push(row('Status', 'Not published yet'));
  } else {
    const when = state.lastPublishedAt ? formatPublishedAt(state.lastPublishedAt, locale) : null;
    rows.push(row('Last published', when ? esc(when) : 'Not recorded'));
    rows.push(row('Library id', `<code>${esc(state.libraryId)}</code>`));
  }
  if (allowance.kind === 'free') {
    const reset = formatResetDate(allowance.resetsAt);
    const tail = reset ? `, resets ${reset}` : '';
    const count = allowance.remaining <= 0
      ? `None left this month${tail}`
      : `${allowance.remaining} of ${allowance.limit} left this month${tail}`;
    rows.push(row('Free updates', count));
  }
  return `<dl class="sl-publish-facts">${rows.join('')}</dl>`;
}

/**
 * The way to the CLI reference, in the same shape as the Settings docs link
 * (an anchor with target _blank is the plugin's one established way to leave
 * the iframe). Shown wherever there is a library to pull.
 */
const DOCS_LINK =
  `<a class="sl-publish-docs" href="${CLI_DOCS_URL}" target="_blank" rel="noopener">` +
  `CLI documentation${icon('externalLink', 14)}</a>`;
```

Replace `publishScrollMarkup` with:

```ts
export function publishScrollMarkup(
  state: PublishState, allowance: PublishAllowance, locale?: string,
): string {
  const busy = isBusy(state);
  // Rotating during an upload would race the publish on the server, so the
  // control is disabled while the footer reports work in progress. Its own
  // row: the one destructive action on the screen, kept apart from copying,
  // with its consequence directly beneath it.
  const rotateRow =
    '<div class="sl-publish-rotate">' +
    '<button class="sl-button is-danger" data-tone="secondary" type="button" ' +
    `data-publish-rotate${busy ? ' disabled' : ''}>Rotate key</button>` +
    '</div>' +
    '<p class="sl-publish-hint">Rotating cuts off everyone using the current key ' +
    'within about a minute.</p>';
  // The id lives in the file; the key lives on the device that published or
  // rotated last. Both halves are needed for a command a developer can
  // actually run, so with only the id the screen says so and offers the one
  // way to get a key: rotate.
  const idOnly = state.libraryId && !state.pullKey
    ? (
      '<section class="sl-publish-group">' +
      '<div class="sl-settings-section-heading"><h2>Developer setup</h2>' +
      `<p>This file is published as <code>${esc(state.libraryId)}</code>. ` +
      'The pull key is not on this device, so the setup command cannot be shown here. ' +
      'Rotate the key to issue a new one.' +
      '</p></div>' +
      DOCS_LINK +
      rotateRow +
      '</section>'
    )
    : '';
  const setup = state.pullKey && state.libraryId
    ? (
      '<section class="sl-publish-group">' +
      '<div class="sl-settings-section-heading"><h2>Developer setup</h2>' +
      `<p>${DEVELOPER_SETUP}</p></div>` +
      '<div class="sl-publish-command">' +
      `<code>${esc(setupCommand(state.libraryId, state.pullKey))}</code>` +
      '</div>' +
      '<div class="sl-publish-command-actions">' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-copy-command>Copy setup command</button>' +
      /*
       * The same setup as a message for a coding agent: the command with
       * `--yes`, what it does, and the command that writes the agent's guide.
       * A developer who hands the bare command to an agent leaves it to guess
       * at the files; this hands it the instructions with the key.
       */
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-copy-agent>Copy for an AI agent</button>' +
      '</div>' +
      DOCS_LINK +
      rotateRow +
      '</section>'
    )
    : idOnly;
  const statusLine = state.message
    ? `<p class="sl-publish-status${state.status === 'error' ? ' is-error' : ''}">${esc(state.message)}</p>`
    : '';
  return (
    '<div class="sl-publish-body">' +
    factsMarkup(state, allowance, locale) +
    '<section class="sl-publish-group">' +
    '<div class="sl-settings-section-heading"><h2>What gets published</h2>' +
    `<p>${WHAT_GETS_PUBLISHED}</p>` +
    (!setup ? `<p>${BEFORE_FIRST_PUBLISH}</p>` : '') +
    '</div>' +
    '</section>' +
    setup +
    // Last, not inside either group: the message reports whichever action ran
    // last, and both Publish (the footer) and Rotate key (above) can set it.
    statusLine +
    '</div>'
  );
}
```

Update the comment above `WHAT_GETS_PUBLISHED` ("Two groups, because...") to mention the status block first: "A status block, then two groups: ...".

- [ ] **Step 5: CSS**

In `packages/plugin/src/ui/design-system/patterns.css`:

Delete the `.sl-publish-definition` and `.sl-publish-allowance` rules (lines 1337-1348) and add in their place:

```css
/*
 * The status block at the top: label and value rows sharing the About list's
 * grid (see .sl-about-versions). Its bottom margin is the gap before the first
 * group, since the groups only draw rules between each other.
 */
.sl-publish-facts {
  margin-bottom: var(--sl-space-16);
}

.sl-publish-facts code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--sl-font-size-caption);
}

/* The destructive action's own row, spaced like the copy row above it. */
.sl-publish-rotate {
  display: flex;
  margin-top: var(--sl-space-10);
}
```

Change the About selectors (lines 2121-2157) to selector lists. Each of these five rules gets the publish twin:

```css
.sl-about-versions,
.sl-publish-facts {
  display: grid;
  ...unchanged body...
}

.sl-about-versions > div,
.sl-publish-facts > div {
  display: contents;
}

.sl-about-versions dt,
.sl-publish-facts dt {
  color: var(--sl-color-text-muted);
}

.sl-about-versions dd,
.sl-publish-facts dd {
  margin: 0;
  color: var(--sl-color-text);
  font-variant-numeric: tabular-nums;
}

.sl-about-docs,
.sl-publish-docs {
  ...unchanged body...
}

.sl-about-docs:hover,
.sl-publish-docs:hover {
  text-decoration: underline;
}
```

Note `.sl-publish-facts { margin-bottom }` appears after the shared rule in the cascade only if it comes later in the file; it does not (1337 < 2121), and the shared rule sets `margin: 0`. So put the `margin-bottom` on the shared block's publish twin instead: add a separate rule immediately after the shared `.sl-about-versions, .sl-publish-facts` block:

```css
/* The status block is followed by a group, so it carries the gap. */
.sl-publish-facts {
  margin-bottom: var(--sl-space-16);
}
```

and drop the earlier `.sl-publish-facts { margin-bottom }` rule near line 1337, keeping only the `code` and `.sl-publish-rotate` rules there. The styling test `rule('.sl-publish-rotate')` needs the rule to start on its own line as `\n.sl-publish-rotate {`.

- [ ] **Step 6: Run the screen tests, then the whole plugin suite**

Run: `npx vitest run packages/plugin/test/publishScreen.test.ts`
Expected: PASS.

Run: `npx vitest run packages/plugin`
Expected: PASS. If `harness.ts` fails typecheck inside vitest (it usually is not imported by tests), Task 5 fixes it.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/proxy.ts packages/plugin/src/ui/screens/publish.ts packages/plugin/src/ui/design-system/patterns.css packages/plugin/test/publishScreen.test.ts
git commit -m "feat(plugin): publish screen status block, cli docs link, separate rotate row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Harness fixtures and visual check

**Files:**
- Modify: `packages/plugin/src/ui/harness.ts:529-577`

- [ ] **Step 1: Fixtures**

In `PUBLISH_FIXTURES` add after `uploading`:

```ts
    idOnly: {
      status: 'idle',
      message: null,
      libraryId: `lib_${'a1b2c3d4'.repeat(3)}`,
      pullKey: null,
      lastPublishedAt: '2026-08-30T09:12:00.000Z',
    },
    unrecorded: {
      status: 'idle',
      message: null,
      libraryId: `lib_${'a1b2c3d4'.repeat(3)}`,
      pullKey: `sl_${'0f'.repeat(24)}`,
      lastPublishedAt: null,
    },
```

Change the `error` fixture's message to `'Could not reach the publish service. Check your connection and try again.'` (the old "needs an active Pro license" string no longer exists in the product).

- [ ] **Step 2: Typecheck and build the harness**

Run: `npm run typecheck && UI_HARNESS=1 npm run build:plugin`
Expected: clean; `Built dist/ui-harness.html (dev only)`.

- [ ] **Step 3: Look at every branch**

The preview pane drops the query string, so patch the compiled defaults with Python into a new file per state (never `grep` the built HTML, it is one huge line):

```bash
python3 - <<'EOF'
import pathlib
src = pathlib.Path('packages/plugin/dist/ui-harness.html').read_text()
def variant(name, publish, plan):
    out = src.replace('("view","component")', '("view","library")') \
             .replace('("pane","list")', '("pane","publish")') \
             .replace('("publish","published")', f'("publish","{publish}")') \
             .replace('("plan","pro")', f'("plan","{plan}")')
    assert out != src, 'no default matched; inspect the compiled param() calls'
    pathlib.Path(f'packages/plugin/dist/harness-publish-{name}.html').write_text(out)
for name, publish, plan in [('idle-free','idle','free'), ('published-pro','published','pro'),
                            ('published-free','published','free'), ('idonly','idOnly','pro'),
                            ('unrecorded','unrecorded','pro'), ('error','error','free')]:
    variant(name, publish, plan)
EOF
```

If the compiled form differs (esbuild may emit `param("view","component")` with different quoting), inspect with `python3 -c "import re,pathlib;s=pathlib.Path('packages/plugin/dist/ui-harness.html').read_text();print(re.findall(r'.{30}\"component\".{30}', s)[:3])"` and adjust the replace strings.

Open each file in a new browser tab (`tabs_create`, then `navigate` to the file path), screenshot, and check: the status block rows match the spec table; the docs link sits under the copy row; Rotate key is on its own line with its hint; nothing overflows at 480px; both themes read (toggle `#sl-header-theme`).

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/ui/harness.ts
git commit -m "chore(plugin): harness fixtures for the publish status block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs, changelog, test matrix

**Files:**
- Modify: `CHANGELOG.md` (Unreleased, Added and Changed)
- Modify: `packages/plugin/TESTING.md:319-321, 364-367, 372-378`
- Modify: `docs/plugin-knowledge-map.md:64-69`
- Modify: `docs/superpowers/specs/2026-09-08-publish-screen-status-design.md:4` (status line)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` → `### Added`, after the free publishing entry, add:

```markdown
- **Publish screen status block.** The Publish for developers screen opens
  with a label-and-value list: `Not published yet`, or the last publish date
  and time in local time with the library id, plus the free plan's updates
  row. The date is stored in the file beside the library id, so every editor
  sees it in every session; a library published by an earlier build reads
  `Not recorded` until its next publish. The Developer setup group links to
  the CLI reference at `spec-layer.com/docs/cli/` and puts Rotate key on its
  own row under it, apart from the two copy buttons.
```

Under `### Changed` (create it under Unreleased if absent) add:

```markdown
- The publish screen's definition caption and free-updates caption are folded
  into the status block, and "What gets published" is one sentence shorter.
```

- [ ] **Step 2: TESTING.md**

Row at line 319 (Pro publish): append to the sentence ending "shows the setup command." the words `, a Last published row with the local date and time, and the library id`.

Row at line 364 (Second device): after "and only **Rotate key**." add `The Last published row shows the same date the first device saw.`

Row at line 372 (Free plan): change `with the definition line and "10 of 10 free updates left this month"` to `with "Not published yet" and a Free updates row reading "10 of 10 left this month"`, and `the meter still shows 9` / `the meter shows 8` to `the Free updates row still shows 9` / `the Free updates row shows 8`.

Add a new row after the Gone library row:

```markdown
- [ ] Recorded date: publish, close the plugin, reopen it and open Publish. The
      Last published row shows the publish time without a new publish. The
      **CLI documentation** link opens spec-layer.com/docs/cli/ in the
      browser.
```

- [ ] **Step 3: Knowledge map and spec status**

In `docs/plugin-knowledge-map.md` lines 64-69, add one sentence to the publish paragraph: "It opens with a status block (last published, library id, free updates) whose date the main thread stores in root plugin data under `speclayer.publish.publishedAt`."

In the spec, change `Status: approved, not yet implemented` to `Status: implemented on \`feat/publish-screen-status\`, 2026-09-08`.

- [ ] **Step 4: Full gate**

Run: `npm run check`
Expected: lint, typecheck, NUL scan, tests, plugin build (with the brand contrast gate), CLI build and smoke, sandbox scan, proxy dry run all pass. Read the exit status directly; do not pipe it.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md packages/plugin/TESTING.md docs/plugin-knowledge-map.md docs/superpowers/specs/2026-09-08-publish-screen-status-design.md
git commit -m "docs: record the publish screen status block in the changelog, matrix and map

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** Status block rows: Task 4. Date formatting: Task 1. Stored date, message, main thread: Task 2. Controller seeding, fallback, sending, gone: Task 3. Docs link and constant: Task 4. Rotate row: Task 4. CSS sharing and removals: Task 4. Harness fixtures: Task 5. TESTING rows, CHANGELOG: Task 6. Out-of-scope items untouched.
- **Types.** `formatPublishedAt(iso, locale?) => string | null` (Task 1) is what Task 4 calls. `PublishInfo.publishedAt` (Task 2) is what Task 3 reads and Task 3's tests set. `setPublishedAt { libraryId, publishedAt }` matches between Task 2 and Task 3. `publishScrollMarkup(state, allowance, locale?)` matches Task 4's implementation and tests; `renderPublishScreen` passes two arguments and gets the user's locale.
- **Placeholders.** None; every step carries its code.

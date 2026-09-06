# Website Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the live `spec-layer.com` deployment and policy pages (Phase 1), then stand up a documentation site under `/docs/` with its first pages built from text the repository already has (Phase 2).

**Architecture:** The landing stays a hand-written static folder in `apps/landing/`. A new standalone Astro Starlight project in `apps/docs/` (its own `package.json` and lockfile, not an npm workspace, so the root audit and toolchain stay untouched) renders Markdown to `apps/docs/dist/`. A root script assembles `dist/site/` from the landing files plus the docs build under `docs/`, a link checker runs over the result, and that single directory is what `wrangler pages deploy` uploads. Reference pages that already exist as repository documents (the CLI README, the two v5 specs, the status document) are synced into the docs content directory at build time so they cannot drift.

**Tech Stack:** Static HTML, Node 22 scripts (`.mjs`), Vitest, Astro + Starlight, Cloudflare Pages via `wrangler`.

**Source spec:** `docs/reviews/2026-09-06-website-review-and-docs-plan.md`. Section numbers below refer to it.

## Global Constraints

- Work on branch `worktree-website-rebuild` in the worktree `.claude/worktrees/website-rebuild`. Never commit in the shared checkout; another agent owns `library-semantic-diff` there.
- Node `>= 22`. npm workspaces are `packages/*` only; do not add `apps/docs` to `workspaces`.
- All site and docs copy follows `docs/plugin-voice-and-copy.md`: sentence case, second person, no hype words, honest about limits, **no em dashes in body copy**. The one legacy exception is the `Page — Spec Layer` separator in the `<title>` of the existing policy pages; new static pages copy that title pattern for consistency and nothing else may contain the character `—`.
- **Never fabricate.** Every factual claim on a page must be traceable to a repository source named in the review's section 5. Do not claim `spec-layer check`, `validate`, `normalize`, `diff`, real-design-system grading, a verified plugin build, `code_syntax` in pulled sidecars, or a test count.
- `apps/landing/schemas/**` must stay byte-identical to `packages/extractor/src/v5/schema/*.json`. This plan never edits either.
- Single-line conventional commits, lowercase, scoped: `fix(landing): ...`, `feat(docs): ...`, `docs: ...`, `chore(site): ...`. End every commit message with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line after a blank line.
- `CHANGELOG.md` is updated in the same commit as the behaviour change it describes.
- Every `npm run` in this plan is executed from the worktree root unless a `--prefix` is shown.
- Deploying to Cloudflare Pages is an outward-facing action that needs the user's `wrangler` login. Tasks that deploy stop and hand the command to the user; they never run it unattended.
- The support address used on the site today is `oleksandr.kurchev@gmail.com`. Decision 5 in the review (a domain address) is open. This plan keeps the current address; changing it is a one-line edit per page later.

---

## Phase 1: fix what is live

### Task 1: Add a real 404 page

**Files:**
- Create: `apps/landing/404.html`

**Interfaces:**
- Produces: a root `404.html` that Cloudflare Pages serves for any unmatched path. Task 4's live check asserts that a missing path returns HTTP 404.

- [ ] **Step 1: Create the page, mirroring the policy pages' shell**

Copy the `<style>` block verbatim from `apps/landing/security.html` lines 10 to 31 into the file below where indicated. The rest is new.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — Spec Layer</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>
  /* paste the <style> contents of security.html here, unchanged */
</style>
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/"><img src="/logo.svg" alt="Spec Layer">Spec Layer</a>
  </div>
</header>
<main>
  <div class="wrap">
    <h1>Page not found</h1>
    <p class="meta">HTTP 404</p>
    <p>
      There is no page at this address. The link may be out of date, or the
      address may have a typo.
    </p>
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/docs/">Documentation</a></li>
      <li><a href="/schemas/foundation-context/v5.json">Foundation Context v5 schema</a></li>
      <li><a href="/schemas/component-context/v5.json">Component Context v5 schema</a></li>
      <li><a href="mailto:oleksandr.kurchev@gmail.com">Support</a></li>
    </ul>
  </div>
</main>
<footer>
  <div class="wrap">
    <nav>
      <a href="/">Home</a>
      <a href="/terms.html">Terms of Service</a>
      <a href="/refund.html">Refund Policy</a>
      <a href="/privacy.html">Privacy Policy</a>
      <a href="/security.html">Security</a>
      <a href="mailto:oleksandr.kurchev@gmail.com">Support</a>
    </nav>
    <p class="small">Payments are handled by Lemon Squeezy as merchant of record.</p>
  </div>
</footer>
</body>
</html>
```

The `<title>` uses the same `—` separator the other four policy pages use in their titles. That is the one existing exception to the no-em-dash rule on this site, and the page copies it for consistency; the body text has none. All hrefs are root-relative because Pages serves this file for paths at any depth, including under `/docs/`.

Note: the `/docs/` link is live only after Phase 2 deploys. Until then it resolves to this same 404 page, which is correct behaviour for a path that does not yet exist.

- [ ] **Step 2: Verify locally**

Run:

```bash
npx -y http-server apps/landing -p 4620 -c-1 -s & sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4620/404.html; kill %1
```

Expected: `200`, and the file opens in a browser with the same header, footer, and dark theme as `security.html`.

- [ ] **Step 3: Check for stray em dashes in the body**

Run:

```bash
grep -c "—" apps/landing/404.html
```

Expected: `1` (the title only).

- [ ] **Step 4: Commit**

```bash
git add apps/landing/404.html
git commit -m "fix(landing): add a 404 page so missing paths stop returning the home page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Remove unreferenced landing assets

**Files:**
- Delete: `apps/landing/1.png`, `apps/landing/2.png`, `apps/landing/3.png`, `apps/landing/4.png`, `apps/landing/demo.mp4`, `apps/landing/demo-poster.jpg`
- Modify: `.gitignore` (the comment block about `screenshots/*.mp4`)

- [ ] **Step 1: Prove nothing references them**

Run:

```bash
grep -rn "demo.mp4\|demo-poster\|landing/1.png\|landing/2.png\|landing/3.png\|landing/4.png\|\"1.png\|\"2.png\|\"3.png\|\"4.png" --include=*.html --include=*.md --include=*.ts --include=*.mjs --include=*.json . 2>/dev/null | grep -v node_modules | grep -v "^./project-docs" | grep -v "^./docs/reviews/2026-09-06"
```

Expected: only the `.gitignore` comment line mentioning `apps/landing/demo.mp4`. If any other live file references one of these assets, stop and report instead of deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm -q apps/landing/1.png apps/landing/2.png apps/landing/3.png apps/landing/4.png apps/landing/demo.mp4 apps/landing/demo-poster.jpg
```

- [ ] **Step 3: Fix the now-false comment in `.gitignore`**

Replace the three-line comment block that ends with `# (apps/landing/demo.mp4 IS tracked; the landing page needs it to deploy.)` with:

```gitignore
# Screen recordings and marketing video source: tens of MB each, and git can
# never forget a blob once it lands. These are working files, not shipped assets.
```

- [ ] **Step 4: Confirm the landing still previews with every referenced asset present**

Run:

```bash
for f in $(grep -o 'src="[^"]*"' apps/landing/index.html | sed 's/src="//;s/"//' | sort -u); do test -f "apps/landing/$f" && echo "ok $f" || echo "MISSING $f"; done
```

Expected: six `ok` lines, no `MISSING`.

- [ ] **Step 5: Commit**

```bash
git add -A apps/landing .gitignore
git commit -m "chore(landing): drop 5.8 MB of assets the page no longer references" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Bring the policy pages up to date with publishing and the CLI

**Files:**
- Modify: `apps/landing/privacy.html:43` (date), `apps/landing/privacy.html:57-58` (new list item), `apps/landing/privacy.html:127-135` (retention)
- Modify: `apps/landing/terms.html:43` (date), `apps/landing/terms.html:57-64` (the service)
- Modify: `apps/landing/security.html:42` (date), `apps/landing/security.html:73-84` (scope)

Facts these edits state, with their sources: bundles are stored in Cloudflare KV with no expiry until overwritten by the next publish (`packages/proxy/src/libraries.ts:25-37`, `packages/proxy/README.md:128-135`); pull keys are stored only as SHA-256 digests (`libraries.ts:149,165`); the bundle contains component and token facts, names, and descriptions (`packages/extractor/src/libraryBundle.ts`); publishing needs Pro (`libraries.ts:52-60`); the CLI has zero runtime dependencies and never talks to Figma (`packages/cli/README.md:7-9`).

- [ ] **Step 1: Privacy, add the published-library item to "What we collect"**

Insert after the `<ul>` on line 58, before the existing first `<li>`:

```html
      <li>
        <strong>Libraries you publish.</strong> When you use Publish for developers
        (a Pro feature), the plugin uploads a bundle containing the component and
        token facts of your connected documents: names, descriptions, variants,
        properties, token bindings, and resolved values, plus any AI-written text
        already on the canvas. Our proxy stores that bundle so the developers you
        share the pull key with can fetch it with the spec-layer CLI. The pull key
        itself is stored only as a SHA-256 digest; the plain key is shown once, to
        you, in the plugin.
      </li>
```

- [ ] **Step 2: Privacy, correct the retention paragraph**

Replace the paragraph at lines 128 to 135 with:

```html
    <p>
      We keep license and usage records for as long as your subscription is active and
      for a reasonable period afterwards to meet legal and accounting obligations.
      For AI writing, our proxy does not persist submitted component summaries,
      rendered images, or token values. It may retain the generated response for up
      to 24 hours for idempotent retries. Anthropic's standard API retention is
      described in the AI processing section above.
    </p>
    <p>
      A published library bundle is different: it is stored until you publish a
      newer version, which replaces it, and it is not deleted automatically when
      your subscription ends. There is no self-service unpublish yet. To have a
      library removed, email
      <a href="mailto:oleksandr.kurchev@gmail.com">oleksandr.kurchev@gmail.com</a>
      with the library id shown on the plugin's Publish screen.
    </p>
```

- [ ] **Step 3: Privacy, bump the date**

Line 43: `<p class="meta">Last updated 6 September 2026</p>`

- [ ] **Step 4: Terms, describe the whole service**

Replace lines 58 to 64 with:

```html
    <p>
      Spec Layer reads the components, variables, and styles in your Figma file and
      generates documentation frames on your canvas, including measurements, states,
      anatomy, tokens, and optional AI-written usage notes. It can also copy the same
      facts to your clipboard as structured context for a coding agent, and, on the
      Pro plan, publish a library so developers can pull it into a repository with
      the spec-layer command-line tool. That tool is distributed on npm under the MIT
      licence and is covered by these terms when it talks to our service. A free
      tier is available with no account and a limited AI allowance. A paid Pro
      subscription removes the fixed monthly AI cap for normal individual use and
      enables publishing, subject to the fair-use terms below.
    </p>
```

Line 43: `<p class="meta">Last updated 6 September 2026</p>`

- [ ] **Step 5: Security, widen the scope sentence**

Replace the first sentence of the Scope paragraph (line 75, `This policy covers the Spec Layer Figma plugin and the backend it talks to.`) with:

```html
      This policy covers the Spec Layer Figma plugin, the spec-layer command-line
      tool, the backend they talk to, and the library store that holds published
      bundles.
```

Line 42: `<p class="meta">Last updated 6 September 2026</p>`

- [ ] **Step 6: Verify no em dashes were introduced and the HTML still parses**

Run:

```bash
grep -c "—" apps/landing/privacy.html apps/landing/terms.html apps/landing/security.html; for f in privacy terms security; do python3 -c "import html.parser,sys; p=html.parser.HTMLParser(); p.feed(open('apps/landing/$f.html').read()); print('parsed $f')"; done
```

Expected: each grep count is `1` (the `<title>` only, unchanged), and three `parsed` lines.

- [ ] **Step 7: CHANGELOG**

Under `## [Unreleased]`, add a `### Fixed` section if none exists, with:

```markdown
- The privacy policy now discloses that a published library bundle is stored
  until the next publish replaces it, and how to ask for its removal. The
  terms and security pages name the spec-layer CLI and the library store.
```

- [ ] **Step 8: Commit**

```bash
git add apps/landing/privacy.html apps/landing/terms.html apps/landing/security.html CHANGELOG.md
git commit -m "fix(landing): disclose stored library bundles in the policy pages" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: A live-site check script

**Files:**
- Create: `scripts/site/live.mjs` (pure evaluation)
- Create: `scripts/site/live.test.ts`
- Create: `scripts/check-landing-live.mjs` (network runner)
- Modify: `vitest.config.ts` (include `scripts/**/*.test.ts`)
- Modify: `package.json` (add `check:landing-live`)

**Interfaces:**
- Produces: `evaluateSchema({ url, status, contentType, body, expected })` returning `string[]` of problems (empty means pass); `evaluateNotFound({ url, status })` returning `string[]`; npm script `check:landing-live [--base https://host]` exiting 1 on any problem. Task 7 and the landing README rely on the npm script name.

- [ ] **Step 1: Widen Vitest to see script tests**

In `vitest.config.ts` change the include line to:

```ts
    include: ['packages/**/test/**/*.test.ts', 'scripts/**/*.test.ts'],
```

- [ ] **Step 2: Write the failing test**

Create `scripts/site/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateSchema, evaluateNotFound } from './live.mjs';

const url = 'https://spec-layer.com/schemas/foundation-context/v5.json';
const expected = '{"$id":"https://spec-layer.com/schemas/foundation-context/v5.json"}';

describe('evaluateSchema', () => {
  it('passes when status, type, and bytes all match the committed file', () => {
    expect(
      evaluateSchema({ url, status: 200, contentType: 'application/json', body: expected, expected }),
    ).toEqual([]);
  });

  it('reports an HTML body, which is what the index.html fallback returns', () => {
    const problems = evaluateSchema({
      url,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html></html>',
      expected,
    });
    expect(problems).toContain(`${url}: content-type is text/html; charset=utf-8, expected application/json`);
    expect(problems).toContain(`${url}: body differs from the committed schema`);
  });

  it('reports a stale body even when the type is right', () => {
    const problems = evaluateSchema({
      url,
      status: 200,
      contentType: 'application/json',
      body: '{"$id":"https://spec-layer.com/schemas/foundation-context/v5.json","old":true}',
      expected,
    });
    expect(problems).toEqual([`${url}: body differs from the committed schema`]);
  });

  it('reports a non-200 status', () => {
    expect(evaluateSchema({ url, status: 404, contentType: 'text/html', body: '', expected })).toContain(
      `${url}: HTTP 404, expected 200`,
    );
  });
});

describe('evaluateNotFound', () => {
  it('passes on 404', () => {
    expect(evaluateNotFound({ url: 'https://spec-layer.com/no-such-page', status: 404 })).toEqual([]);
  });

  it('reports a 200, which means the index.html fallback is masking a missing file', () => {
    expect(evaluateNotFound({ url: 'https://spec-layer.com/no-such-page', status: 200 })).toEqual([
      'https://spec-layer.com/no-such-page: HTTP 200, expected 404 (no 404.html deployed?)',
    ]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run scripts/site/live.test.ts`
Expected: FAIL, cannot resolve `./live.mjs`.

- [ ] **Step 4: Implement the pure module**

Create `scripts/site/live.mjs`:

```js
/**
 * Pure checks for the live landing deployment. No network here; the runner in
 * scripts/check-landing-live.mjs fetches and hands the results to these.
 *
 * Why this exists: on 2026-09-06 the custom domain served index.html for the
 * component schema URL (Pages falls back to index.html when a file is missing
 * and there is no 404.html) and a pre-5.1.0 body for the foundation schema.
 * Both returned HTTP 200, so a status check alone would have passed.
 */

/**
 * @param {{ url: string, status: number, contentType: string, body: string, expected: string }} r
 * @returns {string[]} problems, empty when the live response is the committed file
 */
export function evaluateSchema({ url, status, contentType, body, expected }) {
  const problems = [];
  if (status !== 200) problems.push(`${url}: HTTP ${status}, expected 200`);
  const type = (contentType || '').split(';')[0].trim();
  if (type !== 'application/json') {
    problems.push(`${url}: content-type is ${contentType}, expected application/json`);
  }
  if (body !== expected) problems.push(`${url}: body differs from the committed schema`);
  return problems;
}

/**
 * @param {{ url: string, status: number }} r
 * @returns {string[]}
 */
export function evaluateNotFound({ url, status }) {
  if (status === 404) return [];
  return [`${url}: HTTP ${status}, expected 404 (no 404.html deployed?)`];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/site/live.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Write the network runner**

Create `scripts/check-landing-live.mjs`:

```js
#!/usr/bin/env node
/**
 * check-landing-live.mjs: fetch the deployed landing site and confirm that the
 * two permanent schema URLs serve the committed bytes and that a missing path
 * returns 404. Exit 1 on any problem. Usage:
 *
 *   node scripts/check-landing-live.mjs                      # spec-layer.com
 *   node scripts/check-landing-live.mjs --base https://speclayer-landing.pages.dev
 *
 * This is the release gate described in apps/landing/README.md, made
 * executable. A passing pages.dev run is not a substitute for the custom
 * domain; run it against both.
 */
import { readFileSync } from 'node:fs';
import { evaluateSchema, evaluateNotFound } from './site/live.mjs';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = (baseIndex === -1 ? 'https://spec-layer.com' : args[baseIndex + 1]).replace(/\/$/, '');

const SCHEMAS = [
  ['/schemas/foundation-context/v5.json', 'apps/landing/schemas/foundation-context/v5.json'],
  ['/schemas/component-context/v5.json', 'apps/landing/schemas/component-context/v5.json'],
];
const MISSING_PATH = '/this-path-must-not-exist-' + Date.now();

async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { url, status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text() };
  } catch (err) {
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    return { url, status: 0, contentType: '', body: '', error: `${url}: could not be fetched (${reason})` };
  }
}

const problems = [];
for (const [path, committed] of SCHEMAS) {
  const live = await fetchText(base + path);
  if (live.error) { problems.push(live.error); continue; }
  problems.push(...evaluateSchema({ ...live, expected: readFileSync(committed, 'utf8') }));
}
const missing = await fetchText(base + MISSING_PATH);
if (missing.error) problems.push(missing.error);
else problems.push(...evaluateNotFound({ url: missing.url, status: missing.status }));

if (problems.length > 0) {
  console.error(`Live check against ${base} failed:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Live check against ${base} passed: both schemas match the committed files and a missing path returns 404.`);
```

- [ ] **Step 7: Add the npm script**

In the root `package.json` `scripts` block add, after `"check:proxy-dry-run"`:

```json
    "check:landing-live": "node scripts/check-landing-live.mjs"
```

Do not add it to `check` or `check:ci`; it needs the network and a deployed site.

- [ ] **Step 8: Run it against the current live site to see it fail for the right reasons**

Run: `npm run check:landing-live`
Expected: exit 1, with at least these lines: the component schema `content-type is text/html`, the component schema `body differs`, the foundation schema `body differs`, and the missing path `HTTP 200, expected 404`. This is the baseline Task 7 fixes.

- [ ] **Step 9: Lint and the full local gate**

Run: `npm run lint && npm test`
Expected: lint clean, all tests pass including the six new ones.

- [ ] **Step 10: Commit**

```bash
git add scripts/site/live.mjs scripts/site/live.test.ts scripts/check-landing-live.mjs vitest.config.ts package.json
git commit -m "chore(site): add an executable live check for the schema URLs and 404" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Widen the NUL-byte scan to `apps/` and `docs/`

**Files:**
- Modify: `scripts/check-nul-bytes.mjs` (`SOURCE_ROOTS`, `TEXT_EXTENSIONS`, header comment)

The header comment currently says the scan "deliberately excludes `docs/`, `apps/`". The NUL trap has bitten plan documents under `docs/` three times, and Phase 2 puts Markdown under `apps/docs/`. Widening is the fix.

- [ ] **Step 1: Widen the constants**

```js
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.html', '.yml', '.yaml',
  '.md', '.mdx', '.toml', '.svg',
]);
```

```js
const SOURCE_ROOTS = ['packages/', 'scripts/', 'apps/', 'docs/'];
const SOURCE_FILES = new Set(['package.json', 'README.md', 'ARCHITECTURE.md', 'CLAUDE.md', 'CHANGELOG.md', 'SECURITY.md']);
```

- [ ] **Step 2: Rewrite the scope paragraph of the header comment**

Replace the paragraph beginning `Scope is deliberately narrow:` with:

```
 * Scope: git-tracked text files under the npm workspaces (`packages/`), this
 * repo's own tooling (`scripts/`), the static site and docs (`apps/`), and the
 * prose tree (`docs/`), plus the root package.json and top-level Markdown. The
 * prose trees were excluded at first and the trap bit plan documents there
 * three times, so they are in. Extensions are an allowlist rather than a
 * blacklist: the repo tracks legitimate binary assets (png, jpg) that contain
 * NUL bytes as a normal part of their format, and those must never be scanned
 * regardless of location.
```

- [ ] **Step 3: Run the scan**

Run: `npm run check:nul`
Expected: exit 0. If it lists an offender under `docs/` or `apps/`, open the file at the reported byte, remove the control character, and rerun. Report each such fix in the commit body.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-nul-bytes.mjs
git commit -m "chore: scan apps and docs for NUL bytes too" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: A support page, and the landing README's release steps

**Files:**
- Create: `apps/landing/support.html`
- Modify: `apps/landing/index.html:471` (footer Support link target)
- Modify: `apps/landing/README.md:17-47` (deploy section)

The plugin's Contact support button and the world icon both open `/` (`packages/plugin/src/ui/proxy.ts:8,19`). Until a plugin release points them at `/support.html`, this page is where the footer Support link goes and where the review's decision 4 lands.

- [ ] **Step 1: Create `apps/landing/support.html`**

Same shell as Task 1 (paste the `security.html` `<style>` block). Body:

```html
<main>
  <div class="wrap">
    <h1>Support</h1>
    <p class="meta">Last updated 6 September 2026</p>
    <p>
      Spec Layer is maintained by an independent developer. Email
      <a href="mailto:oleksandr.kurchev@gmail.com">oleksandr.kurchev@gmail.com</a>
      and expect a reply within a few business days.
    </p>
    <h2>Before you write</h2>
    <ul>
      <li>
        <strong>License key not accepted.</strong> The plugin's License screen tells
        you whether the key is invalid, expired, disabled, or already active on the
        maximum number of devices. For the device limit, free a device in
        <a href="https://app.lemonsqueezy.com/my-orders" target="_blank" rel="noopener">Manage subscription</a>
        and try again. If the screen says verification is temporarily unavailable,
        your plan has not changed; try again in a minute.
      </li>
      <li>
        <strong>AI writing did not run.</strong> The frame is still created; AI
        sections carry a placeholder. The License screen shows your remaining free
        uses. Failed calls do not count against them.
      </li>
      <li>
        <strong>Publishing failed.</strong> The Publish screen names the reason:
        a Pro license is needed, the library is over the 5 MB limit, the license
        already publishes 10 libraries, or a source component could not be read.
        Nothing partial is published.
      </li>
      <li>
        <strong>The pull key was rotated.</strong> Developers get a message from the
        CLI naming the fix: run the new setup command copied from the plugin's
        Publish screen.
      </li>
      <li>
        <strong>Refunds.</strong> Within 30 days, for any reason. See the
        <a href="refund.html">Refund Policy</a>.
      </li>
    </ul>
    <h2>What to include</h2>
    <ul>
      <li>Which screen you were on and what you clicked.</li>
      <li>The exact message the plugin showed, if any.</li>
      <li>Your Lemon Squeezy order number for billing questions, never your license key.</li>
    </ul>
    <p>
      Please do not send private design files. If a problem depends on a specific
      component, a description of its structure is enough to start with.
    </p>
    <h2>Security</h2>
    <p>
      To report a vulnerability, follow the <a href="security.html">responsible
      disclosure policy</a> instead of this address.
    </p>
  </div>
</main>
```

Every claim above has a source in the review's section 5.1 and 5.2 (License screen states, placeholders on AI failure, publish error copy, the CLI's 401 message, the refund policy). Use the same `<header>` and `<footer>` as `security.html`, with `<title>Support — Spec Layer</title>` and a description meta of `How to get help with the Spec Layer Figma plugin and CLI.`

- [ ] **Step 2: Point the landing footer's Support link at the page**

In `apps/landing/index.html`, the footer `<nav>` line `<a href="mailto:oleksandr.kurchev@gmail.com">Support</a>` becomes `<a href="support.html">Support</a>`. Leave the FAQ refund answer's mailto alone.

- [ ] **Step 3: Rewrite the landing README's deploy section**

Replace everything from `## Deploy (Cloudflare Pages)` up to (not including) `## Checkout links` with:

````markdown
## Deploy (Cloudflare Pages)

```sh
npx wrangler pages deploy apps/landing --project-name speclayer-landing
```

(After Phase 2 of `docs/superpowers/plans/2026-09-06-website-update.md` lands,
the deploy directory becomes `dist/site`; see that plan.)

First run creates the project and prints the `*.pages.dev` URL.
`spec-layer.com` is attached as the custom domain.

`404.html` is served for every unmatched path. Without it, Pages falls back to
`index.html` with HTTP 200, which on 2026-09-06 hid a missing schema file for
days.

The v5 schemas are committed at
`apps/landing/schemas/foundation-context/v5.json` and
`apps/landing/schemas/component-context/v5.json`. Their permanent public URIs
are:

```text
https://spec-layer.com/schemas/foundation-context/v5.json
https://spec-layer.com/schemas/component-context/v5.json
```

A successful Pages upload does not by itself prove that either permanent URI
works. After every deploy, and before any release that publishes or relies on
v5 artifacts, run the live check against both hosts:

```sh
npm run check:landing-live
npm run check:landing-live -- --base https://speclayer-landing.pages.dev
```

It fetches both URIs, compares the bytes with the committed files, checks the
content type, and confirms a missing path returns 404. Any failure is a release
blocker. The `*.pages.dev` preview is useful for staging, but the custom domain
is what artifacts point at, so the first command is the one that counts.
````

- [ ] **Step 4: Verify and commit**

Run: `grep -c "—" apps/landing/support.html` (expected `1`, the title) and `npm run check:nul` (expected exit 0).

```bash
git add apps/landing/support.html apps/landing/index.html apps/landing/README.md
git commit -m "feat(landing): add a support page and make the live check part of the release steps" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Deploy and verify (user runs the deploy)

**Files:** none changed.

- [ ] **Step 1: Confirm the branch is what will be deployed**

Run: `git status --short` (expected empty) and `git log --oneline -6` (expected: the six commits from Tasks 1 to 6).

- [ ] **Step 2: Hand the deploy to the user**

Stop and give the user this command to run from the worktree root. Do not run it yourself; it needs their Cloudflare login and publishes to the public site.

```bash
npx wrangler pages deploy apps/landing --project-name speclayer-landing
```

- [ ] **Step 3: After the user confirms the deploy, run the live check on both hosts**

Run:

```bash
npm run check:landing-live && npm run check:landing-live -- --base https://speclayer-landing.pages.dev
```

Expected: both print `Live check ... passed`. If the custom domain still fails while `pages.dev` passes, Cloudflare's edge cache is serving the old schema; wait a few minutes and rerun before investigating further. Report the actual output either way.

- [ ] **Step 4: Spot-check the new pages by hand**

Run:

```bash
for p in /404.html /support.html /privacy.html /no-such-path; do printf "%-16s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://spec-layer.com$p"; done
```

Expected: `200`, `200`, `200`, `404`.

### Task 8: Correct repository text that disagrees with the shipped product

**Files:**
- Modify: `README.md:123`
- Modify: `ARCHITECTURE.md:148`, `ARCHITECTURE.md:191-195`
- Modify: `CLAUDE.md:24-29` (layout table), `CLAUDE.md:172` (open item 2)
- Modify: `docs/plugin-voice-and-copy.md:61`, `docs/plugin-voice-and-copy.md:83`
- Modify: `packages/plugin/TESTING.md:60`, `packages/plugin/TESTING.md:346`
- Modify: `packages/proxy/README.md:39-44`
- Modify: `packages/cli/package.json:26`

Conflict note: `CLAUDE.md`, `packages/plugin/TESTING.md`, and `packages/cli/package.json` may also be touched by the `library-semantic-diff` branch. Each edit here is one line, so a rebase conflict is trivial to resolve; if a conflict does appear, keep both sides.

- [ ] **Step 1: README.md, `show` prints the DTCG document**

Line 123 becomes:

```markdown
| `show foundation` / `show component NAME` | Prints the Foundation's DTCG resolver document or one component's AI YAML, or the canonical JSON with `--canonical`. | no |
```

- [ ] **Step 2: ARCHITECTURE.md, the CLI section**

Line 148: replace `Five commands:` with `Six commands:` and make sure `setup` is listed first in the list that follows with the text: `` `setup` writes `speclayer.json`, stores the pull key in a gitignored `speclayer.local.json` at mode 0600 after confirming git ignores it, and pulls. ``

Lines 191 to 195: replace the paragraph beginning `The pull key is never written to disk` with:

```markdown
The pull key resolves `--key`, then `SPEC_LAYER_KEY`, then the stored
`speclayer.local.json` beside `speclayer.json`, which `setup` writes at mode
0600 only after `git check-ignore` confirms git ignores it. The plugin's Publish
screen copies `npx spec-layer setup --id <libraryId> --key <pullKey>`; the key
appears in the clear only there. Earlier versions documented the key as never
written to disk; `CHANGELOG.md` records why that was reversed.
```

- [ ] **Step 3: CLAUDE.md**

Insert after line 26 (`packages/proxy/`):

```text
packages/cli/          spec-layer CLI: setup, pull, status; delivery only, no extraction
```

Line 172: replace `The plugin republish and the npm publish of CLI 0.4.0 are both still pending.` with `CLI 0.4.0 is on npm (latest, 2026-09-05); the plugin republish is still pending.`

- [ ] **Step 4: docs/plugin-voice-and-copy.md**

Line 61: `| Selected component | \`Copy for AI\` | \`Create docs\` |`

Line 83: ``- Upgrade button: `Upgrade to Pro` (the plugin never states a price; the site does)``

- [ ] **Step 5: packages/plugin/TESTING.md**

Line 60: replace `` `<Name>: Guidelines` `` with `` `<Name>: Documentation` ``.

Line 346: remove the word `Reset,` from the list (there is no Reset control in `screens/settings.ts`).

- [ ] **Step 6: packages/proxy/README.md, the missing route**

Insert after the `POST /v1/license/activate` block (after line 43):

```markdown
### `POST /v1/license/deactivate`

Body: `{ "key": "...", "instanceId": "..." }` → `{ deactivated: boolean }`
(proxies Lemon Squeezy's deactivate endpoint and frees the device slot the
plugin's Remove key action releases). 400 on a missing key or instanceId,
429 under the license rate limit, 502 when Lemon Squeezy is unreachable.
```

Source: `packages/proxy/src/handlers.ts:314-330` and `packages/proxy/src/license.ts:163-171`.

- [ ] **Step 7: packages/cli/package.json, the repository URL**

Line 26: `"url": "git+https://github.com/sandroleks/spec-layer.git",`

- [ ] **Step 8: Gate and commit**

Run: `npm run check:nul && npm run lint && npm run typecheck`
Expected: exit 0 for all three.

```bash
git add README.md ARCHITECTURE.md CLAUDE.md docs/plugin-voice-and-copy.md packages/plugin/TESTING.md packages/proxy/README.md packages/cli/package.json
git commit -m "docs: correct repository text that drifted from the shipped CLI and plugin" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Phase 1 ends here. Open a pull request from `worktree-website-rebuild` to `main` titled `fix(landing): 404, policies, support page, live check` so CI runs; Phase 2 continues on the same branch after it merges, or on a fresh worktree branch from `main`.

---

## Phase 2: the documentation scaffold

### Task 9: Scaffold `apps/docs` with Astro Starlight

**Files:**
- Create: `apps/docs/package.json`, `apps/docs/astro.config.mjs`, `apps/docs/tsconfig.json`, `apps/docs/src/content.config.ts`, `apps/docs/.gitignore`, `apps/docs/README.md`
- Create: `apps/docs/src/content/docs/index.md` (placeholder overview replaced in Task 11)

**Interfaces:**
- Produces: `npm run build --prefix apps/docs` writes `apps/docs/dist/` whose files are meant to be served under `/docs/` (Astro's `base`). Task 12 copies that directory into `dist/site/docs/`.

- [ ] **Step 1: Create `apps/docs/package.json`**

```json
{
  "name": "spec-layer-docs",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "sync": "node scripts/sync-sources.mjs",
    "dev": "npm run sync && astro dev",
    "build": "npm run sync && astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/starlight": "latest",
    "astro": "latest"
  }
}
```

`latest` is a bootstrap value only. After Step 6 installs, replace both with the exact versions `npm ls --prefix apps/docs --depth=0` reports, prefixed with `^`, and commit the lockfile. The pin is what CI reproduces.

- [ ] **Step 2: Create `apps/docs/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://spec-layer.com',
  base: '/docs',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Spec Layer docs',
      description: 'How the Spec Layer Figma plugin and the spec-layer CLI work, and what they produce.',
      logo: { src: './src/assets/logo.svg', alt: 'Spec Layer' },
      favicon: '/logo.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/sandroleks/spec-layer' },
        { icon: 'figma', label: 'Figma Community', href: 'https://www.figma.com/community/plugin/1652104411578396548' },
      ],
      sidebar: [
        { label: 'Start', autogenerate: { directory: 'start' } },
        { label: 'Designer guide', autogenerate: { directory: 'designers' } },
        { label: 'Developer guide', autogenerate: { directory: 'developers' } },
        { label: 'How it works', autogenerate: { directory: 'reference' } },
      ],
      editLink: { baseUrl: 'https://github.com/sandroleks/spec-layer/edit/main/apps/docs/' },
      lastUpdated: false,
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
```

If the installed Starlight version rejects the `social` array shape (older releases take an object keyed by icon name), use the shape its error message documents; do not downgrade.

- [ ] **Step 3: Create the content collection config, styles, and logo**

`apps/docs/src/content.config.ts`:

```ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

`apps/docs/src/styles/custom.css`:

```css
/* Match the landing's near-black ground and white accent in dark mode.
   Starlight's own light palette stays for light mode. */
:root[data-theme='dark'] {
  --sl-color-bg: #0a0a0a;
  --sl-color-bg-nav: #0a0a0a;
  --sl-color-bg-sidebar: #0f0f0f;
  --sl-color-hairline: #2b2b2b;
  --sl-color-text-accent: #f5f5f5;
}
```

Copy the logo: `cp apps/landing/logo.svg apps/docs/src/assets/logo.svg` and `cp apps/landing/logo.svg apps/docs/public/logo.svg`.

`apps/docs/tsconfig.json`:

```json
{ "extends": "astro/tsconfigs/strict" }
```

`apps/docs/.gitignore`:

```gitignore
node_modules/
dist/
.astro/
# Generated at build time by scripts/sync-sources.mjs from repository documents.
src/content/docs/developers/cli.md
src/content/docs/reference/foundation-context-v5.md
src/content/docs/reference/component-context-v5.md
src/content/docs/reference/status.md
```

- [ ] **Step 4: Create a first page so the build has content**

`apps/docs/src/content/docs/index.md`:

```markdown
---
title: Spec Layer documentation
description: What the Figma plugin and the spec-layer CLI produce, and how to use them.
---

This site is being assembled. The overview lands in the next commit.
```

- [ ] **Step 5: Create `apps/docs/README.md`**

````markdown
# Spec Layer docs

Astro Starlight site served at `https://spec-layer.com/docs/`. Standalone
package with its own lockfile; deliberately not an npm workspace, so the root
toolchain and `npm audit` are unaffected.

```sh
npm ci --prefix apps/docs
npm run dev --prefix apps/docs      # http://localhost:4321/docs/
npm run build --prefix apps/docs    # apps/docs/dist/
```

`npm run sync` (run automatically by dev and build) regenerates the pages
listed in `.gitignore` from `packages/cli/README.md`, the two v5 specs, and
the status document, so those pages cannot drift from the repository. Edit the
source documents, not the generated files.

Copy rules: `docs/plugin-voice-and-copy.md`. No em dashes. Never claim
something the code does not do; every fact needs a source in the repository.
````

- [ ] **Step 6: Install, pin, build**

Run:

```bash
npm install --prefix apps/docs && npm ls --prefix apps/docs --depth=0
```

Copy the reported `astro` and `@astrojs/starlight` versions into `apps/docs/package.json` with `^`. Then:

```bash
npm run build --prefix apps/docs && ls apps/docs/dist && test -f apps/docs/dist/index.html && echo BUILD_OK
```

Expected: `BUILD_OK`. Note that the sync script does not exist yet, so for this step only, temporarily run `npx --prefix apps/docs astro build` directly if `npm run build` fails on the missing sync script; Task 10 adds it.

- [ ] **Step 7: Commit**

```bash
git add apps/docs
git commit -m "feat(docs): scaffold the Starlight documentation site under /docs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Confirm `git status --short` shows no `apps/docs/dist` or `node_modules`; the `.gitignore` above covers them.

### Task 10: Sync repository documents into the docs at build time

**Files:**
- Create: `scripts/site/markdown.mjs` (pure transform), `scripts/site/markdown.test.ts`
- Create: `apps/docs/scripts/sync-sources.mjs`

**Interfaces:**
- Produces: `toDocPage(markdown, { description, sourcePath, linkMap, repoBlobBase })` returning a Markdown string with Starlight frontmatter; used by the sync script. The sync script writes the four gitignored files listed in Task 9's `.gitignore`.

- [ ] **Step 1: Write the failing test**

`scripts/site/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toDocPage } from './markdown.mjs';

const opts = {
  description: 'The spec-layer command-line tool.',
  sourcePath: 'packages/cli/README.md',
  linkMap: { 'docs/specs/foundation-context-v5.md': '/docs/reference/foundation-context-v5/' },
  repoBlobBase: 'https://github.com/sandroleks/spec-layer/blob/main/',
};

describe('toDocPage', () => {
  it('lifts the first H1 into frontmatter and drops it from the body', () => {
    const out = toDocPage('# spec-layer\n\nIntro line.\n', opts);
    expect(out.startsWith('---\ntitle: spec-layer\ndescription: The spec-layer command-line tool.\n---\n')).toBe(true);
    expect(out).not.toMatch(/^# spec-layer$/m);
    expect(out).toContain('Intro line.');
  });

  it('states where the page comes from', () => {
    const out = toDocPage('# T\n\nBody.\n', opts);
    expect(out).toContain(':::note\nThis page is generated from `packages/cli/README.md`');
  });

  it('rewrites a mapped relative link to its docs page', () => {
    const out = toDocPage('# T\n\nSee [the spec](../../docs/specs/foundation-context-v5.md).\n', opts);
    expect(out).toContain('[the spec](/docs/reference/foundation-context-v5/)');
  });

  it('rewrites an unmapped relative link to the file on GitHub', () => {
    const out = toDocPage('# T\n\nSee [code](src/cli.ts).\n', opts);
    expect(out).toContain('[code](https://github.com/sandroleks/spec-layer/blob/main/packages/cli/src/cli.ts)');
  });

  it('leaves absolute links, anchors, and mailto alone', () => {
    const md = '# T\n\n[a](https://x.y/z) [b](#exit-codes) [c](mailto:x@y.z)\n';
    const out = toDocPage(md, opts);
    expect(out).toContain('[a](https://x.y/z) [b](#exit-codes) [c](mailto:x@y.z)');
  });

  it('escapes a title that contains a colon', () => {
    const out = toDocPage('# Foundation Context v5: contract\n\nx\n', opts);
    expect(out).toContain('title: "Foundation Context v5: contract"');
  });

  it('refuses a document with no H1 rather than inventing a title', () => {
    expect(() => toDocPage('No heading here.\n', opts)).toThrow(/no H1/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/site/markdown.test.ts`
Expected: FAIL, cannot resolve `./markdown.mjs`.

- [ ] **Step 3: Implement**

`scripts/site/markdown.mjs`:

```js
/**
 * Turn a repository Markdown document into a Starlight page: first H1 becomes
 * the frontmatter title, a note names the source, and relative links are
 * rewritten so nothing points at a path that does not exist on the site.
 * Pure: no filesystem access.
 */
import { posix as path } from 'node:path';

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/');
}

function yamlString(value) {
  return /[:#"'\n]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * @param {string} markdown
 * @param {{ description: string, sourcePath: string, linkMap: Record<string,string>, repoBlobBase: string }} opts
 * @returns {string}
 */
export function toDocPage(markdown, { description, sourcePath, linkMap, repoBlobBase }) {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((l) => /^# /.test(l));
  if (h1Index === -1) throw new Error(`${sourcePath}: no H1 to use as the page title`);
  const title = lines[h1Index].slice(2).trim();
  lines.splice(h1Index, 1);

  const sourceDir = path.dirname(sourcePath);
  const body = lines.join('\n').replace(LINK, (whole, text, href) => {
    if (isExternal(href)) return whole;
    const [file, anchor = ''] = href.split('#');
    const resolved = path.normalize(path.join(sourceDir, file));
    const mapped = linkMap[resolved];
    const target = mapped ? mapped + (anchor ? `#${anchor}` : '') : repoBlobBase + resolved + (anchor ? `#${anchor}` : '');
    return `[${text}](${target})`;
  });

  return [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    '---',
    '',
    ':::note',
    `This page is generated from \`${sourcePath}\` in the repository at build time. Edit that file, not this page.`,
    ':::',
    '',
    body.trimStart(),
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/site/markdown.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Write the sync script**

`apps/docs/scripts/sync-sources.mjs`:

```js
#!/usr/bin/env node
// Regenerates the docs pages that mirror repository documents. Run by `npm run
// build` and `npm run dev` in apps/docs. Outputs are gitignored.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDocPage } from '../../../scripts/site/markdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const contentRoot = resolve(here, '../src/content/docs');

const linkMap = {
  'packages/cli/README.md': '/docs/developers/cli/',
  'docs/specs/foundation-context-v5.md': '/docs/reference/foundation-context-v5/',
  'docs/specs/component-context-v5.md': '/docs/reference/component-context-v5/',
  'docs/specs/foundation-v5-status.md': '/docs/reference/status/',
};

const pages = [
  { source: 'packages/cli/README.md', out: 'developers/cli.md', description: 'Every spec-layer command, what it writes, and how the pull key is stored.' },
  { source: 'docs/specs/foundation-context-v5.md', out: 'reference/foundation-context-v5.md', description: 'The Foundation Context v5 artifact contract.' },
  { source: 'docs/specs/component-context-v5.md', out: 'reference/component-context-v5.md', description: 'The Component Context v5 artifact contract.' },
  { source: 'docs/specs/foundation-v5-status.md', out: 'reference/status.md', description: 'What v5 has and has not been graded on, dated.' },
];

for (const page of pages) {
  const markdown = readFileSync(resolve(repoRoot, page.source), 'utf8');
  const doc = toDocPage(markdown, {
    description: page.description,
    sourcePath: page.source,
    linkMap,
    repoBlobBase: 'https://github.com/sandroleks/spec-layer/blob/main/',
  });
  const target = resolve(contentRoot, page.out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, doc);
  console.log(`synced ${page.source} -> apps/docs/src/content/docs/${page.out}`);
}
```

- [ ] **Step 6: Build and inspect**

Run: `npm run build --prefix apps/docs && ls apps/docs/dist/developers/cli apps/docs/dist/reference`
Expected: four synced lines printed, then `index.html` under `developers/cli/` and directories `foundation-context-v5`, `component-context-v5`, `status` under `reference/`. Open `apps/docs/dist/developers/cli/index.html` and confirm the note and the quick-start command render.

If Starlight rejects the spec documents (for example an MDX-unsafe `{` in a code fence is fine, but a raw `<` outside a fence is not), fix the source spec, since the specs are the source of truth, and note the fix in the commit body.

- [ ] **Step 7: Lint, test, commit**

Run: `npm run lint && npm test`

```bash
git add scripts/site/markdown.mjs scripts/site/markdown.test.ts apps/docs/scripts/sync-sources.mjs
git commit -m "feat(docs): generate the CLI and v5 reference pages from repository documents" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: The first hand-written pages

**Files:**
- Modify: `apps/docs/src/content/docs/index.md`
- Create: `apps/docs/src/content/docs/start/designer.md`, `apps/docs/src/content/docs/start/developer.md`, `apps/docs/src/content/docs/developers/tokens.md`

Every sentence below is sourced from the review's section 5. Do not add claims. Where a screenshot would help, leave a plain sentence; screenshots wait for the manual Figma matrix run (Phase 3).

- [ ] **Step 1: Overview, `index.md`**

```markdown
---
title: Spec Layer documentation
description: What the Figma plugin and the spec-layer CLI produce, and how to use them.
---

Spec Layer is a Figma plugin that turns components, variables, and styles into
design-system facts, delivered three ways:

- **On the canvas.** Connected documentation Sections beside your components
  and for your variable collections. They know when their source changed and
  rebuild in place.
- **On the clipboard.** Copy for AI puts a component's context (as YAML) or a
  collection's tokens (as a Design Tokens Format Module document) on the
  clipboard for a coding agent.
- **In a repository.** Publish a library from the plugin (Pro) and pull it with
  the `spec-layer` CLI, so a coding agent reads the same facts your designers
  see in Figma.

Extraction, rendering, drift detection, and Copy for AI are deterministic. No
model is involved. The only optional use of AI is writing prose for the
sections labelled AI, and you can leave it off.

## Where to start

- Designers: [Your first component document](/docs/start/designer/).
- Developers: [Run the setup command](/docs/start/developer/).
- Evaluating the approach: the [Foundation Context v5 contract](/docs/reference/foundation-context-v5/)
  and the dated [status page](/docs/reference/status/), which says what has and
  has not been verified.

## What it does not do

Spec Layer does not guess. A value it cannot read is `null`, absent, or a
stated diagnostic, never a plausible default. It does not check your code
against the design; it delivers the design-side facts. It does not run outside
Figma except for the CLI, which only fetches what the plugin published.
```

- [ ] **Step 2: `start/designer.md`**

```markdown
---
title: Your first component document
description: Install the plugin, select a component, and read the Section it creates.
sidebar:
  order: 1
---

## Install

Open [Spec Layer on Figma Community](https://www.figma.com/community/plugin/1652104411578396548)
and choose Open in Figma. No account and no key is needed for anything on this
page.

## Create docs for a component

1. Select a component or component set. The plugin's first screen, Generate
   component docs, shows its name.
2. Leave the AI writing switch off for now. Every section still generates; the
   ones labelled AI carry a placeholder line you can write yourself.
3. Under Sections to include, keep the defaults. Related components is off by
   default. The States section appears only when the component has a variant
   axis that reads as a state.
4. Choose Create docs.

A Section named `<Component name>: Documentation` appears to the right of the
component. It contains the groups you ticked: Usage, Specifications
(Anatomy, Measurements, Configuration, States, Tokens used), and
Accessibility.

Running Create docs again on the same component replaces the existing Section
in place, wherever it is in the file, rather than adding a second copy.

## Keep it current

The Library screen lists every connected document with its status: In sync,
Update available, Rebuild needed, Manually edited, Source missing, or Check
unavailable. Update documentation rebuilds the generated sections from the
current component and keeps any text you wrote in the writing sections.

## Copy it for an agent

Copy for AI, in the footer of the component screen, puts the component's
context on the clipboard as YAML: variants, states, anatomy, properties, and
every token bound to every part, with the token values embedded. Paste it into
your coding agent's conversation. Nothing is sent anywhere; the copy is built
locally.

## Next

- Document your variable collections: Generate foundation docs, no selection
  needed.
- Change the frames' colours, fonts, and logo under Settings.
```

- [ ] **Step 3: `start/developer.md`**

````markdown
---
title: Run the setup command
description: What happens in your repository when you run the command a designer copied from the plugin.
sidebar:
  order: 2
---

A designer publishes a library from the plugin's Publish for developers screen
and sends you one command:

```bash
npx spec-layer setup --id lib_... --key sl_...
```

Run it once, in the root of the repository that should hold the design-system
context. Node 22 or later is required; the CLI has no other dependencies and
never talks to Figma.

## What it writes

| Path | What it is | Commit it? |
| --- | --- | --- |
| `speclayer.json` | The library id, the output directory, and optional selection and token settings | Yes |
| `speclayer.local.json` | The pull key, file mode 0600 | No. `setup` adds it to `.gitignore` and refuses to store the key unless git confirms the file is ignored |
| `.speclayer/` | The pulled library: `bundle.json`, `manifest.json`, a `tokens/` directory in Design Tokens Format Module 2025.10, and one YAML per component under `ai/components/` | Your choice; many teams commit it so the agent context is versioned with the code |

After setup, `npx spec-layer pull` needs no flags. `npx spec-layer status`
exits 2 when the published library is newer than what you have, which is a
useful CI check.

## Feed the tokens to your build

Point Style Dictionary or another Design Tokens consumer at `.speclayer/tokens/`
and load the files `resolver.json` names for the mode you build. Two files in
that directory are not tokens and must be excluded from token globs:
`spec-layer.meta.json` (Figma metadata per token) and `report.json` (what the
format could not express). See [Tokens](/docs/developers/tokens/).

## Give the component context to an agent

Each file under `.speclayer/ai/components/` is one component's context: its
variants and states, anatomy paths, properties, and every token bound to every
part with the resolved value per mode. Tell your coding agent to read the file
for the component it is implementing.

## If the key stops working

The CLI says so and names the fix: ask the designer for a new setup command
from the Publish screen. Keys are rotated there; the old key stops working
within about a minute.

Full command reference: [CLI](/docs/developers/cli/).
````

- [ ] **Step 4: `developers/tokens.md`**

````markdown
---
title: Tokens
description: The Design Tokens Format Module output under .speclayer/tokens/, and what it deliberately leaves out.
---

`spec-layer pull` writes your Foundation as a Design Tokens Format Module
2025.10 directory:

```text
.speclayer/tokens/
  <collection>.<mode>.json    one file per collection and mode
  styles.typography.json      when the file has text styles
  styles.effects.json         when the file has effect styles
  resolver.json               Design Tokens Resolver Module 2025.10
  spec-layer.meta.json        Figma metadata per token, keyed by DTCG path
  report.json                 everything the format could not express
```

A single-mode collection becomes a resolver `set`; a multi-mode collection
becomes a `modifier` with one context per mode. Group keys inside a file are
the Figma name segments verbatim. Aliases to local tokens become
`{Collection.path}` references.

## Values: standard or legacy

In `speclayer.json`:

```json
{ "dtcg": { "values": "standard" } }
```

`standard` (the default) writes the 2025.10 object forms. `legacy` writes the
string forms that Style Dictionary 4 and Tokens Studio read today. Changing
this setting makes the next `pull` rewrite the files even when nothing was
republished.

## Units

Figma numbers carry a unit only when the variable's scopes say so. Where they
do not, the token is written without a unit and `report.json` says why. You
can declare units per path pattern:

```json
{ "dtcg": { "units": { "Foundation/spacing/*": "px" } } }
```

Only `px` and `rem` are accepted.

## What is omitted, on purpose

The format has no home for some Figma facts, and Spec Layer does not
approximate. Each omission is recorded in `report.json` with a code, the path,
and the reason:

- String and boolean variables (no DTCG type).
- Dimensions in `%`, `em`, or `deg`.
- Aliases into a library that could not be resolved; no literal is invented.
- A `px` line height on a text style, which cannot become DTCG's unitless
  multiplier without inventing a font size relationship. A `%` line height is
  converted.
- Two tokens that would land on the same DTCG path; both are omitted rather
  than one silently winning.

Everything omitted from the token tree is still present, with its canonical
values, in `spec-layer.meta.json`.

## Building with Style Dictionary

The repository tests the output against Style Dictionary 5.5.2 with
`usesDtcg: true`. A minimal config for the `light` mode of a collection called
`Primitives` and one called `Semantic`:

```js
// style-dictionary.config.mjs
export default {
  usesDtcg: true,
  source: ['.speclayer/tokens/primitives.light.json', '.speclayer/tokens/semantic.light.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'build/css/',
      files: [{ destination: 'tokens.css', format: 'css/variables', options: { outputReferences: true } }],
    },
  },
};
```

Read `resolver.json` to see which files belong to which mode; the file names
are slugs of the Figma collection and mode names.
````

- [ ] **Step 5: Build, check for em dashes, commit**

Run:

```bash
npm run build --prefix apps/docs && grep -rc "—" apps/docs/src/content/docs/start apps/docs/src/content/docs/developers/tokens.md apps/docs/src/content/docs/index.md
```

Expected: build succeeds; every grep count is `0`.

```bash
git add apps/docs/src/content/docs
git commit -m "feat(docs): write the overview, two quick starts, and the tokens page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: Assemble the site and check its links

**Files:**
- Create: `scripts/site/assemble.mjs` (pure planning), `scripts/site/assemble.test.ts`
- Create: `scripts/site/links.mjs` (pure link check), `scripts/site/links.test.ts`
- Create: `scripts/build-site.mjs` (runner)
- Modify: `package.json` (scripts `build:site`, `check:site-links`)
- Modify: `.gitignore` (already ignores `dist/`; confirm)

**Interfaces:**
- Produces: `planSiteCopies({ landingFiles, docsFiles })` returning `{ from, to }[]`; `findBrokenLinks(pages)` where `pages` is `Map<string, string>` of site-root-relative paths (starting with `/`) to HTML, returning `{ page, href }[]`; npm scripts `build:site` (writes `dist/site/`) and `check:site-links` (exit 1 on any broken internal link). Task 13 wires both into CI; Task 14 changes the deploy directory to `dist/site`.

- [ ] **Step 1: Failing tests**

`scripts/site/assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planSiteCopies } from './assemble.mjs';

describe('planSiteCopies', () => {
  it('copies landing files to the root and the docs build under /docs, skipping the landing README', () => {
    const plan = planSiteCopies({
      landingFiles: ['index.html', 'README.md', 'schemas/foundation-context/v5.json'],
      docsFiles: ['index.html', 'developers/cli/index.html', '404.html'],
    });
    expect(plan).toEqual([
      { from: 'apps/landing/index.html', to: 'dist/site/index.html' },
      { from: 'apps/landing/schemas/foundation-context/v5.json', to: 'dist/site/schemas/foundation-context/v5.json' },
      { from: 'apps/docs/dist/index.html', to: 'dist/site/docs/index.html' },
      { from: 'apps/docs/dist/developers/cli/index.html', to: 'dist/site/docs/developers/cli/index.html' },
    ]);
  });

  it("drops Starlight's own 404.html so the landing's root 404.html is the one Pages serves", () => {
    const plan = planSiteCopies({ landingFiles: ['404.html'], docsFiles: ['404.html'] });
    expect(plan).toEqual([{ from: 'apps/landing/404.html', to: 'dist/site/404.html' }]);
  });
});
```

`scripts/site/links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findBrokenLinks } from './links.mjs';

const pages = new Map<string, string>([
  ['/index.html', '<a href="support.html">s</a><a href="/docs/">d</a><a href="https://x.y">x</a><a href="mailto:a@b.c">m</a><a href="#pricing">p</a>'],
  ['/support.html', '<a href="refund.html">r</a><img src="/logo.svg">'],
  ['/docs/index.html', '<a href="/docs/start/designer/">g</a><link href="/docs/_astro/a.css">'],
  ['/docs/start/designer/index.html', '<a href="../developer/">n</a>'],
  ['/logo.svg', ''],
  ['/docs/_astro/a.css', ''],
]);

describe('findBrokenLinks', () => {
  it('passes when every internal href and src resolves to a page or a file', () => {
    const ok = new Map(pages);
    ok.set('/refund.html', '');
    ok.set('/docs/start/developer/index.html', '');
    expect(findBrokenLinks(ok)).toEqual([]);
  });

  it('reports a relative link to a missing file and a directory link with no index.html', () => {
    expect(findBrokenLinks(pages)).toEqual([
      { page: '/support.html', href: 'refund.html' },
      { page: '/docs/start/designer/index.html', href: '../developer/' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run scripts/site/assemble.test.ts scripts/site/links.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `assemble.mjs`**

```js
/** Pure plan of which files make up dist/site. The runner does the copying. */
const LANDING_SKIP = new Set(['README.md']);
const DOCS_SKIP = new Set(['404.html']);

/**
 * @param {{ landingFiles: string[], docsFiles: string[] }} input relative paths, forward slashes
 * @returns {{ from: string, to: string }[]}
 */
export function planSiteCopies({ landingFiles, docsFiles }) {
  const plan = [];
  for (const f of landingFiles) {
    if (LANDING_SKIP.has(f)) continue;
    plan.push({ from: `apps/landing/${f}`, to: `dist/site/${f}` });
  }
  for (const f of docsFiles) {
    if (DOCS_SKIP.has(f)) continue;
    plan.push({ from: `apps/docs/dist/${f}`, to: `dist/site/docs/${f}` });
  }
  return plan;
}
```

- [ ] **Step 4: Implement `links.mjs`**

```js
/**
 * Internal link check over an assembled static site. Pure: takes a Map of
 * site-root paths to HTML. External, mailto, tel, data, and anchor-only hrefs
 * are ignored. A directory href resolves to its index.html.
 */
import { posix as path } from 'node:path';

const ATTR = /\b(?:href|src)="([^"]+)"/g;

function skip(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//');
}

/**
 * @param {Map<string, string>} pages
 * @returns {{ page: string, href: string }[]}
 */
export function findBrokenLinks(pages) {
  const exists = (p) => pages.has(p) || pages.has(path.join(p, 'index.html'));
  const broken = [];
  for (const [page, html] of pages) {
    for (const match of html.matchAll(ATTR)) {
      const href = match[1];
      if (skip(href)) continue;
      const clean = href.split('#')[0].split('?')[0];
      if (clean === '') continue;
      const target = clean.startsWith('/') ? path.normalize(clean) : path.normalize(path.join(path.dirname(page), clean));
      if (!exists(target)) broken.push({ page, href });
    }
  }
  return broken;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run scripts/site/assemble.test.ts scripts/site/links.test.ts`
Expected: 4 passed.

- [ ] **Step 6: The runner**

`scripts/build-site.mjs`:

```js
#!/usr/bin/env node
/**
 * build-site.mjs: assemble dist/site from apps/landing and apps/docs/dist, then
 * check every internal link. Exit 1 if any link is broken. Requires
 * `npm run build --prefix apps/docs` to have run first (CI does this).
 *
 *   node scripts/build-site.mjs            # assemble + check
 *   node scripts/build-site.mjs --check    # check an existing dist/site only
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { planSiteCopies } from './site/assemble.mjs';
import { findBrokenLinks } from './site/links.mjs';

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

const checkOnly = process.argv.includes('--check');

if (!checkOnly) {
  if (!existsSync('apps/docs/dist/index.html')) {
    console.error('apps/docs/dist is missing. Run: npm run build --prefix apps/docs');
    process.exit(1);
  }
  rmSync('dist/site', { recursive: true, force: true });
  const plan = planSiteCopies({ landingFiles: walk('apps/landing'), docsFiles: walk('apps/docs/dist') });
  for (const { from, to } of plan) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  console.log(`assembled dist/site: ${plan.length} files`);
}

const pages = new Map();
for (const f of walk('dist/site')) {
  const isHtml = f.endsWith('.html');
  pages.set('/' + f, isHtml ? readFileSync(join('dist/site', f), 'utf8') : '');
}
const broken = findBrokenLinks(pages);
if (broken.length > 0) {
  console.error(`${broken.length} broken internal link(s):`);
  for (const b of broken) console.error(`  ${b.page} -> ${b.href}`);
  process.exit(1);
}
console.log(`link check passed over ${pages.size} files`);
```

- [ ] **Step 7: npm scripts**

Add to the root `package.json` scripts:

```json
    "build:docs": "npm run build --prefix apps/docs",
    "build:site": "node scripts/build-site.mjs",
    "check:site-links": "node scripts/build-site.mjs --check",
    "check:site": "npm run build:docs && npm run build:site"
```

`check:site` is not part of `check` or `check:ci` because it needs `npm ci --prefix apps/docs`; Task 13 gives it its own CI job.

- [ ] **Step 8: Run the whole thing**

Run: `npm run check:site`
Expected: four synced lines, an Astro build, `assembled dist/site: N files`, `link check passed over N files`. If the link check reports the `/docs/` link from `404.html` or `index.html` as broken, the docs copy step did not run; fix that before touching the pages. If it reports links inside the synced spec pages, add the target to `linkMap` in `apps/docs/scripts/sync-sources.mjs` when a docs page exists for it, otherwise it is already a GitHub URL and cannot be reported; investigate.

- [ ] **Step 9: Lint, test, commit**

Run: `npm run lint && npm test && npm run check:nul`

```bash
git add scripts/site/assemble.mjs scripts/site/assemble.test.ts scripts/site/links.mjs scripts/site/links.test.ts scripts/build-site.mjs package.json
git commit -m "feat(site): assemble dist/site from the landing and docs builds and check internal links" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: CI builds the site

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a second job**

Append to `jobs:` in `.github/workflows/ci.yml`:

```yaml
  site:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: |
            package-lock.json
            apps/docs/package-lock.json
      - run: npm ci
      - run: npm ci --prefix apps/docs
      - run: npm run check:site
```

The root `npm ci` is needed because `scripts/build-site.mjs` runs with the root's Node setup and the docs sync imports `scripts/site/markdown.mjs`; neither has dependencies, but the root install is cheap and keeps one code path.

- [ ] **Step 2: Validate the YAML locally**

Run: `node -e "const y=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/^  site:$/m.test(y)) process.exit(1); console.log('yaml has site job')"`
Expected: `yaml has site job`.

- [ ] **Step 3: Commit and push, then read the CI status directly**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build the docs site and check its links" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin worktree-website-rebuild
```

Then open the PR (or update the Phase 1 PR) and read the two job results in the GitHub UI or with `gh run list --branch worktree-website-rebuild --limit 1` followed by `gh run view <id>`. Never verify CI through a pipe that swallows the exit code. Expected: both `verify` and `site` green. If `site` fails on an Astro version or `social` config shape, fix per Task 9 Step 2's note.

### Task 14: Link the docs from the landing, switch the deploy directory, and deploy

**Files:**
- Modify: `apps/landing/index.html` (footer nav, hero secondary button)
- Modify: `apps/landing/README.md` (deploy section)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Footer and hero links**

In `apps/landing/index.html`:

- Footer `<nav>`: insert `<a href="/docs/">Documentation</a>` as the first link, before Open in Figma.
- Hero `.cta-row`: change the secondary button `<a class="btn btn-secondary" href="#pricing">See pricing</a>` to `<a class="btn btn-secondary" href="/docs/">Read the docs</a>`. Pricing keeps its own anchor further down the page.

- [ ] **Step 2: The landing README deploy section**

Replace the first code block under `## Deploy (Cloudflare Pages)` and the parenthetical note after it with:

````markdown
```sh
npm ci --prefix apps/docs
npm run check:site
npx wrangler pages deploy dist/site --project-name speclayer-landing
```

`check:site` builds `apps/docs`, assembles `dist/site` (landing files at the
root, the docs build under `docs/`), and fails on any broken internal link.
Deploy that directory, never `apps/landing/` on its own, or `/docs/` disappears.
````

- [ ] **Step 3: CHANGELOG**

Under `## [Unreleased]` `### Added`:

```markdown
- A documentation site at `spec-layer.com/docs/`: an overview, a designer and
  a developer quick start, a tokens page, and reference pages generated at
  build time from the CLI README, the two v5 specs, and the status document.
  Built with Astro Starlight in `apps/docs`, which is not an npm workspace.
  The landing page gains a Documentation link and a support page.
```

- [ ] **Step 4: Build, check, commit**

Run: `npm run check:site && grep -c "—" apps/landing/index.html`
Expected: link check passes; grep count is `1` (the `<title>`).

```bash
git add apps/landing/index.html apps/landing/README.md CHANGELOG.md
git commit -m "feat(landing): link the documentation site and deploy the assembled dist/site" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the deploy to the user**

Stop and give the user:

```bash
npm ci --prefix apps/docs && npm run check:site && npx wrangler pages deploy dist/site --project-name speclayer-landing
```

- [ ] **Step 6: After the user confirms, verify live**

Run:

```bash
npm run check:landing-live && for p in /docs/ /docs/start/developer/ /docs/developers/cli/ /docs/reference/status/ /docs/no-such-page/; do printf "%-32s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://spec-layer.com$p"; done
```

Expected: live check passes, then `200`, `200`, `200`, `200`, `404`. Report the actual output.

Phase 2 ends here.

---

## Follow-up plans (not part of this document)

Each is a separate plan with its own brainstorm where a decision is still open. They are listed so the sequence is visible; none of their tasks is specified here.

| Plan | Delivers | Blocked on |
|---|---|---|
| Designer guide | Nine pages under `designers/`: component docs, foundation docs, library, copy for AI, AI writing, theming, publish, license, limits (review section 6.2) | Screenshots, which wait for the manual Figma matrix run in `packages/plugin/TESTING.md` so they show a verified build |
| How it works | Eight pages under `reference/`: deterministic, drift, diagnostics (the 24 codes from `diagnostics.ts`), DTCG projection, schemas, plus the three synthetic example artifacts rendered and downloadable (review section 5.3) | Nothing; can start after Phase 2. The three synced spec pages already exist |
| Landing rewrite | Hero, three outputs, proofs, developer strip, pricing with publishing, FAQ additions, Open Graph tags, sitemap, new gallery captures (review section 7) | Review decisions 1 (pivot vs current product), 2 (rename with the Community listing), 5 (support address) |
| Plugin follow-ups | Contact support and the world icon open `/support.html` and `/docs/`; the License screen links the docs | A plugin branch, after `library-semantic-diff` merges; touches `packages/plugin/src/ui/proxy.ts:8,19` |
| Changelog cut | `CHANGELOG.md` split into versions so `docs/changelog` can exist | The 5.0.0 plugin release decision |

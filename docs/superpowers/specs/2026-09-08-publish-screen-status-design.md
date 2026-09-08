# Publish screen: status block, docs link, and a recorded publish date

Date: 2026-09-08
Status: implemented on `feat/publish-screen-status`, 2026-09-08
Builds on: `2026-09-08-free-publish-quota-design.md`,
`2026-09-02-publish-identity-and-storage-hardening-design.md`

## Problem

The Publish for developers screen (`packages/plugin/src/ui/screens/publish.ts`)
grew by accretion. After the free publishing change it stacks six loose text
blocks with no hierarchy: a definition caption, a "What gets published"
paragraph, a "before first publish" paragraph, an allowance caption, the
developer setup group, and a result line. It reads as a settings page rather
than a status-and-action screen.

Three things a user asks of this screen are missing or hidden:

- **When was this last published?** `lastPublishedAt` exists in `PublishState`
  but is only set in memory after a publish. Nothing stores it, so a fresh
  session cannot show it, and the screen never renders it at all.
- **Where are the CLI docs?** The setup group explains the command in prose.
  The plugin's one established outbound docs link is in Settings, not here.
- **Which action is destructive?** Rotate key sits in the same row as the two
  copy buttons, distinguished only by label colour.

Builds before `8bdc071` also showed a "Pro plan required" group. That is
already gone on `main`; this design does not reintroduce plan gating.

## Revision, same day

The first build (a label-and-value status block, a CLI docs link in the body,
trimmed paragraphs) was reviewed in the harness and revised to the design
below. The review asked for: the same single-line header bar Settings got, a
title that does not say "for developers" since the agent prompt is for a
coding agent, a status pill instead of a status list, no explanatory
paragraphs (the website docs carry them), both the developer command and the
agent prompt visible in full with their own Copy, the documentation as a
footer secondary, successes as toasts rather than a line under the blocks, and
no "rotating cuts off everyone" line. The storage half is unchanged.

## Decision summary

- **Title "Publish" with a status pill.** The h1 names the act alone, like the
  Library footer button that opens the screen; a `.sl-badge` beside it reads
  **Published** (success tone) or **Not published**.
- **One meta line under the header** carries the last publish date and time in
  local time and, on a free plan, the updates left. It replaces the definition
  and allowance captions.
- **The publish date is stored in the file**, beside the library id, so every
  editor of the file sees it in every session. The date is a fact about the
  file's library, not a secret, so root plugin data is the right home.
- **Two copy blocks, no paragraphs.** Developer setup (the `npx spec-layer
  setup` command) and AI agent setup (the agent prompt), each shown in full
  with its own **Copy**. The website documentation explains publishing; the
  screen does not.
- **Documentation is a footer secondary**, `Read documentation`, an anchor to
  `https://spec-layer.com/docs/quickstart/#publish-pull`, before the primary.
- **Successes are toasts.** The publish host gains `notify(message)`; created,
  updated, unchanged and rotated call it and leave `message` null. Only errors
  render in the body, where they stay until the next action.
- **Rotate key is its own row** after the blocks, with no consequence line.
- **No proxy change.** The plugin knows every date it publishes; an owner-facing
  metadata route would buy nothing here.

## Screen

### Header

Back control, `<h1>Publish</h1>`, and a `.sl-badge` pill: `Published`
(`data-tone="success"`) when a library id is known, `Not published` otherwise.
The header takes the 48px single-line bar (`min-height: 48px; padding-bottom:
var(--sl-space-6)`) that Library, Foundations, License and Settings use; the
67px base is for the component screen's two-line header.

### Meta line

One muted `<p class="sl-publish-meta">` of spans, each present only when it has
a true value:

| Part | Shown when | Text |
|---|---|---|
| Last published | a library id is known | `Last published 8 Sept 2026, 14:32` in the user's local time; `Last published date not recorded` when the id is known but no date is |
| Free updates | the free allowance is known | `3 of 10 free updates left this month, resets Oct 1`; `No free updates left this month, resets Oct 1` at zero |

"Not recorded" covers a library published by a build before this one, which
stored the id but no date. It is transient: the next publish records one.
Never a guessed date, never today's date.

The date is formatted by `formatPublishedAt(iso, locale?)` in
`viewModel/allowance.ts`, next to `formatResetDate`, using
`Intl.DateTimeFormat` with `dateStyle: 'medium'` and `timeStyle: 'short'`. It
returns `null` for an empty or unparsable string. The optional locale exists
so tests are deterministic; the plugin passes none and gets the user's locale.
Local time, not UTC: this is the moment the user pressed Publish, not a server
boundary, so `formatResetDate` keeps its UTC rule and this one does not.

### Body

- **Before the first publish:** one paragraph, "Publishes this file's
  foundation and component docs as context for developers and coding agents.
  The setup commands appear here after the first publish." Nothing else.
- **Id and key known:** two `.sl-publish-block` sections, each a head row
  (`<h2>` left, small secondary `Copy` right) over a `<pre class="sl-publish-code">`
  with the full text: **Developer setup** holds `setupCommand(id, key)` and
  its Copy is `data-publish-copy-command`; **AI agent setup** holds
  `agentSetupMessage(id, key)` and its Copy is `data-publish-copy-agent`. Then
  `Rotate key` in its own `.sl-publish-rotate` row (secondary tone, `is-danger`,
  disabled while a publish is in flight). No consequence line.
- **Id known, key not on this device** (a second computer, a teammate, or
  cleared plugin storage; the server hands the key out only on create and
  rotate, and the file is readable by every editor): a Developer setup block
  whose body is "This file is published as `lib_…`. The pull key is stored on
  the device that published it. Ask that person for the setup command, or
  rotate the key to issue a new one here. Rotating stops the current key
  working for everyone within about a minute.", then the rotate row. No code
  block, no Copy, no agent block. This is the one place the rotate consequence
  is stated. A rotate the server refuses with 403 `not_owner` (a teammate who
  did not publish) reads "Only the account that published this library can
  rotate its key." in the error line.
- **Error line:** `<p class="sl-publish-status is-error">` with
  `state.message`, rendered only when `status === 'error'`. Successes never
  render here.

### Footer

`Read documentation` as `<a class="sl-button sl-publish-docs"
data-tone="secondary" target="_blank" rel="noopener">` to `PUBLISH_DOCS_URL`
(`https://spec-layer.com/docs/quickstart/#publish-pull`, a constant beside
`DOCS_URL` in `ui/proxy.ts`), then the `Publish library` primary, with the
progress line above both while a publish runs. The order is the Library
footer's: secondary first, primary last.

### Toasts

`PublishHost` gains `notify(message: string)`. The controller calls it and sets
`message: null` on: created ("Published. Anyone with the key can pull this
version."), updated ("Published. Developers get this version on their next
pull."), unchanged ("Nothing changed since the last publish."), and rotated
("Key rotated. The old key stops working within about a minute. Share the new
command with your developers."). `ui-vnext.ts` routes `notify` to
`nativeNotify`, which is `figma.notify` on the main thread.

## Storing the date

### Messages

`PublishInfo` gains `publishedAt: string | null`. The `publishInfo` reply and
the `publishSources` payload carry it. One new UI-to-main message:

```ts
| { type: 'setPublishedAt'; libraryId: string; publishedAt: string }
```

`setPublishInfo` is unchanged, so the create and rotate paths keep their
message shape and tests.

### Main thread

A new root plugin data key, `speclayer.publish.publishedAt`, beside
`speclayer.publish.libraryId`. `readPublishInfo` returns it, or `null` when
empty. `setPublishedAt` writes it only when the given `libraryId` matches the
stored id, so a stale reply for a library this file no longer holds cannot
label the new one. `clearPublishInfo` clears it with the id.

### Controller (`ui/publish.ts`)

- `onPublishInfo` seeds `lastPublishedAt` from the reply, under the same
  idle-only rule as the id and key.
- `onPublishSources` falls back to `msg.publishInfo.publishedAt` the way it
  does for the id and key.
- After a `created`, `updated`, or `unchanged` outcome the controller sends
  `setPublishedAt` with the outcome's `libraryId` and `publishedAt`. `created`
  already sends `setPublishInfo`; it sends both. The `unchanged` response
  carries the stored library's existing date, which is the correct "last
  published" value, so it is recorded too.
- `gone` clears `lastPublishedAt` with the id and key.

## Styling

- `.sl-publish-title` lays the h1 and the pill out on one centred row.
- `.sl-publish-meta` is a wrapping flex row of spans with a column gap, so a
  long date and a long allowance break between each other at 480px.
- `.sl-publish-block-head` is label left, Copy right; `.sl-publish-code`
  inherits the old command box look (subdued surface, muted border, `pre-wrap`,
  `overflow-wrap: anywhere`, ligatures off so `--id` cannot render as a dash).
- `.sl-publish-rotate` is the destructive action's own row.
- Removed with their markup: `.sl-publish-group + .sl-publish-group`, the
  `p + p` heading rule, `.sl-publish-command`, `.sl-publish-command-actions`,
  `.sl-publish-hint`, `.sl-publish-definition`, `.sl-publish-allowance`. The
  About section's rules in Settings are untouched.

## Copy

All new strings follow `docs/plugin-voice-and-copy.md`: sentence case, second
person, no em dashes, no hype words. Row labels are nouns, not sentences.

## Testing

Unit, in `packages/plugin/test`:

- `publishScreen.test.ts`: the status block's four rows and when each is
  absent; "Not published yet" before the first publish; "Not recorded" for an
  id without a date; the local-time date for a recorded one; the docs link's
  href, `target`, and `rel`; rotate in its own row after the docs link, no
  longer inside the copy row; the definition caption gone; the styling tests
  updated for the shared selectors.
- `allowance.test.ts` (or the file that holds `formatResetDate` tests):
  `formatPublishedAt` with a fixed locale, an empty string, and garbage.
- `publish.test.ts`: `setPublishedAt` sent after created, updated, and
  unchanged, not after an error; `onPublishInfo` seeds the date; the
  `publishSources` fallback; `gone` clears it.

Harness (`ui/harness.ts`): the `PUBLISH_FIXTURES` gain an `idOnly` state and
the `published` state keeps its date, so `?pane=publish&publish=<name>` shows
every branch of the status block; `?plan=free` still shows the allowance row.

Manual, in `packages/plugin/TESTING.md`, "Publish and pull": the first
publish row also checks the Last published row appears with the local time;
the second-device row checks it shows the same date; a new row reopens the
plugin and confirms the date survived.

## Out of scope

- An Upgrade control on this screen. The result line already names the path
  at the allowance limit.
- A publish status badge on the Library list.
- Any proxy change, including an owner-facing library metadata route.
- Changing what a publish sends, `EXTRACTOR_VERSION`, or anything the CLI
  reads.

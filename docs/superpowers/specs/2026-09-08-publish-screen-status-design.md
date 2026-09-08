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

## Decision summary

- **One status block at the top**, a label and value list in the shape of the
  About section in Settings, replaces the definition and allowance captions.
- **The publish date is stored in the file**, beside the library id, so every
  editor of the file sees it in every session. The date is a fact about the
  file's library, not a secret, so root plugin data is the right home.
- **A CLI documentation link** sits under the setup command, styled like the
  Settings docs link, pointing at `https://spec-layer.com/docs/cli/`.
- **Rotate key moves to its own line** under the docs link, with its consequence
  hint, visibly separate from copying.
- **No proxy change.** The plugin knows every date it publishes; an owner-facing
  metadata route would buy nothing here.

## Screen

Header and footer are unchanged: the back control and "Publish for developers"
above, the single Publish primary (or the progress line) below.

Scroll body, top to bottom:

### 1. Status block

A `<dl class="sl-publish-facts">` with one wrapper `<div>` per row, sharing the
grid rules `.sl-about-versions` already defines. Rows, in order, each present
only when it has a true value to show:

| Row | Shown when | Value |
|---|---|---|
| Status | no library id is known | `Not published yet` |
| Last published | a library id is known | the recorded date in the user's local time, e.g. `8 Sep 2026, 14:32`; `Not recorded` when the id is known but no date is |
| Library id | a library id is known | the id in `<code>` |
| Free updates | the free allowance is known | `3 of 10 left this month, resets Oct 1`; `None left this month, resets Oct 1` at zero |

"Not recorded" covers a library published by a build before this one, which
stored the id but no date. It is transient: the next publish records one.
Never a guessed date, never today's date.

The date is formatted by a new pure function `formatPublishedAt(iso, locale?)`
in `viewModel/allowance.ts`, next to `formatResetDate`, using
`Intl.DateTimeFormat` with `dateStyle: 'medium'` and `timeStyle: 'short'`. It
returns `null` for an empty or unparsable string, and the row then says
"Not recorded". The optional locale exists so tests are deterministic; the
plugin passes none and gets the user's locale. Local time, not UTC: this is
the moment the user pressed Publish, not a server boundary, so
`formatResetDate` keeps its UTC rule and this one does not.

The allowance row reuses `publishAllowance` and the same numbers
`publishAllowanceCopy` produces today, re-phrased for a labelled row. Pro and
"not yet fetched" show no row, as before.

### 2. What gets published

Heading unchanged. One paragraph:

> The foundation document and every connected component document in this
> file, published as AI context. Publishing replaces the version before it.

Before the first publish, a second paragraph:

> Publishing creates the key and setup command developers need. They appear
> here once it has run.

The "A library is this Figma file" definition caption is removed. The status
block's "Library id" row and this paragraph's "in this file" together carry
what it said.

### 3. Developer setup

Present only when a key is known, as today. Heading, the existing paragraph,
the command box, then:

- A row of the two copy buttons, `Copy setup command` and `Copy for an AI
  agent`, unchanged.
- A link, `CLI documentation`, with the external-link glyph, to
  `CLI_DOCS_URL` (`https://spec-layer.com/docs/cli/`, a new constant beside
  `DOCS_URL` in `ui/proxy.ts`). Same markup as the Settings docs link:
  `<a target="_blank" rel="noopener">`, since that is the plugin's established
  way to leave the iframe.
- Its own line: the `Rotate key` button (secondary tone, `is-danger`, disabled
  while a publish is in flight, as today) with the existing consequence hint
  beneath it.

The id-only case (id known, key not on this device) keeps its current
paragraph and rotate control, and gains the same docs link, since the
developer still needs the CLI.

### 4. Result line

Unchanged. Last, after both groups, toned by status.

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

- `.sl-publish-facts` joins the `.sl-about-versions` rulesets as a selector
  list, so the two lists cannot drift apart. It adds a bottom margin of its
  own before the first group.
- `.sl-publish-docs` joins the `.sl-about-docs` rulesets the same way.
- `.sl-publish-rotate` is a new row wrapper with the same top margin as the
  copy row, so the destructive action reads as its own step.
- `.sl-publish-definition` and `.sl-publish-allowance` rules are removed with
  their markup.

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

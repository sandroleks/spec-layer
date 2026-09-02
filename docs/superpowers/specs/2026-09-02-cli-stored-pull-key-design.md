# A stored pull key for the spec-layer CLI

Date: 2026-09-02
Status: approved design, not yet implemented
Builds on: `2026-09-01-library-publish-cli-design.md`, `2026-09-02-cli-granular-pull-design.md`

## Problem

The plugin's publish screen hands a developer one line:

```bash
SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...
```

It works exactly once. The key lives only in that command, so every later
`pull`, `status`, or re-pull after a rotation needs the developer to find the
key again, and in practice they either paste it repeatedly or export it into a
shell profile by hand. Neither is a flow the plugin can describe in one box.

The original design chose "the key is never written to disk" as a security
property, and the README states it. That claim does not survive contact with
use. It does not remove the secret, it relocates it into shell history, into
`~/.zshrc`, and into whatever a teammate improvises during onboarding. Those
are worse homes than a mode `0600` file the tool controls and can keep out of
git: shell history is world-readable to anything running as the user, is never
rotated, and is routinely synced or committed as a dotfile.

So the key does go on disk, deliberately, in a place the CLI writes, ignores,
and can point at in an error message.

## Decision summary

- **The key lives in a repo-local file, `speclayer.local.json`.** A sibling of
  `speclayer.json`, not a home-directory credential store. The project-local
  file is discoverable and obviously scoped to the repo it belongs to.
- **Never inside the output directory.** `.speclayer/` is disposable pull
  output; `rm -rf .speclayer` is a normal thing to do and must not destroy the
  credential.
- **The credential file records its library id.** A stored key is only used
  for the library it was issued for. This prevents a repo whose `libraryId`
  changed from sending a stale key and receiving the misleading
  `Key was rotated or revoked`.
- **Environment beats file.** Resolution is `--key`, then `SPEC_LAYER_KEY`,
  then `speclayer.local.json`. CI overrides the working tree without editing
  it, matching npm's precedence for `_authToken`.
- **A new `setup` command owns the whole first-run flow.** It writes the
  config, ensures the gitignore entry, writes the key, and pulls. `init` keeps
  its current role as the offline, config-only command.
- **The gitignore entry is ensured before the key is written.** A secret must
  never sit on disk un-ignored, not even for the duration of a network call.
- **No command ever prints the key back.** `setup` reports that it wrote a
  key, never its value.

## Files on disk

`speclayer.json` is unchanged and stays committable:

```json
{
  "libraryId": "lib_aaaaaaaaaaaaaaaaaaaaaaaa",
  "outDir": ".speclayer"
}
```

`speclayer.local.json` is new, mode `0600`, gitignored:

```json
{
  "libraryId": "lib_aaaaaaaaaaaaaaaaaaaaaaaa",
  "key": "sl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

The file holds the key and the library it belongs to, and nothing else. The API
origin is not stored: `--api` and `SPEC_LAYER_API` already cover overriding it,
and it is not a secret.

A stored key whose `libraryId` does not match the resolved library id is
ignored, with a stated reason rather than a silent fallthrough to a 401.

## Key resolution

`resolveOptions` in `packages/cli/src/config.ts` currently ends at

```ts
key: flags.key ?? env.SPEC_LAYER_KEY ?? null,
```

It gains the file as a third source, consulted last, and only when its
`libraryId` matches:

1. `--key`
2. `SPEC_LAYER_KEY`
3. `speclayer.local.json`, when its `libraryId` equals the resolved library id
4. otherwise null, and the caller reports the missing key

Reading the credential file is a separate function from `readConfig`, so the
two failure modes stay distinct: a malformed `speclayer.json` is a hard error
today and stays one, while a malformed `speclayer.local.json` reports that the
stored key is unreadable and names the setup command.

## `setup`

```text
setup  --id lib_... --key sl_... [--out DIR] [selection]
```

`--key` falls back to `SPEC_LAYER_KEY` like every other command, so
`SPEC_LAYER_KEY=sl_... spec-layer setup --id lib_...` is equivalent. A missing
id or key is a usage error, exit 1, before anything is written.

Steps, in this order, each reported on its own output line:

1. Write `speclayer.json` through the existing `writeConfig`, honouring
   `--out` and the selection flags exactly as `init` does.
2. Ensure the gitignore entry (see below). On the refusal case, stop here and
   exit nonzero without writing the key.
3. Write `speclayer.local.json`. Mode `0600` on create, and an explicit
   `chmodSync` after an overwrite, because `writeFileSync`'s `mode` option
   applies only when the file is created.
4. Run the same pull `runPull` performs.
5. Exit with the pull's exit code.

Ordering is load-bearing. Gitignore before the key, so the secret is ignored
before it exists. Config first because `speclayer.json` holds no secret and is
meant to be committed, so writing it early is harmless and leaves the repo
configured even when a later step refuses. The pull last, so a network failure
leaves a usable, correctly ignored setup behind and a bare `spec-layer pull`
retries it.

## Gitignore handling

Whether the file is already ignored is decided by git, not by string matching:

```bash
git check-ignore -q speclayer.local.json
```

That answers correctly for a line already present, a global ignore file, or a
broader pattern such as `*.local.json`, so a second `setup` in the same repo
appends nothing.

When it is not ignored, append a comment and the filename to `.gitignore` in
the same directory as the credential file. Operating on the current directory
rather than `git rev-parse --show-toplevel` avoids guessing in a monorepo, and
git honours a nested `.gitignore` for its own directory. Create the file when
absent, and append with a leading newline when the existing file does not end
in one.

Outcomes:

| Situation | Behaviour |
|---|---|
| git ran and reported this isn't a working tree | Skip the step, say `.gitignore` was left alone, write the key. |
| git could not be run at all, and no `.git` directory is present | Same as above: there is genuinely no repository to leak into. |
| git could not be run at all, but a `.git` directory is present | Refuse to write the key. It cannot confirm the file would be ignored inside what looks like a real working tree. Print the exact line to add and exit nonzero. |
| Git repo, entry added, already covered, or `.gitignore` created | Report which, continue. |
| Git repo, `.gitignore` not writable | Refuse to write the key. Print the exact line to add and exit nonzero. |

The two refusal rows are the deliberately awkward case. Writing an un-ignored
secret into a git working tree and warning about it would put the burden on
the developer noticing a line of output.

> **2026-09-02, during implementation:** this table originally collapsed "git
> could not be run" into the same outcome as "not a git working tree,"
> reasoning that a non-repository has nothing to leak into. Review during
> Task 4 found the hole that reasoning missed: a directory with a `.git`
> entry but no `git` executable on `PATH` (a slim container, a sandbox) is a
> real working tree, and the old logic both printed a false reassurance
> ("Not a git repository, so .gitignore was left alone") and then wrote a
> plaintext key into it with nothing ignoring it. The human partner overruled
> the original position for that one case: a present `.git` directory with an
> unrunnable `git` now refuses to write the key instead of writing it
> unverified. `packages/cli/src/gitignore.ts` (the `no-git` outcome) is the
> shipped behaviour; this section now matches it.

## Rotation and replacement

Rotating in the plugin produces a new key and a new setup command. Re-pasting
it overwrites `speclayer.local.json` and reports `replaced the stored key`
rather than pretending it wrote a new one. No prompt: the developer pasted a
command containing a key, which is unambiguous intent.

The existing rotated-key error grows a pointer to the recovery path:

```text
Key was rotated or revoked. Run the setup command from the plugin's Library
screen to store the current key.
```

## Invariants

- The key never reaches `speclayer.json`, `bundle.json`, `manifest.json`, or
  any file under the output directory.
- No command writes the key to stdout or stderr. `setup` reports the fact of
  writing, not the value. This includes error paths: a mismatch or unreadable
  file names the file, never its contents.
- `speclayer.local.json` is not read by `list` or `show`, which need no key.

## Error handling

| Case | Message | Exit |
|---|---|---|
| `setup` without `--id` | names `--id lib_...` as the plugin shows it | 1 |
| `setup` without a key | names `--key` and `SPEC_LAYER_KEY` | 1 |
| Git repo, gitignore unwritable | prints the line to add, states the key was not written | 1 |
| Stored key, mismatched library id | states the stored key belongs to another library and names the setup command | 1 |
| Unreadable `speclayer.local.json` | states the stored key cannot be read, names the setup command | 1 |
| No key from any source | names the setup command first, then `SPEC_LAYER_KEY` | 1 |

## Plugin changes

`setupCommand` in `packages/plugin/src/ui/publish.ts` becomes

```ts
return `npx spec-layer setup --id ${libraryId} --key ${pullKey}`;
```

The publish screen's surrounding copy stops explaining an environment variable
and states that the command saves the key next to the project config and keeps
it out of git. Sentence case, second person, no em dashes, and no claim about
what git will do that the CLI does not actually verify.

`npx spec-layer setup` only resolves once a CLI version containing it is on
npm. Publishing that version is a prerequisite for shipping the plugin copy
change, not a follow-up to it.

## Testing

Unit tests, following the existing `packages/cli/test` patterns with an
injected fs-backed temp directory:

- Resolution order: flag over env, env over file, file when neither is set,
  null when none.
- A stored key with a mismatched `libraryId` is ignored, and the reason is
  reported.
- An unreadable or malformed credential file reports the stored key as
  unreadable and does not throw the `speclayer.json` error.
- The credential file is `0600` both when created and when overwritten.
- Gitignore: already covered by `check-ignore` appends nothing; absent
  `.gitignore` is created; existing `.gitignore` gains one entry and a second
  `setup` adds no duplicate; a file with no trailing newline is appended to
  cleanly.
- A git repo with an unwritable `.gitignore` leaves no credential file behind.
- A non-git directory writes the credential and reports the skip.
- `setup` exits with the pull's exit code, including the failure case.
- No command's output contains the key, asserted against the captured `Io`.

Manual, added to `packages/plugin/TESTING.md` beside the existing "Publish and
pull" rows: copy the setup command out of a real Figma publish, paste it into a
fresh directory inside a git repo, confirm the reported lines, confirm
`git status` shows no credential file, then run `spec-layer pull` and
`spec-layer status` with no key in the environment. Then rotate in the plugin,
confirm the stored key now fails with the pointer message, and re-paste.

`npm run check:cli-bundle` already guards that the built binary loads, which is
what the 0.2.0 breakage needed and no test could reach.

## Docs to update alongside implementation

- `packages/cli/README.md`: the "The pull key" section, which currently states
  the key is never written to disk. Replace with the file, its mode, the
  resolution order, and the gitignore behaviour.
- Root `README.md` line 107, the quickstart command.
- `CHANGELOG.md`: the new command, and the reversal with its reasoning.
- `2026-09-01-library-publish-cli-design.md`: mark the "never written to disk"
  decision as superseded by this document rather than editing it.

## Explicitly out of scope

- A home-directory credential store or OS keychain integration. Considered and
  rejected for now in favour of the project-local file. If a single developer
  working across many libraries becomes a real complaint, the resolution order
  already has a natural fourth slot.
- Encrypting the file at rest. Mode `0600` plus gitignore is the property being
  claimed, and claiming more than that would be dishonest.
- A `logout` or `spec-layer key rm` command. Deleting the file is the whole
  operation and the file is discoverable by name.
- Storing the API origin, the license, or anything else in the credential file.

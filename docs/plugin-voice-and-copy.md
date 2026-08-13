# Spec Layer plugin — voice & copy rules

How the plugin talks. Applies to every user-facing string in the plugin UI
(buttons, hints, banners, meters, settings). Not code comments, not the
AI-generated doc prose (that has its own guide in `prose-style-guide.md`).

## Voice in one line

Talk like a senior design-system teammate who respects your time — plain,
honest, and specific. Never like a marketer.

## Rules

1. **No em dashes.** Ever, in user-facing copy. Use a period, a comma, "so",
   or parentheses instead. (Em dash `—`, en dash `–`: neither.)
2. **Short, active sentences.** One idea per line in hints. Prefer a period
   over a comma-splice or a dash-joined clause.
3. **Second person, present tense.** "You're on Pro", not "The user is
   subscribed". "AI reads your file", not "The file is read".
4. **Sentence case.** Buttons and headings included ("Manage subscription",
   not "Manage Subscription").
5. **Be concrete, skip the hype.** Never: supercharge, unleash, magic,
   effortless, seamless, powerful, revolutionary, ✨-as-punctuation. Say what
   the thing does.
6. **Be honest about limits.** State what happens, including the off-path and
   edge cases. Don't claim "unlimited" when there's a fair-use cap; don't
   promise a result you can't guarantee.
7. **Warmth comes from clarity, not exclamation.** No `!`, no emoji as
   decoration. A single status glyph (a check) is fine.
8. **Name things the way the user thinks of them,** not the internal name
   (their "file", "component", "purchase email" — not "node", "clientStorage").

## Footer actions

Three screens end in a footer with the same two slots, so the three had drifted
into naming three different things: an output ("Create docs"), an internal
storage unit ("Create 8 frames"), and a batch scope ("Update all 3").

1. **The primary names its action and the object the user came for.** That
   object is **docs** on every screen that makes them. Not "frames" (how the
   foundations screen happens to store a doc), not "documentation" (longer, and
   the footer has no room to spare).
2. **No counts in a button.** The count belongs where the screen already
   reports it: the foundations toolbar says "8 of 12 included" and each row that
   splits says "+ N frames"; the Library's Updates filter says how many drifted.
   A label that counts also changes width as the user ticks rows, so the button
   moves under the cursor.
3. **Scope goes in the label only where two of these actions could collide.**
   "Update all docs" in the Library footer against "Update documentation" in a
   row's own menu: one is every drifted doc, the other is this one. Both stay
   separate buttons.
4. **Busy is the present participle plus an ellipsis** — "Creating docs…",
   "Updating…", "Refreshing…". Same button working, not a new action.
5. **A blocked primary may state why instead of naming the action** ("Up to
   date", "Select sources to continue"). It is disabled, so it is not offering
   an action to name. This is also why it carries no icon: see the icon
   contract in `design-system/components.css`.

| Screen | Secondary | Primary |
| --- | --- | --- |
| Selected component | `Download` | `Create docs` |
| Foundations | `Refresh sources` | `Create docs` |
| Library | `Refresh library` | `Update all docs` |

Glyphs are a separate contract (one button, one glyph, held through every
state); see `docs/plugin-ui-vnext/design-system/README.md`.

## Reference strings (current, on-voice)

- Free meter: `17/20 AI generations left this month`
- Pro meter: `Pro plan active`
- Activation success: `Pro plan active ✓`
- Upsell: `You've used your free AI generations for July.`
- Upgrade button: `Upgrade for $8/mo`
- Fallback (no identity): `AI works on the free plan. No key needed.`

When in doubt, read it aloud. If it sounds like a landing page, rewrite it.

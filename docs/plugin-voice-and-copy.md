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

## Reference strings (current, on-voice)

- Free meter: `17/20 AI generations left this month`
- Pro meter: `Pro plan active`
- Activation success: `Pro plan active ✓`
- Upsell: `You've used your free AI generations for July.`
- Upgrade button: `Upgrade for $8/mo`
- Fallback (no identity): `AI works on the free plan. No key needed.`

When in doubt, read it aloud. If it sounds like a landing page, rewrite it.

# Debate Output Structure

Use this exact structure when composing the synod's debate section. The skill spawns one subagent per persona in parallel; this template is how the main agent assembles their statements into the final output.

The order is intentional, not arbitrary. The Adversary opens because someone has to name the stakes before the room talks itself into anything. The Humanist closes because the conversation should return to the people the decision actually affects. The middle five are sequenced to maximise productive collision — Strategist after Adversary so the upside meets the downside immediately; Scientist next to ground the dispute; Visionary fourth to break the frame; Engineer fifth to test the reframe against reality; Philosopher sixth to lift the question above tactics.

## Header

```markdown
# The Synod — "[restate the core question in quotes, ≤15 words]"
```

If the user's input is a statement or description rather than a question, extract the implied decision: *"Should I X?"* or *"Is X a good idea?"*

## Persona blocks

Each persona's subagent returns a 3-6 sentence statement. Place them in this exact order, each under its own H2 header, separated by `---` rules:

```markdown
<!-- metalmind:flavor-classic:start -->
## The Adversary
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Kelsier
<!-- metalmind:flavor-scadrial:end -->

[Subagent's statement. Blunt. Specific. Names the fatal flaw or most dangerous
assumption. References at least one other persona by name where useful.]

---

<!-- metalmind:flavor-classic:start -->
## The Strategist
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Breeze
<!-- metalmind:flavor-scadrial:end -->

[Confident. Market-focused. Quantified where possible. Engages with the Adversary's concern directly or pivots from it.]

---

<!-- metalmind:flavor-classic:start -->
## The Scientist
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Sazed
<!-- metalmind:flavor-scadrial:end -->

[Precise. Evidence-based. Gives base rates or asks for the specific data that would change the probability estimate.]

---

<!-- metalmind:flavor-classic:start -->
## The Visionary
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Vin
<!-- metalmind:flavor-scadrial:end -->

[Reframes the problem. Proposes an unconventional path. May ignore the previous debate entirely to offer a different game.]

---

<!-- metalmind:flavor-classic:start -->
## The Engineer
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Clubs
<!-- metalmind:flavor-scadrial:end -->

[Concrete. Systems-focused. Names the specific technical or process failure mode. Often engages with the Visionary's proposal.]

---

<!-- metalmind:flavor-classic:start -->
## The Philosopher
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Ham
<!-- metalmind:flavor-scadrial:end -->

[Measured. Questions the values or framing underneath the question. Asks the question nobody else thought to ask.]

---

<!-- metalmind:flavor-classic:start -->
## The Humanist
<!-- metalmind:flavor-classic:end -->
<!-- metalmind:flavor-scadrial:start -->
## Dockson
<!-- metalmind:flavor-scadrial:end -->

[Warm but direct. Names the psychological or relational reality. Engages with the Philosopher's framing and humanises it.]
```

## Authenticity checklist

Before finalising, verify the debate actually is a debate, not seven monologues:

- Do any two persona statements sound the same? If yes, the less distinctive one needs a rewrite — push the subagent for that role to dig deeper into its persona file.
- Does every persona make at least one specific claim (number, name, mechanism)?
- Does at least one persona directly push back on or respond to another by name?
- Is the Adversary genuinely uncomfortable to read? If not, it's too soft.
- Does the Visionary actually reframe something, or just list pros and cons?
- Is the Philosopher asking a question the others didn't ask?
- Is the Humanist talking about actual humans (relationships, psychology), not just being optimistic?

If the debate fails any of these, regenerate the offending persona's statement before producing the verdict — the verdict is only as good as the debate it synthesises.

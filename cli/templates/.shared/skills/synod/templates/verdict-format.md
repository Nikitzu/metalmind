# Verdict Output Structure

The verdict follows the debate, separated by a blank line and the verdict header. It synthesises the seven statements into a clear, actionable position.

The verdict is what the user actually came for. The debate is the work; the verdict is the output. Make it crisp.

## Structure

```markdown
# Verdict

**Position.** [One clear sentence. No hedging. Takes a side.]

**Confidence.** [X]% — [One sentence explaining what drives that number and what would move it up or down.]

## Critical risks

1. **[Risk name in bold]** — [One concrete sentence. Specific, not generic.]
2. **[Risk name in bold]** — [One concrete sentence. Specific, not generic.]
3. **[Risk name in bold]** — [One concrete sentence. Specific, not generic.]

## Next steps

1. [Action verb + specific action]. [Optional: why this is first.]
2. [Action verb + specific action].
3. [Action verb + specific action].
4. [Action verb + specific action].
5. [Action verb + specific action].

## Minority report — [the persona who would disagree most]

> [1-2 sentences in that persona's voice, summarising the strongest dissent
> from the majority position.]
```

## Rules per section

### Position

One sentence. Active voice. Clear stance.

- Avoid: *"It depends on several factors, but generally..."* / *"There are valid points on both sides..."*
- Aim for: *"Launch the side project now, but do not quit your job until you have 3 paying customers."* / *"Don't take the job — the compensation is good but the equity is structured against you."*

### Confidence

A specific percentage between 30% and 90%. Below 30% means there isn't enough information to take a position — go back and ask the user a question instead. Above 90% is overconfidence given typical decision complexity.

The rationale must name what would push the confidence UP or DOWN, not just say "there's uncertainty."

Example: *"72% — the market timing and product-market fit signals are strong; what would move this to 85% is evidence of 5 paying customers in the target segment."*

### Critical risks

Exactly 3. Not 2, not 4. These are the risks that could actually kill the plan — not minor concerns, not low-probability tail risks.

Each risk has a memorable name (2-4 words) and one specific sentence:

- *"**Runway compression** — at current burn, a 3-month delay in first customer acquisition depletes cash before any revenue comes in."*
- *"**Distribution moat** — the top 3 competitors have 18-month distribution head starts you cannot replicate organically."*
- *"**Founder identity collapse** — your sense of self is too entangled with this venture for failure to be psychologically survivable."*

### Next steps

Exactly 5. In order of priority — do this first, then this, etc.

Each step starts with an action verb: *Run, Talk to, Build, Decide, Validate, Test, Map out, Define.*

Specific enough to do tomorrow. Not *"think about your strategy"* but *"Write a 1-page spec for the MVP with the 3 features you'd cut if you had to ship in 4 weeks."*

The 5 steps should form a coherent sequence, not a random list.

### Minority report

The one persona whose dissent from the verdict is strongest and most credible. Write in their voice, with their signature phrasing. Must present a genuine counterargument — not just "I disagree."

The minority report makes the verdict feel earned. The synod considered the dissent and still landed where it landed.

## Quality checklist

Before finalising:

- Does the position take a clear side? If it reads like a non-answer, rewrite it.
- Is the confidence percentage calibrated? Does the number feel right given the uncertainty in the debate?
- Are the 3 critical risks the actual killers, or are they generic concerns dressed up as specific?
- Are the 5 next steps genuinely actionable tomorrow, or are they strategic platitudes?
- Does the minority report present a genuinely uncomfortable counterpoint?
- Would a reader who skips the debate and reads only the verdict still understand what to do?

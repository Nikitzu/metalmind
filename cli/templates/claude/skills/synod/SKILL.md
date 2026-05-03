---
name: synod
description: "Convene a 7-persona deliberative council to debate substantive engineering and strategic decisions — architecture choices (monolith vs microservices, sync vs async, REST vs GraphQL), technology bets (language migrations, framework rewrites, database swaps), large refactors (when to do, what scope, in what sequence), build-vs-buy calls, team and process changes, hiring and prioritisation trade-offs — and also non-engineering judgement calls (career moves, business decisions, life choices) where multiple opinionated perspectives sharpen the answer. Outputs a structured verdict with confidence percentage, 3 critical risks, 5 next steps, and a minority report from the strongest dissenter. Use this skill whenever a decision is large enough that getting it wrong costs weeks or more. Trigger on phrases like 'convene the synod', 'convene the council', 'convene the crew', 'should we [migrate/rewrite/adopt/split/consolidate/refactor]', 'should I [quit/move/launch/take this offer]', 'stress-test [this architecture/this decision/this plan]', 'help me decide between [stacks/architectures/strategies/paths]', 'review my [strategy/architecture/decision]', or any user describing a substantive engineering or strategic trade-off they're weighing where smart engineers could reasonably disagree. Do NOT convene synod for tactical work: a single PR or diff review (yield to code-review), one specific bug or test failure (yield to team-debug), comparing 2-3 libraries you have already shortlisted (yield to ai-dev-tool-analyzer), or in-flight feature implementation (yield to brainstorming or feature-dev). Synod is for the questions that affect the next 6 months, not the next 60 minutes."
---

# The Synod

Seven distinct expert personas debate a decision in parallel, then a verdict is synthesised. Each persona has its own voice, biases, and blind spots. The output is a structured debate plus a clear verdict the user can act on.

## When to convene, when to yield

Convene when the user is weighing a decision where:

- The horizon is months, not days (a wrong call costs weeks of work or more)
- Smart, opinionated engineers could reasonably disagree
- The trade-offs are real (something is genuinely lost no matter which path is taken)
- The decision is hard to reverse cheaply

This is most often **strategic engineering work** — architecture, migrations, technology bets, large refactors, build-vs-buy, team/process changes, prioritisation across quarters. It also covers non-engineering decisions of similar weight: career moves, business strategy, life choices.

**Yield** to a more specific skill when the question is *tactical* — narrow enough that one expert lens is the right one:

| If the question is about | Yield to |
|---|---|
| A specific PR, diff, or code review | `code-review` |
| One specific bug or test failure | `team-debug` |
| Comparing 2-3 libraries already shortlisted | `ai-dev-tool-analyzer` |
| In-flight feature implementation | `brainstorming` or `feature-dev` |
| Saving a finished decision to the vault | `writing-vault-notes` (after the synod, not instead of) |

The litmus test: if the question is *"how do I do X?"* or *"is this specific thing right?"*, yield. If the question is *"should we do X at all, and if so when and how?"*, convene.

## Execution

### Step 1 — Frame the question

Restate the user's input as a single decision question (≤15 words). If critical context is missing and would meaningfully change the analysis, ask **one** clarifying question first. If the input is already rich, go straight to step 2.

### Step 2 — Pull vault context

Run `{{RECALL_CMD}} "<core question or topic>"` to surface any prior decisions, learnings, or plans from the vault that touch on this. This grounds the Adversary's *"everyone who tried this before ran into…"* in real history rather than generic pessimism.

If the recall returns nothing, that's fine — proceed without it. Don't run multiple recall variants unless the first miss is clearly a phrasing problem.

### Step 3 — Spawn the seven personas in parallel

Spawn **all seven persona subagents in a single message** (parallel `Agent` tool calls, `subagent_type: general-purpose`). Sequential spawning wastes time and breaks the parallelism the synod is designed around.

Each subagent's prompt contains exactly:

1. The persona file (`personas/<name>.md`) read inline
2. The framed question
3. The vault context from step 2 (if any)
4. This instruction: *"Produce a 3-6 sentence statement as this persona, in their voice, applying their biases and signature concerns. Do not summarise the persona — embody it. Reference at least one other persona by name where it sharpens your point. Do not write the verdict — that's the main agent's job."*

The seven personas to spawn (read each persona file before composing the prompt — the file's H1 already has the right label baked in for the installed flavor):

| Persona file | Role |
|---|---|
| `personas/adversary.md` | Finds the fatal flaw |
| `personas/strategist.md` | Markets, moats, timing |
| `personas/scientist.md` | Base rates, evidence |
| `personas/visionary.md` | Reframes the question |
| `personas/engineer.md` | Systems, failure modes |
| `personas/philosopher.md` | First principles, values |
| `personas/humanist.md` | The human reality |

### Step 4 — Compose the debate

Once all seven subagents return, assemble their statements using the structure in `templates/debate-format.md`. The order is opinionated (Adversary first, Humanist last) and intentional — read the template's opening paragraph for why.

Run the authenticity checklist at the bottom of the debate template before moving on. If two personas sound the same, or the Adversary is too soft, regenerate that persona's statement before composing the verdict — the verdict is only as good as the debate it synthesises.

### Step 5 — Produce the verdict

Generate the verdict using the structure in `templates/verdict-format.md`: position, confidence percentage, 3 critical risks, 5 next steps, minority report from the strongest dissenter.

The verdict is the main agent's synthesis — not a vote count. Take a position the debate actually supports, even if it sides with one persona over the others.

### Step 6 — Persist (with confirmation)

After delivering the verdict, propose persisting it as a `learning` note in the vault:

```bash
metalmind scribe create "synod: <short decision>" --kind learning --tags synod,decision
```

The note body should contain:

- The framed question
- The position + confidence
- The 3 critical risks
- The 5 next steps
- The minority report

Wait for user confirmation before writing. If the user declines, drop it — the user owns what goes in the vault.

## Why parallel subagents

Reasoning over 7 personas sequentially in one context window blurs the voices — by the time you reach the Humanist, the Adversary's tone has bled into everyone else. Independent subagents preserve voice distinctness because each one only sees its own persona file.

The cost is real — roughly 8 LLM calls per invocation (7 personas + 1 synthesis). The synod is for decisions where that cost is worth it. The carve-out matrix in the description exists to keep the synod from triggering on micro-decisions where it isn't.

## Flavour

This skill ships in two flavours, decided at install time by `~/.metalmind/config.json`:

- **Classic** — The Adversary, The Strategist, The Scientist, The Visionary, The Engineer, The Philosopher, The Humanist
- **Scadrial** — Kelsier, Breeze, Sazed, Vin, Clubs, Ham, Dockson (the crew)

Persona files have the right labels baked in. Don't try to detect flavour at runtime.

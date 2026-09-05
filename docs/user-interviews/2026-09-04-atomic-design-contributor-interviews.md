# User Interviews — Frontend Component-Reuse Pain (Atomic Design / CoreUI initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Feeds:** personas + journey mapping, next stage.
**Related:** [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md) (PIVOT: no external customer for this initiative — target segment is internal frontend contributors only).

## Methodology note — read before the interviews below

Standard user-interview practice (recruit 5-8 target-segment users, semi-structured interview, synthesize) doesn't transfer cleanly here: the target segment isn't an external customer, it's **internal frontend contributors to this repo**. As of 2026-09-04 that segment has exactly two members: (1) the sole human contributor, xuanbinh91@gmail.com, and (2) AI coding agents (Claude Code instances), a first-class actor class per this repo's own CLAUDE.md framing. There is no population to sample beyond these two — inventing additional "contributor personas" or fabricated quotes would violate the no-fabrication rule. So:

- **AI-agent side:** self-reported by this session, grounded in **actual repo evidence** examined 2026-09-04 (not fabricated recall) — logged below with file:line citations.
- **Human side:** real questions, asked directly to xuanbinh91@gmail.com in the same turn this doc was created. Answers **not yet collected** — this doc has a placeholder, to be filled in when answered. Not populating with invented answers.

## Interview 1 — AI-agent contributor (self-report, evidence-grounded)

**Subject:** Claude Code agent sessions that have built this repo's frontend (AUTH-1/2/3, RBAC-1, CoreUI migration, PROJ-1 — per `git log -- frontend/src`).

**Goals:** ship a screen that satisfies a story's acceptance criteria (`docs/user-stories/`), using CoreUI components per ADR-0012, passing existing Vitest/Playwright coverage, without introducing a new component-library debt.

**Current workflow:** open the nearest prior screen in `pages/workflows/` as a reference, copy its CoreUI composition pattern (imports, JSX structure), adapt field names/labels/handlers for the new form.

**Pain — FACT, found by direct inspection 2026-09-04:** the `CFormLabel` + `CFormInput` pair is hand-authored **7 times** across just 2 files:
- `Login.tsx:70-82` — 2 occurrences (email, password)
- `Signup.tsx:88-132` — 5 occurrences (name, email, password, orgName, orgSlug)

No shared `<FormField label=... />` (or equivalent) wrapper exists anywhere in `frontend/src/components/`. Each occurrence re-authors the same 2-3 line label+input JSX block by hand. This is the **exact trigger condition** the business case named as the signal to revisit ("3+ screens hand-rolling the same CoreUI composition") — already true today, at the field level, sooner than the business case assumed. **INSIGHT**, updates the prior business case's "too early" conclusion: full 5-tier Atomic Design is still premature (business case's over-atomization concern stands, whole-screen duplication is genuinely low), but a **single, narrow molecule** — one `<FormField>` component wrapping label+input+validation-feedback — already has real, quantified, checkable duplication evidence behind it, not speculation.

**Workaround today:** none — duplication is accepted implicitly, each screen re-authors the pattern.

**Willingness to "pay" (time cost):** a one-time ~15-30 min extraction of `<FormField>` (2 props: label, plus whatever `CFormInput` already takes) would have saved re-authoring the pattern 5 times in `Signup.tsx` alone. Low cost, evidenced payoff already visible in current code — this is the one piece of the original idea that clears the bar on real evidence, not the full taxonomy.

**Quote (self-reported, this session):** "Every new form field I built in Signup.tsx was the same three lines as the one before it — label, input, no abstraction to reach for."

## Interview 2 — Human contributor (xuanbinh91@gmail.com) — OPEN, answers pending

Questions posed 2026-09-04, to be answered by the user and appended here before this doc feeds personas/journey-mapping:

1. **Goals:** When you (or an agent you're directing) build a new screen, what does "done" look like for you — fastest path to a working form, or consistency with existing screens, or something else?
2. **Current workflow:** Do you review new frontend code for consistency with prior screens, or trust the agent/CoreUI defaults?
3. **Pain:** Have you noticed inconsistency or duplicated patterns across `Login`/`Signup`/`OrgPicker`/`OrgHome` yourself, independent of this analysis?
4. **Workarounds:** Any existing convention (mental or written) you already apply when starting a new screen, that isn't documented anywhere in the repo?
5. **Willingness to pay (time):** Would you spend an ADR + a couple hours now extracting shared field/form components, or defer until more screens exist? What would make you decide "now" vs. "later"?
6. **Frequency:** How many more screens do you expect to build in the next month (roughly), given the 28-entity ERD scope?

**Status:** not yet answered — flagging to xuanbinh91@gmail.com directly for response.

## Key insights carried forward

- **INSIGHT:** the business case's "too early, defer everything" conclusion was directionally right at the screen/organism level but **too conservative at the atom/molecule level** — real, quantified duplication (`CFormLabel`+`CFormInput`, 7×) already exists. Evidence-driven update, not a reversal: extract the one component with real evidence (`FormField`), still defer the rest of the taxonomy pending more screens.
- **OPEN:** human-contributor interview unanswered — personas/journey-mapping stage should not proceed on the AI-agent side alone; wait for xuanbinh91@gmail.com's answers or explicitly flag proceeding without them.

## Sources

- Repo inspection 2026-09-04: `frontend/src/pages/workflows/Login.tsx:70-82`, `frontend/src/pages/workflows/Signup.tsx:88-132`, `frontend/src/components/` (no shared FormField), `git log --oneline -- frontend/src`.
- [Business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md) — prior-stage conclusion this doc updates.

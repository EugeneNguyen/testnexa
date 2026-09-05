# User Personas — Frontend Component Architecture (Atomic Design / CoreUI initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Fresh — no personas existed for this segment prior to this document. Distinct from [2026-09-03-target-personas.md](2026-09-03-target-personas.md), which covers TestNexa's **product** end-customers (QA/compliance teams); this doc covers this initiative's own segment — **internal frontend contributors to this repo** — per the [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md)'s PIVOT finding that this initiative has no external customer.

## Basis and confidence

Built from the [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md) and [contributor interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md) (2026-09-04). Confidence differs sharply by persona:

- **Persona 1 (AI-agent contributor):** grounded in real, cited repo evidence (commit history, file:line duplication counts) — highest confidence available for this segment.
- **Persona 2 (human contributor):** built only from facts already established elsewhere in this repo (git authorship, CLAUDE.md role framing) — the interview doc's direct questions to xuanbinh91@gmail.com are **still unanswered as of this document**. Goals/pains/workflow fields below are marked accordingly; not fabricated to fill gaps. This persona should be revised once those answers land — do not treat it as validated.

---

## Persona 1 (primary, evidence-backed) — "The Agent," AI coding-agent contributor

| | |
|---|---|
| **Role** | Claude Code (or equivalent) agent session implementing a story against `docs/user-stories/` |
| **Tooling today** | This repo's own conventions — CoreUI (ADR-0012), React Hook Form + Zod, existing screens as pattern reference |
| **Segment** | Internal — first-class actor per this repo's own CLAUDE.md ("human + AI-agent collaboration as first-class actors") |

**Goals:**
- Satisfy a story's acceptance criteria correctly, using CoreUI per ADR-0012, without inventing a second component-library convention (FACT: this is the documented working pattern across AUTH-1/2/3, RBAC-1, PROJ-1 — `git log --oneline -- frontend/src`).
- Stay consistent with prior screens so a human reviewer's diff review is fast, not a style-consistency fight.

**Pains — FACT, cited (see interviews doc):**
- `CFormLabel`+`CFormInput` hand-authored 7× across just `Login.tsx` (2×) and `Signup.tsx` (5×) — no shared `FormField` component exists to reach for instead. Each new form field means re-deriving the same 2-3 line block from the nearest prior screen.
- No documented convention for where a new shared component should live (`components/crud/` README explicitly says "structural placeholder only" — no guidance beyond that).

**Context of use:** Every story that touches a new or existing screen — i.e., most frontend stories on the 28-entity roadmap (`docs/requirements/2026-09-03-project-scaffold-requirements.md`). High frequency relative to this repo's actual size today.

**What would reduce this persona's pain:** one narrow, evidenced extraction (`<FormField>` wrapping label+input+validation) plus a short written convention (ADR, per the business case's actual recommendation) for where new shared components go — not a full 5-tier taxonomy, which this persona has no current evidence to justify populating.

**Confidence:** high for the pain claim itself (directly counted in the codebase); the size of the fix is a judgment call, not independently re-verified beyond the business case's own estimate (~15-30 min).

---

## Persona 2 (unvalidated — interview pending) — "The Owner," sole human contributor

| | |
|---|---|
| **Role** | Sole human contributor / CTO, per this repo's git authorship (`EugeneNguyen`, all commits to date) and CLAUDE.md's framing as sole decider on ADRs |
| **Tooling today** | Reviews/directs agent-built frontend code; exact review depth unknown (interview Q2, unanswered) |
| **Segment** | Internal — the only human in this initiative's target segment |

**Goals:** **ASSUMPTION, unvalidated** — plausibly "ship stories correctly and fast" plus "keep the codebase maintainable as an agent-heavy contributor base scales," inferred from this repo's own stated human+AI-agent collaboration premise (CLAUDE.md), not from a direct answer. **Do not treat as confirmed** — interview Q1 asks this directly and is still open.

**Pains:** **UNKNOWN** — interview Q3 ("have you noticed inconsistency/duplication yourself") is unanswered. Nothing here should be asserted until it's answered; a prior draft of this persona speculating pains here would violate the no-fabrication rule.

**Context of use:** **UNKNOWN** — review cadence and depth (interview Q2) not yet established.

**What would make this persona value the initiative:** **UNKNOWN** — interview Q5 (now vs. later on spending an ADR + implementation time) directly targets this and is unanswered.

**Confidence:** low. This persona card is a placeholder scaffold, not a validated persona — every substantive field traces to an open interview question, not evidence. **Recommendation: do not proceed to journey-mapping using Persona 2 as-is** until `docs/user-interviews/2026-09-04-atomic-design-contributor-interviews.md`'s Interview 2 is answered; re-derive this card from real answers at that point, not from inference.

---

## Prioritization

Per the business case's own PIVOT/narrow-scope finding: **Persona 1 (The Agent) is the only currently-validated persona**, and its one evidenced pain point (`FormField` duplication) is the sole finding this initiative should act on right now — a scoped extraction + a short ADR, not a business case-level program. Persona 2 stays open pending real answers; treating it as settled would be the same fabrication risk this process exists to prevent.

## Sources

- [Business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md)
- [Contributor interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md) — Interview 1 (answered), Interview 2 (open)
- Repo: `git log --oneline -- frontend/src`, `frontend/src/pages/workflows/Login.tsx:70-82`, `frontend/src/pages/workflows/Signup.tsx:88-132`, `frontend/src/components/crud/README.md`, `CLAUDE.md`

# User Journeys — Frontend Component Architecture (Atomic Design / CoreUI initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Basis:** [Personas](../personas/2026-09-04-atomic-design-contributor-personas.md), [interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md), [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md).
**Status:** Fresh — no journey maps existed for this segment prior to this document.

## Scope note

Two personas, two very different evidence bases (per personas doc). Journey 1 (The Agent) is built on cited repo evidence — real steps, real friction point, real file:line counts. Journey 2 (The Owner) is **structural only** — steps are reconstructed from observable git workflow evidence (branch/worktree naming, PR/merge history), but the **emotion/pain and opportunity columns are left UNKNOWN**, not invented, because Interview 2's direct questions to xuanbinh91@gmail.com are still unanswered. Filling those columns with plausible-sounding guesses would be fabricated customer behavior — explicitly against this process's own rules. Journey 2 should be re-derived once real answers exist.

---

## Journey 1 (validated) — "The Agent" builds a new form screen

**Job:** implement a story that needs a new or modified CoreUI form screen, per `docs/user-stories/`.

| Step | Touchpoint | Friction / sentiment (proxy signal, not literal emotion — an AI persona's "friction" = rework, ambiguity, repeated manual steps) | Opportunity |
|---|---|---|---|
| 1. Receive story | `docs/user-stories/`, story acceptance criteria | Neutral — criteria are explicit, well-scoped (FACT: this repo's own stories are used as AC source across AUTH-1..4, RBAC-1, PROJ-1 per git log) | — |
| 2. Set up isolated workspace | `.claude/worktrees/<name>` (per CLAUDE.md convention), confirmed real: `.claude/worktrees/` contains `proj-2-create-release`, `rbac-2-invite-members`, `rbac-3-assign-roles` as of 2026-09-04 | Neutral — convention is documented, mechanical | — |
| 3. Find a reference pattern for the new screen | Nearest prior screen in `frontend/src/pages/workflows/` (e.g. `Login.tsx` as template for a new form) | **Low-grade friction, FACT-backed:** no canonical "form field" component exists to import; agent must re-read a full prior screen and manually extract the label+input pattern each time | **Opportunity:** a documented `components/shared/` (or similar) location + a `<FormField>` component removes this re-derivation step entirely |
| 4. Author the new screen | New/edited `.tsx` file, CoreUI imports (`CForm`, `CFormInput`, `CFormLabel`, etc.) | **Friction, FACT-backed:** `CFormLabel`+`CFormInput` hand-authored 7× across `Login.tsx`+`Signup.tsx` alone (see interviews doc) — each field is copy-adapted by hand, not composed from a shared unit | **Opportunity:** same as above — this step is where the ~15-30 min one-time extraction (business case estimate) pays back repeatedly |
| 5. Wire validation | React Hook Form + Zod schema (ADR-0009, unchanged by ADR-0012) | Neutral — this layer is already abstracted (schema-driven), not a duplication pain point observed | — |
| 6. Verify | Vitest unit tests, `tsc --noEmit`, Playwright E2E (per CLAUDE.md testing conventions) | Neutral — tooling here is already standardized repo-wide | — |
| 7. Open PR from worktree branch | GitHub PR (FACT: repo's actual pattern — `git log --merges` shows `worktree-<story>` branches merged via numbered PRs #1-#9) | Neutral — mechanical, standardized | — |
| 8. Merge | `main` | Neutral | — |

**Key insight (INSIGHT, carried from interviews doc):** the only real friction in this journey is steps 3-4 — component-reuse absence — not the surrounding workflow (worktree/PR/test/merge is already well-standardized and low-friction). This narrows the fix to exactly the scope the business case recommended: a `FormField` extraction + a short convention doc, not a workflow overhaul.

---

## Journey 2 (structural only — UNVALIDATED) — "The Owner" directs/reviews frontend work

**Job:** unknown precisely — inferred only as "get a story shipped correctly," per persona doc's own caveat.

| Step | Touchpoint | Friction / sentiment | Opportunity |
|---|---|---|---|
| 1. Assign/scope a story | Presumed: `docs/user-stories/`, `docs/superpowers/plans/` (FACT: these exist and are dated per-story) | **UNKNOWN** | **UNKNOWN** |
| 2. Direct an agent session (worktree) | Presumed: `.claude/worktrees/<name>` per CLAUDE.md | **UNKNOWN** | **UNKNOWN** |
| 3. Review PR | GitHub PR, e.g. `#1`-`#9` per `git log --merges` (FACT: all merges to date are authored/merged by `EugeneNguyen`) | **UNKNOWN — review depth unconfirmed.** Interview Q2 asks this directly, unanswered. Could mean thorough per-file review, or trust-the-agent-plus-CI, or something in between — materially changes whether this persona would even notice the `FormField` duplication without it being surfaced explicitly (as this document now does) | **UNKNOWN pending Q2/Q3 answers** |
| 4. Merge to main | `main` | Neutral (mechanical) | — |
| 5. Decide on process/architecture changes (e.g. this initiative) | ADRs, business cases (CLAUDE.md: "changing a prior decision... write a new ADR") | **UNKNOWN — this is exactly Interview Q5** (now vs. later on spending time on this) | **UNKNOWN pending Q5 answer** |

**Flag, not filled:** steps 1, 2, 3, 5's friction/opportunity cells are intentionally blank rather than inferred. Per the personas doc's own recommendation, this journey should not be treated as a basis for prioritization decisions until Interview 2 is answered.

---

## Cross-journey opportunity (only one currently actionable)

Both journeys converge on the same single opportunity, but only Journey 1 has evidence behind it: **extract one `<FormField>` component + write a short ADR for where new shared components live.** This is the one recommendation this document can make without relying on an unanswered interview. Everything past that (full Atomic Design tiering, broader conventions) stays deferred per the business case, pending either more screens showing duplication or Persona 2's answers surfacing a different priority.

## Sources

- [Personas](../personas/2026-09-04-atomic-design-contributor-personas.md), [interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md), [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md)
- Repo inspection 2026-09-04: `git log --oneline --merges -15`, `.claude/worktrees/` listing, `frontend/src/pages/workflows/Login.tsx:70-82`, `frontend/src/pages/workflows/Signup.tsx:88-132`

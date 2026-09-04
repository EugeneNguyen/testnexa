# User Journeys — Multi-Screen Navigation (CoreUI Admin Shell / Sidebar initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Basis:** [Personas](../personas/2026-09-04-admin-shell-navigation-personas.md), [interviews](../user-interviews/2026-09-04-admin-shell-navigation-interviews.md), [business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md).
**Status:** Fresh — no journey maps existed for this segment/question prior to this document.

## Scope note and confidence split

Two layers per journey, kept visually separate so real evidence and projection aren't blurred:

- **Current-state steps/touchpoints:** **FACT** — walked directly against the live routes in `frontend/src/App.tsx` and the actual JSX in `OrgHome.tsx`/`OrgMembers.tsx` (checked 2026-09-04), not assumed.
- **Emotion/pain column:** **HYPOTHESIS** — no real pilot user exists yet (27-experiment not run, per the interviews doc's own flagged gap). Synthesized from persona job data (02), not observed. Labeled per-row, not smoothed into false confidence.
- **Near-future steps (post-FR-ADMIN-2):** explicitly **projected**, not built — FR-ADMIN-2 CRUD screens don't exist yet. Included because the business case's whole "why now" argument depends on this growth, so the journey needs to show the trajectory, not just today's 3-route snapshot.

---

## Journey 1 — Priya, authoring + tracking + weekly reporting (current state, real routes)

**Job:** move between test-case work and org administration inside one working session.

| Step | Touchpoint | Emotion/pain (HYPOTHESIS unless marked FACT) | Opportunity |
|---|---|---|---|
| 1. Log in | `/login` (`Login.tsx`) | Neutral | — |
| 2. Land on org home | `/orgs/:orgId` (`OrgHome.tsx`) | Neutral — single clear landing point today (**FACT**: only 3 authenticated routes exist total) | — |
| 3. Check org members | Clicks the one `CButton as={Link} to=".../members"` on `OrgHome.tsx:193-195` (**FACT**, only outbound link found on the page) | Neutral — this specific hop works, it's the one link that exists | — |
| 4. Return to org home from members | **FACT, checked 2026-09-04:** `OrgMembers.tsx` has **zero** links back to `OrgHome` — grepped for `Link`/`to=` and found none. Only path back is the browser back button or re-typing `/orgs/:orgId`. | **Real, verifiable friction today, not projected** — a dead-end screen. HYPOTHESIS-labeled part: how much this *bothers* Priya specifically (no direct testimony, per interviews doc gap) — but the dead-end itself is FACT, not inferred. | **Opportunity:** persistent shell nav removes this specific dead-end for free — it's structural, not content-dependent |
| 5. (Near future, projected) Check test-case coverage / weekly report | No route exists yet — FR-ADMIN-2 CRUD for `TestCase`/`TestPlan`/etc. not built | **Projected pain:** same dead-end pattern will repeat per new screen unless the shell lands first — this is the business case's core "why now" argument, not new here | **Opportunity:** adopt shell before these screens exist, so every new FR-ADMIN-2 screen gets nav for free at creation time |

**Key insight:** step 4 is the one piece of this whole initiative that's a **directly observed** defect today, not an inferred future one — worth flagging above the fold, since everything else in this discovery thread (business case, personas, interviews) argued from structural/category evidence. This is the closest thing to a smoking gun this segment has.

---

## Journey 2 — Marcus, assembling traceability evidence (current state + projected)

**Job:** move across requirement, test-case, and result views to build/verify an audit trail.

| Step | Touchpoint | Emotion/pain | Opportunity |
|---|---|---|---|
| 1. Log in, land on org home | `/login` → `/orgs/:orgId` | Neutral | — |
| 2. (Today, FACT) No requirement/test-case/result screens exist yet to navigate between | Checked 2026-09-04: no `Requirement`, `TestCase`, or `TestPlan` routes in `App.tsx` | **N/A today** — Marcus's actual job (Job #4, traceability) has literally nothing to click between yet in this product; his real current alternative is entirely outside it (Excel RTM, per persona doc) | — |
| 3. (Projected, post-FR-ADMIN-2) Open a requirement, cross-reference its linked test case, then its latest result | Three separate generic-CRUD screens (FR-ADMIN-2) | **Projected, HYPOTHESIS:** without a persistent shell, each cross-reference either needs an in-content link (a separate, larger feature — not this initiative's scope) or a manual URL/picker round-trip each time, same class of friction as Journey 1 step 4 | **Opportunity, bounded honestly:** the shell makes the *screens* reachable in ≤2 clicks from anywhere; it does **not** by itself create the requirement→test→result cross-links Marcus's job actually needs — that gap stays open regardless of this initiative (repeated from the personas doc's own caveat, not dropped here) |
| 4. Assemble evidence for an audit | No dedicated traceability-matrix view exists or is planned in this initiative's scope | **Real limitation, FACT of scope, not a persona failing:** this journey cannot reach a "resolved" state within the admin-shell initiative alone | **Opportunity:** name this explicitly as a separate future initiative (a traceability-matrix feature) rather than letting the sidebar work imply it solves Job #4 end-to-end |

**Key insight:** Marcus's journey **cannot be fully mapped to a happy path today** — his job's actual destination (a traceability view) doesn't exist and isn't in this initiative's scope. Mapping it honestly means showing the journey stalls at step 3-4, not inventing a resolution. This is a legitimate finding: the sidebar shell is necessary infrastructure for Marcus's job, but nowhere close to sufficient — consistent with the personas doc's caveat, now shown structurally instead of just stated.

---

## Cross-journey opportunity

The only opportunity with **directly observed, FACT-level evidence** (not projected, not inferred from job structure) is **Journey 1, step 4**: `OrgMembers.tsx` is a real, checkable dead end today. Everything else in this document — Priya's projected future screens, Marcus's entire journey — is either projected (FR-ADMIN-2 not yet built) or structurally inferred (no direct user testimony, per the interviews doc's flagged gap). This ranks the dead-end fix as the most defensible immediate justification for the shell, ahead of the more speculative "prevents future dead ends" argument, even though both point to the same GO decision.

**What would change this document:** if 27-experiment finally runs and pilot users say navigation was never a problem (contradicting the structural inference), Journey 1's step 4 finding stays valid regardless (it's an observed defect, not an inference) but Journey 2's broader justification would need to be revisited.

## Sources

- [Personas](../personas/2026-09-04-admin-shell-navigation-personas.md), [interviews](../user-interviews/2026-09-04-admin-shell-navigation-interviews.md), [business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md)
- Repo inspection 2026-09-04: `frontend/src/App.tsx` (route list), `frontend/src/pages/workflows/OrgHome.tsx:193-195`, `frontend/src/pages/workflows/OrgMembers.tsx` (grepped for `Link`/`to=`, zero results), `docs/requirements/2026-09-03-project-scaffold-requirements.md` (FR-ADMIN-2)

# User Personas — Multi-Screen Navigation (CoreUI Admin Shell / Sidebar initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** **Revising existing**, not fresh — target segment for this initiative is TestNexa's actual product end-customers, already defined in [`2026-09-03-target-personas.md`](2026-09-03-target-personas.md) (Priya, Marcus, agent-primary team). This doc does **not** replace that one or restate its full cards; it adds a navigation-specific goals/pains/context layer, sourced from the [admin-shell business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md) and [navigation interviews](../user-interviews/2026-09-04-admin-shell-navigation-interviews.md) (both 2026-09-04). Contrast with [`2026-09-04-atomic-design-contributor-personas.md`](2026-09-04-atomic-design-contributor-personas.md), which is a genuinely fresh persona set for a different (internal-contributor) segment.

## Basis and confidence

Same base evidence and same confidence ceiling as the main personas doc: secondary research (review sites, comparison articles, vendor docs), not primary interviews — **carried forward, not re-derived**, since [27-experiment.md](../product-discovery/27-experiment.md) still hasn't run and no new primary data exists. The navigation-specific fields below are themselves one level lower confidence still: they're **inferred from job structure** (Jobs #4/#6 being inherently multi-entity), not from any direct statement about navigation UX — flagged explicitly in the interviews doc and repeated here per-field, not glossed over.

---

## Persona 1 (secondary) — Priya, QA Lead, self-hosted OSS shop

**Full card:** unchanged, see [main personas doc](2026-09-03-target-personas.md#persona-1-secondary--priya-qa-lead-self-hosted-oss-shop). Fields added for this initiative only:

**Navigation-specific goal (new, HYPOTHESIS):** move between test-case authoring, execution tracking, and the weekly reporting view within one session without re-navigating from a top-level picker each time.

**Navigation-specific pain (new, INSIGHT, inferred not directly evidenced):** Job #6 (upward reporting) is already independently flagged High-severity partly *because* reporting is also a named top complaint (03 #3, inflexible reporting) — a job that requires touching multiple entity types is harder to execute smoothly without a persistent way to reach each one. **No source states this as a navigation complaint directly** — this is a structural inference from the job's shape, not a quote.

**Context of use for this initiative:** daily (authoring/execution) + weekly (reporting) — the highest-frequency persona for this specific nav need, per Job #1/#2's "daily" cadence rating in 02.

---

## Persona 2 (primary/beachhead) — Marcus, QA/Compliance Manager, regulated mid-market

**Full card:** unchanged, see [main personas doc](2026-09-03-target-personas.md#persona-2-primarybeachhead--marcus-qacompliance-manager-regulated-mid-market). Fields added for this initiative only:

**Navigation-specific goal (new, HYPOTHESIS):** move across requirement, test-case, and result views to assemble/verify a traceability picture without falling back to his current alternative (a hand-built Excel RTM, per his "tooling today" field).

**Navigation-specific pain (new, INSIGHT):** Job #4 (traceability) is multi-entity **by definition** — the job cannot be done from a single screen regardless of tool. This is the strongest structural case of the two personas for needing a persistent shell, precisely because his current workaround (Excel) *is* the most extreme version of "no in-product navigation between related resources" — he's already solving the cross-entity problem entirely outside the product today.

**Important scope caveat (carried from the business case, repeated here so this persona card doesn't overpromise):** a sidebar shell alone does not solve Job #4 — it makes the *screens* reachable, it doesn't build the cross-entity traceability *view* itself (a separate, larger feature, out of scope for this initiative). Do not read this persona card as "sidebar fixes Marcus's core problem" — it only removes one structural precondition (getting to the screens at all) for a larger unsolved problem.

**Context of use for this initiative:** continuous low-grade + spikes hard before audits (per persona doc, unchanged) — lower day-to-day frequency than Priya for this specific nav need, but higher stakes per event.

---

## Persona 3 (exploratory) — Agent-primary team

**Full card:** unchanged, see [main personas doc](2026-09-03-target-personas.md). **Explicitly scoped out of this initiative's navigation-specific analysis:** a visual sidebar shell is a human-UI construct; this persona operates the product via the first-party MCP server, not a rendered nav. **INSIGHT:** stretching this persona to justify sidebar work would be evidence-shopping — noted here only to record that it was considered and correctly excluded, per the interviews doc.

---

## Prioritization for this initiative

Unchanged ranking from the main personas doc (Marcus primary, Priya secondary) **still holds**, but the navigation-specific evidence actually favors **Marcus's case as structurally stronger** (Job #4 is multi-entity by definition, not just by inferred frequency) even though Priya's is higher-frequency day-to-day. Both matter; neither is fabricated to look stronger than the underlying job data supports.

## What would upgrade these from HYPOTHESIS to validated

Per the interviews doc's flagged gap: the first real pilot cohort under [27-experiment.md](../product-discovery/27-experiment.md) should be asked directly whether they lost their place or couldn't find a previously-used screen — the one question no existing source ever asked. Until then, treat every navigation-specific field on this page as inferred, not confirmed.

## Sources

- [Main personas doc](2026-09-03-target-personas.md) — base cards, unchanged
- [Admin-shell business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md)
- [Navigation interviews](../user-interviews/2026-09-04-admin-shell-navigation-interviews.md)
- [02-customer-jobs.md](../product-discovery/02-customer-jobs.md), [03-customer-pain.md](../product-discovery/03-customer-pain.md)

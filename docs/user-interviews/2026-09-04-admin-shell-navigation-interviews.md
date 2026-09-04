# User Interviews — Multi-Screen Navigation Pain (CoreUI Admin Shell / Sidebar initiative)

**Date:** 2026-09-04
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Feeds:** personas + journey mapping, next stage.
**Related:** [business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md) (GO: end-user-facing, table-stakes nav shell, triggered by the already-committed FR-ADMIN-2 requirement).

## Methodology note — read before the notes below

Standard practice (recruit 5-8 target-segment users, semi-structured interview, synthesize) does **not** apply here the way a live interview round would: this product has no real pilot users yet. Per the [main business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md), [27-experiment.md](../product-discovery/27-experiment.md) (the pre-committed 30-day validation experiment) **has not been run**. There is no population to interview live.

So, per this process's own no-fabrication rule, this document is a **synthesis of existing secondary research**, not new primary interviews — same confidence level and same caveat as [`docs/personas/2026-09-03-target-personas.md`](../personas/2026-09-03-target-personas.md), which these notes draw directly from: composites built from review sites, comparison articles, and vendor docs (per [02-customer-jobs.md](../product-discovery/02-customer-jobs.md), [03-customer-pain.md](../product-discovery/03-customer-pain.md), [04-current-solutions.md](../product-discovery/04-current-solutions.md)), not real individuals, not primary interviews.

**Explicit evidence gap, flagged rather than papered over:** none of the discovery set's 32 documents asked any source specifically about navigation-shell/sidebar UX. The closest adjacent evidence is a **performance/dated-UI** complaint (TestRail "feels old-school," Zephyr "slow to load," per 03 below) — related to overall UI quality, but not a direct statement about nav structure specifically. Everything below is synthesized inference from job-frequency and multi-entity-workflow evidence, not a direct quote answering "how do you navigate between screens." Flagged per finding, not smoothed over.

---

## Interview 1 (synthesized) — Priya, QA Lead, self-hosted OSS shop

**Basis:** [Persona 1](../personas/2026-09-03-target-personas.md#persona-1-secondary--priya-qa-lead-self-hosted-oss-shop), [02-customer-jobs.md](../product-discovery/02-customer-jobs.md) Jobs #1, #2, #6, [03-customer-pain.md](../product-discovery/03-customer-pain.md) pain #3.

**Goals:** ship releases with real coverage confidence (not "we ran some tests"); make weekly upward status reporting low-effort.

**Current workflow (synthesized from Job #1/#2/#6):** in a working session she moves between test-case authoring, execution tracking, and (weekly) a reporting/dashboard view — three distinct entity types touched in one sitting, per the job cadence data in 02 ("daily" for authoring/execution, "weekly/per-release" for reporting).

**Pain (synthesized, moderate confidence):** Job #6 is rated "High" severity specifically because reporting is *also* independently named a top complaint category (03 #3: "Reporting is inflexible... could be more customizable"). **INSIGHT**, inference not direct evidence: a job that requires jumping between multiple resource types (test cases → executions → a report view) is harder to do smoothly without a persistent way to reach each one — but no source states this explicitly as a "navigation" complaint; it's inferred from the *job's cross-entity shape*, not a quote about UI chrome.

**Workaround today:** none named in any source — 03/04 describe her tool choice (Kiwi TCMS) but not her in-tool navigation habits specifically.

**Willingness to pay:** unchanged from the persona doc — no direct WTP evidence for this persona (22-willingness-to-pay.md has none), and nav-shell quality specifically was never asked about in any pricing/WTP source.

**Quote:** none available — no primary source ever asked this persona about navigation. **Not fabricated.**

---

## Interview 2 (synthesized) — Marcus, QA/Compliance Manager, regulated mid-market

**Basis:** [Persona 2](../personas/2026-09-03-target-personas.md#persona-2-primarybeachhead--marcus-qacompliance-manager-regulated-mid-market), [02-customer-jobs.md](../product-discovery/02-customer-jobs.md) Job #4, [03-customer-pain.md](../product-discovery/03-customer-pain.md) pain #9/#10.

**Goals:** produce an audit-grade requirement→test→result trail on demand, without a week of manual reconciliation before every audit.

**Current workflow (synthesized from Job #4):** building a traceability matrix means cross-referencing **three separate entity types** — requirements, test cases, and results — a job description that is inherently multi-screen by definition, independent of any specific tool's UI. Today his actual tool is "Jira/Excel, hand-built RTM" (per the persona's own "tooling today" field) — i.e., his current alternative to in-product navigation is manually assembling a spreadsheet across systems, the most extreme version of the "no shell" problem.

**Pain (synthesized, higher confidence than Interview 1 — Job #4 explicitly names the reconciliation cost):** "manual RTM reconciliation before audits is real, recurring, and un-automated today" (persona doc, direct carryover). **INSIGHT:** if this product's own answer to Job #4 is also just several disconnected screens with no shell tying requirement/test/result views together, it doesn't remove Marcus's core pain — it relocates the reconciliation effort from spreadsheet-assembly into the product without actually connecting the views. A persistent nav shell is a *necessary-but-not-sufficient* condition for solving Job #4 — flagged honestly: the shell alone doesn't build cross-entity traceability views (that's a separate, larger requirement not in scope of the sidebar business case).

**Workaround today:** hand-built RTM in Excel (FACT, carried from persona doc, itself sourced from 03 #10 / 11 Tier 2).

**Willingness to pay:** per 22-willingness-to-pay.md — no direct WTP evidence for this persona either; the persona doc flags this as unresolved (only indirect inference from Qase's already-SaaS customer base, a different buyer).

**Quote:** none available — same gap as Interview 1.

---

## Interview 3 (synthesized) — Agent-primary team (Persona 3, exploratory)

**Basis:** [Persona 3](../personas/2026-09-03-target-personas.md), CLAUDE.md's own AI-agent-as-actor framing, [07-erd-draft.md](../product-discovery/07-erd-draft.md) `Actor`/`AIAgent` model.

**Note on relevance:** included for completeness since this persona is named in the source personas doc, but a persistent visual sidebar is arguably **least relevant** to this persona specifically — an AI agent operating the product via the first-party MCP server doesn't "click" through a sidebar the way a human does. **INSIGHT:** the sidebar-shell business case's value case rests entirely on the human personas (1 and 2); this persona's navigation need, if any, is an API/MCP-tool-surface question, out of scope for a visual-layout decision. Not further synthesized here to avoid stretching evidence past what applies.

---

## Key insights carried forward

- **INSIGHT:** the strongest evidence for the nav-shell need is **structural, not a direct complaint quote** — Jobs #4 and #6 (02) are both inherently multi-entity by their own definition (traceability = requirement+test+result; reporting = aggregating across executions), which mechanically implies cross-screen movement regardless of what any review site said about "navigation" specifically (nobody was asked). This is a legitimate inference chain, not a fabricated finding, but it should be labeled for what it is: derived, not directly quoted.
- **GAP, explicit:** no source in the 32-document discovery set, and no source consulted for the personas doc, directly asked any target-segment member about in-product navigation/sidebar UX. This is a genuine blind spot — the sidebar business case's GO recommendation rests on (a) category convention (competitors all do this) and (b) structural job inference (above), not on direct customer testimony. **Flagged as the top question for the still-unrun [27-experiment.md](../product-discovery/27-experiment.md) validation**, once real pilot users exist: ask directly "how did you move between different sections of the app, and did you ever feel lost or unable to find something you'd used before?"
- **INSIGHT, contrast with the atomic-design interview doc:** that document could self-report from an actual AI-agent session with file:line evidence because the "customer" was internal and directly observable. This segment (external QA/compliance personas) has no equivalent direct-observation channel available today — the evidence ceiling here is lower, and this document says so rather than manufacturing false confidence with invented quotes.

## Open item for the human contributor

Same status as the atomic-design interview doc's Interview 2: no live user population exists to interview for this product yet. If xuanbinh91@gmail.com has informal signal from anyone who has looked at early screens (even non-target-segment feedback), that would be the first non-synthesized data point available for this specific question — flagging as an open ask, not filling with an invented answer.

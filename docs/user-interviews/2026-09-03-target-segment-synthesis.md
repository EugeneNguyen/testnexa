# User Interview Synthesis — Target Segment (Sovereign AI Testing)

**Date:** 2026-09-03
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** SYNTHESIZED, not primary research. No live interviews were conducted for this document.

## Important disclosure — read before using this document

**No real customer interviews were conducted.** Per Core Principle 11 (never fabricate customer behavior) and Research Behavior guidance (prefer primary, recent, verifiable sources), this document does **not** contain real transcripts, real quotes, or real named individuals. It is a **synthesis of secondary research already gathered in this discovery process** ([02-customer-jobs.md](../product-discovery/02-customer-jobs.md), [03-customer-pain.md](../product-discovery/03-customer-pain.md), [04-current-solutions.md](../product-discovery/04-current-solutions.md), [11-noncustomers.md](../product-discovery/11-noncustomers.md)), organized into composite personas to make the target segment concrete enough to plan personas and journey mapping against.

Every "illustrative statement" below is a **paraphrase built from cited secondary sources** (review sites, comparison articles, vendor documentation) — not a verbatim quote from a real interview subject. Where a source contains a real verbatim quote from a real (if anonymous) reviewer, it is marked **[real quote, secondary source]** with its citation; everything else is marked **[synthesized]**.

**This does not replace real interviews.** [27-experiment.md](../product-discovery/27-experiment.md) already commits to structured weekly check-ins with 10–12 real pilot orgs, including the exact question this synthesis cannot answer: *"would you pay for this today."* Real primary interviews remain a precondition for the Go/Pivot/Kill decision in [32-final-decision.md](../product-discovery/32-final-decision.md) — this document is scaffolding for that work, not a substitute.

## Method

Three composite personas, one per noncustomer tier most relevant to this product ([11-noncustomers.md](../product-discovery/11-noncustomers.md)), each built by combining: the ranked JTBD jobs that apply to them (02), the pain points that apply to them (03), their current workaround (04/11), and the willingness-to-pay evidence available for their segment (22). Each persona ends with **open questions a real interview must answer** — this synthesis exists specifically to sharpen those questions, not to answer them.

---

## Persona 1 — "Priya," QA Lead at a self-hosted OSS shop (Tier 1: soon-to-be noncustomer)

**Profile (synthesized):** Runs Kiwi TCMS or Squash TM self-hosted for a 15-person engineering org. Chose it originally for cost and data control, not for its feature depth.

**Goals:** Ship releases with confidence test coverage is real, not just "we ran some tests" (Job #1/#2, 02). Wants upward-reporting to be low-effort (Job #6, 02).

**Current workflow (synthesized from 03/04):** Manually writes test cases in the tool, executes them by hand or via a CI reporter plugin, builds release-readiness reports by hand because the built-in reporting is described as inflexible at scale (03 #3).

**Pains (sourced):**
- Feels the AI/traceability ceiling — competitors with AI generation exist, her self-hosted tool doesn't have it (09, 11 Tier 1).
- **[synthesized]** "Writing test cases from scratch for every new feature is the slowest part of my week, and every AI tool I could bolt on wants to send our test data to someone else's cloud" — paraphrase combining 03 pain #9 (data residency) with 02 Job #1's framing of test-case authoring as the highest-frequency job.

**Current spend:** $0 direct license cost (self-hosted OSS) — **ASSUMPTION**, not directly evidenced; infra hosting cost not researched.

**Willingness to pay signal (sourced, 22):** Weakest-evidenced of the three personas in this synthesis — no direct WTP data for this specific persona exists in the discovery set; inferred only indirectly from Qase charging separately for AI generation (06/22), which is a different buyer (SaaS-already customer, not self-hosted-committed).

**Open questions for a real interview:** Would she pay per-seat, usage-based, or a flat support fee for AI generation bolted onto her existing self-hosted tool? Is switching tools even on the table, or does she want this as a plugin to what she already runs (per 32's "contribute to Kiwi TCMS" alternative)?

---

## Persona 2 — "Marcus," QA/Compliance Manager at a regulated mid-market company (Tier 2: refusing noncustomer, overlapping Tier 3 GRC-adjacent)

**Profile (synthesized):** Builds and maintains a requirements-traceability matrix by hand in Jira/Excel for a medtech- or fintech-adjacent product, because dedicated traceability tools (Squash TM, Jama) were judged too heavy or expensive when evaluated (11 Tier 2).

**Goals:** Produce an audit-grade requirement→test→result trail on demand without a week of manual reconciliation before every audit (Job #4, 02).

**Current workflow (sourced, 03 #10 / 11 Tier 2):** Follows workaround patterns like Ketryx's published guide to building an RTM inside Jira — real workaround content exists and is cited, though Marcus himself is synthesized, not a real interviewee.

**Pains (sourced):**
- Data residency/compliance concerns rule out SaaS AI tooling outright for some teams — described as a "wall," not friction (03 #9, citing Autonoma).
- No turnkey standards-based traceability without heavyweight ALM spend (03 #10).
- **[synthesized]** "I already rejected the traceability tools that exist because they were built for teams three times our size — I'm not looking for more process, I'm looking for less manual reconciliation before an audit" — paraphrase combining 11 Tier 2's "refused Squash TM for being too heavy" finding with 03 #10's traceability pain.

**Current spend:** Unknown/unresearched — **ASSUMPTION**. 22 notes this persona's category (traceability/governance tooling) has payment evidence only from an adjacent market (HashiCorp's infrastructure-governance category), not testing-traceability specifically.

**Willingness to pay signal (sourced, 22):** Second-strongest of the three per the discovery set's own ranking — real budget exists in GRC/compliance-adjacent tooling (Vanta, Drata), but no direct evidence this specific buyer has paid for *test*-traceability tooling specifically.

**Open questions for a real interview:** Was heaviness (setup/process overhead) the real rejection reason for Squash TM, or was it price, or was it something else entirely? Would self-hosted + AI-assisted change that calculus, or is the objection orthogonal to hosting model?

---

## Persona 3 — "Agent-primary team" (Tier 3: unexplored noncustomer)

**Profile (synthesized):** A small engineering team (per 06/11) where AI coding agents (Claude Code, Cursor) do most implementation and test-writing work; no one holds a "QA" or "Tester" title. Testing happens, but as agent output, not as a role-owned workflow.

**Goals:** Wants agent-generated and agent-executed test activity to be visible/auditable somewhere, without hand-building that visibility themselves (inferred from 06's MCP findings + 07's Actor-model rationale).

**Current workflow (sourced, 11 Tier 3):** No dedicated test management tool at all — this segment is described as never having been treated as the category's customer. Whatever tracking exists is ad hoc (chat logs, PR descriptions, no structured record).

**Pains:**
- **[synthesized]** "My agent runs and 'tests' things constantly, but there's no record of what it actually verified once the PR merges" — paraphrase inferred from 06's finding that MCP-driven agentic execution is shipping across several competitors (Katalon, QA Touch, TestCollab, Qase) but no self-hosted tool supports first-party MCP (06, confirmed again in 23).
- Zero self-hosted competitor ships a first-party MCP server today (06) — this segment literally cannot get a self-hosted tool an agent can operate, regardless of price.

**Current spend:** $0 — **FACT by definition** (this segment isn't in the test-management market at all today, 11).

**Willingness to pay signal:** **No evidence in the discovery set at all.** This is the least-validated of the three personas — 22 does not price this segment because it doesn't yet exist as a buying category anywhere in the research.

**Open questions for a real interview:** Does this team even perceive "test management" as a category they'd buy into, or would this need to be positioned entirely differently (e.g., as agent-observability/audit tooling, not a QA tool)? Who is the economic buyer if there's no QA role?

---

## Cross-persona synthesis

**INSIGHT (synthesized, not new data):** Persona 2 (Marcus) has the strongest combination of real pain evidence (03 #9, #10) and real adjacent-market WTP evidence (22's GRC-tooling comparisons) — consistent with 11's own recommendation to prioritize the Tier 2/Tier 3-GRC overlap over generic Agile-team interviews. Persona 3 (agent-primary team) is the most novel and the least evidenced — consistent with 23's characterization of Tier 3 as "unexplored," and the honest reason 27's experiment treats WTP as the single biggest open unknown rather than something this synthesis (or the discovery set generally) can responsibly claim to already know.

**What this document cannot tell you, and 27's experiment must:** actual willingness to pay a specific price, actual setup-completion behavior, actual generated-test-case quality perception — all three personas' WTP sections above are either absent or weakly inferred. Do not use this document to skip or shortcut 27's real pilot interviews.

## Sources
- [02 — Customer Jobs](../product-discovery/02-customer-jobs.md)
- [03 — Customer Pain](../product-discovery/03-customer-pain.md)
- [04 — Current Solutions](../product-discovery/04-current-solutions.md)
- [06 — AI & MCP Landscape](../product-discovery/06-ai-mcp-landscape.md)
- [11 — Noncustomers](../product-discovery/11-noncustomers.md)
- [22 — Willingness to Pay](../product-discovery/22-willingness-to-pay.md)
- [23 — Winner](../product-discovery/23-winner.md)
- [27 — 30-Day Experiment](../product-discovery/27-experiment.md) — the real interview plan this document feeds into
- [32 — Final Decision](../product-discovery/32-final-decision.md)

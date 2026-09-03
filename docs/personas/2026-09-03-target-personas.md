# User Personas — Sovereign AI Testing

**Date:** 2026-09-03
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Fresh — no personas existed prior to this document (`docs/personas/` did not exist).

## Basis and confidence

Built from [2026-09-03-sovereign-ai-testing-business-case.md](../business-case/2026-09-03-sovereign-ai-testing-business-case.md) and the prior synthesis in [2026-09-03-target-segment-synthesis.md](../user-interviews/2026-09-03-target-segment-synthesis.md), which itself synthesizes [02](../product-discovery/02-customer-jobs.md), [03](../product-discovery/03-customer-pain.md), [04](../product-discovery/04-current-solutions.md), [06](../product-discovery/06-ai-mcp-landscape.md), [11](../product-discovery/11-noncustomers.md), [22](../product-discovery/22-willingness-to-pay.md).

**No new research was performed for this document.** These personas carry the same confidence level as their source: grounded in secondary research (review sites, comparison articles, vendor docs), not primary interviews. Names, exact roles, and quoted-style goals/pains below are **synthesized composites**, not real individuals — flagged per document, not repeated inline on every line, to keep this readable as an actual working persona doc. Treat every persona as **HYPOTHESIS** until validated against real pilot data from [27-experiment.md](../product-discovery/27-experiment.md).

**Prioritization (per 11's own recommendation):** Persona 2 (Marcus) is the primary/beachhead persona — strongest combined pain + adjacent-market WTP evidence. Persona 1 (Priya) is secondary — easiest to reach but converting them is share-taking in a red ocean (09), not new demand. Persona 3 (agent-primary team) is the long-shot/exploratory persona — real structural opportunity (06, 07's Actor model) but zero WTP evidence anywhere in the discovery set.

---

## Persona 1 (secondary) — Priya, QA Lead, self-hosted OSS shop

| | |
|---|---|
| **Role** | QA Lead / test manager, ~15-person engineering org |
| **Tooling today** | Self-hosted Kiwi TCMS or Squash TM |
| **Segment** | Blue Ocean Tier 1 — soon-to-be noncustomer (already in-category, on the edge) |

**Goals:**
- Ship releases with real coverage confidence, not "we ran some tests" (Job #1/#2, 02)
- Make upward status reporting low-effort (Job #6, 02)
- Keep the self-hosting/data-control property she originally chose the tool for

**Pains:**
- Feels the AI ceiling — SaaS competitors have AI test generation, her self-hosted tool doesn't (09, 11)
- Built-in reporting described as inflexible once suites grow (03 #3)
- Every AI tool she could bolt on wants to send test data to someone else's cloud (03 #9 pattern applied to her context)

**Context of use:** Daily — test-case authoring and execution tracking are core recurring work, not occasional. Evaluates new tooling reactively (renewal cycle, or when a peer team's tool visibly does more).

**What would make her switch or adopt:** AI generation that doesn't require giving up self-hosting — a pure upside vs. her status quo, no new sacrifice (23's stated reason Tier 1 converts easily).

**Unvalidated:** Actual willingness to pay — no direct WTP evidence exists for this persona in the discovery set (22); only indirect inference from a different buyer (Qase's already-SaaS customers).

---

## Persona 2 (primary/beachhead) — Marcus, QA/Compliance Manager, regulated mid-market

| | |
|---|---|
| **Role** | QA Manager with compliance/audit responsibility, medtech- or fintech-adjacent product org |
| **Tooling today** | Jira/Excel, hand-built requirements traceability matrix |
| **Segment** | Blue Ocean Tier 2 — refusing noncustomer (evaluated the category, rejected it), overlapping Tier 3 GRC-adjacent |

**Goals:**
- Produce an audit-grade requirement→test→result trail on demand, without a week of manual reconciliation before every audit (Job #4, 02)
- Stay compliant on data residency/handling without it becoming a procurement blocker (03 #9)

**Pains:**
- Data residency/compliance rules out SaaS AI tooling outright for his team — a wall, not friction (03 #9)
- No turnkey standards-based traceability without heavyweight ALM spend (Jama/Polarion-tier), and he already judged Squash TM too heavy for his team's size when he evaluated it (03 #10, 11 Tier 2)
- Manual RTM reconciliation before audits is real, recurring, and un-automated today

**Context of use:** Continuous low-grade traceability upkeep, spiking hard before each audit cycle. Audit cycle frequency, not sprint frequency, is what drives urgency (02 Job #4: "rare but high-stakes elsewhere").

**What would make him switch or adopt:** Something visibly, obviously better than "assembling evidence by hand" — a materially lower bar than matching TestRail/Squash TM feature-for-feature (11's own insight). Self-hosted removes his original SaaS objection entirely if AI generation is included without reintroducing a data-residency risk.

**Unvalidated:** Whether his original rejection of Squash TM was about weight/complexity specifically, or price, or something else — this determines whether "self-hosted + AI, still traceability-capable" actually resolves his objection or just restates it in a new form. This is the single most important open question for this persona, and 27's experiment doesn't directly test it either (26 explicitly deferred full traceability depth from the MVP) — flag for a dedicated qualitative interview question, not just the standard pilot check-ins.

---

## Persona 3 (exploratory/long-shot) — Agent-primary engineering team

| | |
|---|---|
| **Role** | No dedicated QA/Tester role — small engineering team where AI coding agents (Claude Code, Cursor) do most implementation and test-writing |
| **Tooling today** | None — ad hoc (chat logs, PR descriptions), no structured test-management tool at all |
| **Segment** | Blue Ocean Tier 3 — unexplored noncustomer (never treated as this category's customer) |

**Goals:**
- Some visible, auditable record of what an agent actually verified once a PR merges (inferred from 06/07's Actor-model rationale)
- Minimal-to-zero manual overhead — this team, by construction, has no one whose job is to maintain a test tool

**Pains:**
- No self-hosted tool ships a first-party MCP server today — this segment structurally cannot get a self-hosted tool an agent can operate, at any price, regardless of feature quality (06, reconfirmed 23)
- Testing happens as a side effect of agent activity, with no structured record surviving past the PR

**Context of use:** Continuous but invisible — happens every time an agent runs, not as a scheduled QA activity. This is a structurally different usage pattern from Personas 1/2 (event-driven by agent runs, not human sprint/audit cadence).

**What would make this segment adopt:** Existence of a self-hosted MCP-native option at all — for this persona the bar is "does this exist," not "is this better than X" (11's "never in the market" framing).

**Unvalidated, most severely of the three:** Whether this segment perceives itself as needing "test management" as a category at all, whether it would need to be positioned entirely differently (agent-observability/audit tooling), and who the economic buyer even is absent a QA role. **No WTP evidence exists anywhere in the discovery set for this persona** (22) — treat as a real structural opportunity, not yet a validated market.

---

## How these map to the product decision

Per [32-final-decision.md](../product-discovery/32-final-decision.md), the current Go decision is bounded to [26-mvp.md](../product-discovery/26-mvp.md) — a single-hypothesis test of whether self-hosted + BYO-LLM AI generation drives adoption. That MVP's target recruiting pool ([27-experiment.md](../product-discovery/27-experiment.md)) draws from Kiwi TCMS/Squash TM communities (Persona 1), ISTQB/QA communities and compliance-focused channels (Persona 2), matching the pilot recruitment plan already in place. Persona 3 is not directly targeted by 27's recruitment plan despite being structurally the most novel finding in this discovery set — worth a deliberate call on whether to include a small agent-primary cohort in the pilot, or treat it as a fully separate future validation cycle.

## Sources
- [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md)
- [User interview synthesis](../user-interviews/2026-09-03-target-segment-synthesis.md)
- [02](../product-discovery/02-customer-jobs.md), [03](../product-discovery/03-customer-pain.md), [04](../product-discovery/04-current-solutions.md), [06](../product-discovery/06-ai-mcp-landscape.md), [09](../product-discovery/09-strategy-canvas.md), [11](../product-discovery/11-noncustomers.md), [22](../product-discovery/22-willingness-to-pay.md), [23](../product-discovery/23-winner.md), [26](../product-discovery/26-mvp.md), [27](../product-discovery/27-experiment.md), [32](../product-discovery/32-final-decision.md)

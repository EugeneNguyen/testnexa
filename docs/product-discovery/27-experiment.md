# 27 — 30-Day Experiment

**Note on numbering:** requested as "25 — Experiment," renumbered to 27. See [00-overview.md](00-overview.md) for the full index.

## Design philosophy

30 days is not enough time to build the full MVP (26) *and* run a statistically clean pilot from scratch — so this experiment runs recruitment and a lightweight/concierge version of the MVP in parallel, front-loaded, rather than sequencing "build everything, then test." This trades some product polish for speed of learning, which is the correct trade for a hypothesis this unproven (Decision-Making principle 16: don't build an MVP just because the idea is interesting — get to a real signal as fast as possible).

## Week-by-week plan

**Days 1–7 — Build + recruit in parallel**
- Engineering: stand up the minimum slice of 26's MVP — Docker Compose deployment, core test-asset model, MCP server, BYO-LLM generation (API-key path only for speed; local-model/Ollama path deferred past day 30 if needed). Usage-based/local-model support can be concierge-simulated (a team member manually configures it for early pilots) rather than fully self-serve, to save build time without weakening the read on the *core* hypothesis (would they use it, not would they self-serve-configure it).
- Recruitment (target n=10–12 pilot orgs): Kiwi TCMS and Squash TM community forums (11, Tier 1 switch candidates — people already self-hosting, already primed for this exact trade-off), ISTQB-adjacent LinkedIn/QA communities (11, Tier 3 crossover), security/compliance-focused Slack/Discord communities (targeting the regulated-buyer angle directly, 12/22), and direct outreach to companies with public GDPR/self-hosting requirements visible in job postings (a primary-source technique explicitly named in this discovery process's own research-behavior guidance) — not a random sample, a deliberately targeted one matching 24's defined target customer.

**Days 8–25 — Pilot usage window**
- Pilots deploy via Docker Compose, connect a BYO-LLM key or local endpoint, and use the tool for real (or realistic sandbox) test-case generation and execution tracking.
- Instrumented usage logging (already scoped into the MVP, 26) captures generation events, execution events, and setup-completion funnel steps automatically — not reliant on self-reported usage.
- Weekly 15-minute check-in call with each pilot (3 total touchpoints per pilot across the window) — structured around: did you use it this week, what stopped you if not, would you pay for this today.

**Days 26–30 — Analyze and decide**
- Compile activation/adoption/quality/WTP metrics against the success criteria below.
- Go/Pivot/Kill decision made against the pre-committed thresholds, not adjusted after seeing the data — the thresholds are set now, in this document, specifically to avoid post-hoc rationalization.

## Measurable success criteria (set in advance)

| Dimension | Metric | Threshold | Rationale |
|---|---|---|---|
| **Demand (activation)** | % of recruited pilots who complete Docker Compose setup and generate ≥1 test case via BYO-LLM within week 1 | ≥60% | Tests whether the core setup friction (26's risk #1) is survivable, not just theoretically acceptable |
| **Adoption (sustained use)** | % of activated pilots using AI generation ≥3x/week by week 3 | ≥50% | Distinguishes genuine workflow adoption from one-time curiosity — the harder, more honest bar |
| **Willingness to pay (stated)** | % of pilot participants who say yes to a direct pricing conversation ("would you pay $X/month for this once GA") | ≥40% | A necessary but weak signal on its own — paired with the harder metric below |
| **Willingness to pay (revealed)** | % of pilot participants who agree to a paid design-partner commitment or signed LOI | ≥20% | The real test — stated intent is cheap, a signature or payment commitment is not |
| **Feasibility (setup)** | % of pilots completing BYO-LLM/local-endpoint setup without vendor hand-holding | ≥70% | Tests whether the self-serve version of this (not the concierge-assisted pilot version) is realistic for GA |
| **Feasibility (quality)** | % of generated test cases rated "usable with light edits" or better by the pilot's own reviewer | ≥60% | Directly tests 26's risk #2 (local/BYO model output quality) — the single largest unaddressed technical unknown in this entire discovery process |

## Kill / pivot triggers

- **Activation <30%**, or **paid-LOI <10%**, or **quality rating <30% "usable"** on any one of these: treat the concept as invalidated as currently scoped. Per Decision-Making principle 15 (be willing to recommend PIVOT or KILL) — the correct response is not to iterate blindly on the same concept, but to **return to 21's surviving list (1, 2, 10, 12, 14, 19)** and re-run this same experiment structure against the next-best candidate, most likely #14 (evidence-bundle API) if the partner-conversation groundwork from 22's own recommendation has been done in parallel, since it had the strongest standalone willingness-to-pay evidence of the six.
- **Specific failure-mode diagnostics to check before concluding "kill" outright:**
  - If activation is low but quality is high → the problem is setup friction, not the value proposition; consider simplifying BYO-LLM configuration (e.g., a hosted-but-still-customer-billed inference proxy) before killing the concept entirely.
  - If activation is high but sustained adoption is low → the problem is the generated output isn't good enough to keep using, not the self-hosted positioning; a model-quality problem, not a market problem.
  - If both activation and adoption are strong but paid-LOI is low → the self-hosted-AI property is valued but not *differentiated enough to pay for specifically* — may indicate this needs to ship as a feature within a broader paid product (Model A/B from 25) rather than being sold as a standalone reason to buy.

## What this experiment deliberately does not test

Traceability depth, ISTQB/IEEE 829 compliance claims, multi-tenant/RBAC richness, the GRC evidence-bundle concept (#14), and the agent-governance security positioning (#19) — all out of scope per 26, and none of their hypotheses are being tested by this experiment either. A successful result here validates the winning concept (23) specifically; it says nothing about those other five concepts, which would each need their own dedicated validation cycle if pursued later.

## Sources
- [11 — Noncustomers](11-noncustomers.md), [12 — Alternative Industries](12-alternative-industries.md), [21 — Competition Test](21-competition-test.md), [22 — Willingness to Pay](22-willingness-to-pay.md), [23 — Winner](23-winner.md), [24 — Value Proposition](24-value-proposition.md), [26 — MVP](26-mvp.md)

# Product Discovery: Open Source, Self-Hosted, ISTQB-Aligned Test Management Tool

**Date:** 2026-09-02
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Discovery in progress — no Go/Pivot/Kill decision yet. This overview will be updated as 06+ (Noncustomers, Blue Ocean, Value Prop, Business Model, MVP, Validation) land.

## Original idea (as given)

> Open Source Test Management Tool, comply with ISTQB. Self-hosted. Dockerized.

## First challenge to the idea

Before mapping the market, one framing issue needs to be flagged directly, because it changes what "comply with ISTQB" can mean for a *product*:

- **ISTQB certifies people, not tools.** ISTQB (International Software Testing Qualifications Board) issues certifications to individual testers (Foundation Level, Advanced Level, etc.) and publishes a **Standard Glossary of Terms Used in Software Testing**. It does not certify, accredit, or endorse software products — there is no "ISTQB-compliant tool" badge a vendor can earn. **FACT**, confirmed against the ISTQB glossary sources ([ASTQB glossary v2.3](https://astqb.org/assets/documents/ISTQB_glossary_of_testing_terms_2.3.pdf), [ASTQB glossary v3.1](https://www.astqb.org/documents/Glossary-of-Software-Testing-Terms-v3.pdf)) — none reference a product-certification program.
- What "comply with ISTQB" realistically *can* mean for a tool, and what the market map/competitor research below tests as hypotheses:
  1. **Terminology alignment** — the tool's data model and UI use ISTQB glossary terms (test condition, test case, test suite, test plan, test log, defect, anomaly, entry/exit criteria) consistently, rather than a vendor's proprietary vocabulary. **HYPOTHESIS.**
  2. **Process alignment** — the tool's workflow mirrors the ISTQB/ISO 29119 test process (planning → design → implementation → execution → completion, with traceability from requirement → test condition → test case → result). **HYPOTHESIS.**
  3. **Training/practice use case** — a tool built for ISTQB exam candidates and training providers to practice test design techniques and test management concepts hands-on. **HYPOTHESIS, separate and smaller market from #1/#2.**
- This distinction must be resolved with the user before scoping an MVP — it drives entirely different target customers (enterprise QA teams needing an audit-friendly RTM tool vs. training providers needing a teaching sandbox).

## Documents in this discovery set

| # | Document | Status |
|---|---|---|
| 01 | [Market Map](01-market-map.md) | Done |
| 02 | [Customer Jobs](02-customer-jobs.md) | Done |
| 03 | [Customer Pain](03-customer-pain.md) | Done |
| 04 | [Current Solutions](04-current-solutions.md) | Done |
| 05 | [Competitor Map](05-competitor-map.md) | Done |
| 06 | [AI & MCP Landscape](06-ai-mcp-landscape.md) | Done — significant finding, revises opportunity framing below |
| 07 | [Conceptual ERD (IEEE 829 + ISTQB CTFL)](07-erd-draft.md) | Done — jumps ahead of discovery sequence on request; structural hypothesis, not MVP-scoped |
| 08 | [Industry Factors](08-industry-factors.md) | Done |
| 09 | [Strategy Canvas](09-strategy-canvas.md) | Done — qualitative synthesis, not benchmark data; confirms self-hosted+AI/MCP gap geometrically |
| 10 | [ERRC Grid](10-errc-grid.md) | Done |
| 11 | [Noncustomers](11-noncustomers.md) | Done — recommends prioritizing regulated-DIY + GRC-adjacent interviews over generic Agile-team interviews |
| 12 | [Alternative Industries](12-alternative-industries.md) | Done |
| 13 | [Strategic Groups](13-strategic-groups.md) | Done — 4th independent confirmation of the self-hosted+AI/MCP whitespace |
| 14 | [Complementary Products](14-complementary-products.md) | Done — surfaces B2B2B/evidence-feeder distribution angle |
| 15 | [Blue Ocean Concepts](15-blue-ocean-concepts.md) | Done — 20 concepts, clustered into 4 coherent bets |
| 16 | [Break Industry Assumptions](16-industry-assumptions.md) | Done — 4 category-specific blind spots flagged as the more defensible bet |
| 17 | [Cross-Industry Inspiration](17-cross-industry-inspiration.md) | Done — 10 business models; 8/10 converge on same free/paid boundary pattern |
| 18 | [Demand Creation](18-demand-creation.md) | Done — maps all 20 concepts to noncustomer tiers; flags which are new-demand vs. conversion plays |
| 19 | [Blue Ocean Score](19-blue-ocean-score.md) | Done — 20 concepts scored 6 dimensions; top 5 = 14, 19, 1, 2, 5 |
| 20 | [Strategic Fit](20-strategic-fit.md) | Done — surfaces real contradictions in all top 5 (partner dependency, GTM collision, BYO-LLM ambiguity, ERRC inconsistency) |
| 21 | [Competition Test](21-competition-test.md) | Done — stricter filter; only 6 of 20 concepts (1, 2, 10, 12, 14, 19) survive as genuine new-market-space, 13 eliminated as competitive improvements |
| 22 | [Willingness to Pay](22-willingness-to-pay.md) | Done — #14 and #19 have strongest budget evidence but both depend on validating something outside this product's control (partner acceptance, category credibility) — recommends a handful of outreach conversations before MVP scoping |
| 23 | [Winner](23-winner.md) | Done — picked #1+#2 merged ("self-hosted, MCP-native, BYO-LLM AI test generation"), explicitly over the higher-scoring #14/#19, on feasibility/distribution/"why us" grounds, not raw score |
| 24 | [Value Proposition](24-value-proposition.md) | Done |
| 25 | [Business Model](25-business-model.md) | Done — 3 models compared; recommends usage-based metering (B) as primary, support subscription (A) as floor, B2B2B evidence connector (C) deferred pending partner validation |
| 26 | [MVP](26-mvp.md) | Done — single hypothesis, ruthlessly cut; explicit "what would invalidate it" section |
| 27 | [30-Day Experiment](27-experiment.md) | Done — pre-committed thresholds, kill/pivot triggers, and failure-mode diagnostics defined before data collection |
| 28 | [Red Team](28-red-team.md) | Done — hostile competitor + investor critique; core finding: no durable moat, position is copyable within 6–12 months |
| 29 | [Pre-Mortem](29-pre-mortem.md) | Done — 10 failure causes, including a real, sourced OSS-maintainer-burnout risk (Kubernetes/Ingress NGINX, External Secrets Operator precedents) |
| 30 | [Moat](30-moat.md) | Done — weak across data/tech/brand/network-effects/distribution; only durable advantage is BYO-LLM's structural cost benefit (non-exclusive); recommends revisiting demoted concepts #11/#16 for network effects once core hypothesis validates |
| 31 | [Market Timing](31-market-timing.md) | Done — genuinely strong, 4 of 5 factors favorable, two backed by dated 2026 events (EU AI Act enforcement Aug 2, open-weight model quality jump) |
| 32 | [Final Decision](32-final-decision.md) | Done — **GO, narrowly bounded to the 26/27 MVP+experiment only**; not a company-build commitment; names pivot-to-#14 and contribute-to-Kiwi-TCMS as explicit fallback/alternative paths |

**Discovery process status: substantively complete.** 32 documents, idea → jobs → pain → competitors → AI/MCP landscape → ERD → full Blue Ocean toolkit → 20 concepts → scored, fit-tested, competition-tested, priced → winner → value proposition → business model → MVP → 30-day experiment → red team → pre-mortem → moat → timing → final decision. The next step is not more research — it's running 27's experiment and returning to reassess against the conditions set in 32.

**Note on numbering:** docs 08–32 were requested with lower numbers ("06–30") but 06/07 were already taken by the AI/MCP landscape and ERD work earlier in this session — renumbered throughout to keep the sequence collision-free. Content matches what was asked for 1:1.

## How to read this set

Every claim below is labeled:
- **FACT** — directly supported by a cited source.
- **ASSUMPTION** — believed but unverified, needs primary research (customer interviews).
- **HYPOTHESIS** — testable proposition, not yet validated.
- **INSIGHT** — synthesized conclusion from multiple data points.
- **RECOMMENDATION** — a proposed product decision.

Market-sizing figures for "test management tools" specifically are thin and inconsistent across research vendors (see 01). Treat all TAM/SAM numbers as **directionally indicative**, not precise — this is a known limitation of secondary research in a narrow software sub-category, and is flagged inline rather than hidden.

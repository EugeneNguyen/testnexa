# Business Case — Self-Hosted, MCP-Native AI Test Management ("Sovereign AI Testing")

**Date:** 2026-09-03
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Draft — synthesized from an existing discovery process, not new research. See "Provenance" below.

## Provenance and why this document exists

A 32-document discovery process already ran for this product ([docs/product-discovery/](../product-discovery/00-overview.md), dated 2026-09-02) and reached a Go/Pivot/Kill decision ([32-final-decision.md](../product-discovery/32-final-decision.md)). That process produced the underlying research and reasoning this business case draws on, but never produced a single canonical **business case** document — the artifact a build/no-build decision, budget request, or stakeholder review typically needs in one place. This document fills that gap by synthesizing the discovery set into standard business-case sections. It introduces no new research and no new claims beyond what 01–32 already established; every claim below cites its source document.

**This gap was flagged during the prior stage** (project-scaffold design review, 2026-09-03): no `docs/requirements/`, `docs/adr/`, or business-case doc existed before this one.

## Problem statement

**FACT**, sourced from [03-customer-pain.md](../product-discovery/03-customer-pain.md) and [06-ai-mcp-landscape.md](../product-discovery/06-ai-mcp-landscape.md): every test-management competitor studied forces a choice between self-hosting (data control, compliance) and AI-assisted test generation (productivity) — no vendor offers both. Regulated and security-conscious QA teams that require self-hosting (GDPR/Schrems II compliance reviews reject SaaS AI vendors outright for some teams, per 03) are structurally excluded from AI-assisted test generation, not by preference but by a forced trade-off built into the market's current offerings.

This is corroborated independently four separate ways — the strategy canvas (09), the AI/MCP landscape scan (06), the alternative-industries analysis (12), and the strategic-groups gap analysis (13) — all converging on the same structural fact without being designed to. Per [23-winner.md](../product-discovery/23-winner.md), that four-way independent convergence is the best-triangulated finding in the entire discovery set.

## Target customer

**HYPOTHESIS**, refined across [02](../product-discovery/02-customer-jobs.md)–[11](../product-discovery/11-noncustomers.md): regulated or security-conscious QA/engineering teams already committed to self-hosting (existing Kiwi TCMS / Squash TM users), plus two noncustomer tiers per [11-noncustomers.md](../product-discovery/11-noncustomers.md):
- **Tier 2 (refusing noncustomers):** teams that evaluated SaaS AI test tools, hit a compliance wall, and concluded "no AI" was the unavoidable cost of staying compliant.
- **Tier 3 (unexplored noncustomers):** AI-agent-driven teams with no dedicated human tester, who have never had a self-hosted tool an AI agent could operate at all — zero self-hosted competitor ships a first-party MCP server today (06).

Not yet validated: bottom-up market size for this specific intersection (self-hosted + regulated/security-conscious + AI-adopting). Flagged as an open gap since [01-market-map.md](../product-discovery/01-market-map.md) and never closed anywhere in the discovery set (32).

## Market context

**FACT**, [01-market-map.md](../product-discovery/01-market-map.md), [05-competitor-map.md](../product-discovery/05-competitor-map.md): established competitors split cleanly into self-hosted-no-AI (Kiwi TCMS, Squash TM) and SaaS-with-AI (Qase, TestRail, Xray, Zephyr). Qase already charges separately, consumption-based, for AI generation — direct evidence the market pays for this feature category (06, 22), though not yet evidence the self-hosted variant specifically gets paid for.

**FACT**, [31-market-timing.md](../product-discovery/31-market-timing.md): two dated, checkable 2026 events favor timing now rather than later — the EU AI Act's high-risk AI obligations became enforceable August 2, 2026, with data-governance requirements that cannot be outsourced to an LLM vendor; and open-weight LLM quality closed most of the gap to frontier models on coding benchmarks specifically in 2026 (Qwen 3.6 Plus competitive with Claude Opus/GPT-5.4 on SWE-Bench Verified), a technical precondition for viable local/BYO-LLM generation that didn't reliably exist 12–18 months earlier.

**ASSUMPTION**, unresolved per 32: no source in the discovery set sizes this sub-segment bottom-up (self-hosted ∩ regulated ∩ AI-adopting). All TAM/SAM figures available are for the broader "test management tools" category and are explicitly flagged as directionally indicative only (00-overview.md).

## Why now

1. Regulatory timing is dated and real, not evergreen rationale — EU AI Act enforcement (31).
2. Open-weight model quality crossed a usability threshold for local/BYO-LLM generation in 2026 specifically (31).
3. The structural whitespace (self-hosted + AI/MCP, nobody occupies both) is the strongest-triangulated finding in this discovery set and could close as open-weight models keep improving and competitors notice (28-red-team.md: a well-resourced competitor could plausibly close this gap within 6–12 months) — the window argues for testing now, not for building the full company now.

## Expected value

**Customer value (HYPOTHESIS, 24-value-proposition.md):** regulated/self-hosting teams gain AI-assisted test generation without sacrificing the data-control property they already require; existing self-hosted users (Kiwi TCMS/Squash TM) gain AI productivity with no switching sacrifice; AI-agent-primary teams gain a self-hosted tool an agent can operate at all, for the first time in this category.

**Business value (HYPOTHESIS, 25-business-model.md):** usage-based metering on AI generation (Model B) recommended as primary revenue model, support subscription (Model A) as a floor, B2B2B evidence-connector integration (Model C, tied to concept #14) deferred pending an external partner-willingness conversation not yet had.

**Moat (FACT/INSIGHT, 30-moat.md, 28-red-team.md):** honestly weak today — no durable data, technology, brand, network-effect, or distribution advantage exists; the only real advantage (BYO-LLM's structural cost benefit) is non-exclusive and copyable within 6–12 months by a well-resourced competitor. This caps how large a bet this deserves right now; it does not by itself argue against testing the hypothesis cheaply.

## Decision already made, and what's still open

**RECOMMENDATION** (carried from [32-final-decision.md](../product-discovery/32-final-decision.md), not re-derived here): **GO, narrowly bounded to the already-scoped MVP ([26-mvp.md](../product-discovery/26-mvp.md)) and 30-day validation experiment ([27-experiment.md](../product-discovery/27-experiment.md)) only** — not a company-build commitment. The MVP deliberately excludes multi-tenant `Organization`, full RBAC, and most of the standards-depth entities in the conceptual ERD ([07-erd-draft.md](../product-discovery/07-erd-draft.md)), specifically to keep the validation test cheap and its read unambiguous.

**Status as of this document:** no record in this repository that 27's experiment has run or produced results. The Go decision's own pre-committed thresholds (activation ≥60%, sustained adoption ≥50%, paid-LOI ≥20%, quality-usable ≥60%, per 27) have not yet been tested against real pilot data.

**Material fact for whoever reads this business case next to a build decision:** a separate, concurrent engineering task (project scaffold, [2026-09-03-project-scaffold-design.md](../superpowers/specs/2026-09-03-project-scaffold-design.md)) has been scoped to the **full** 07 ERD (28 entities, full RBAC, multi-tenancy) rather than the validated 26 MVP subset — an explicit, informed user decision made after being shown this exact conflict, not an oversight. This business case does not change that decision; it records that the underlying validation experiment (27) this business case's Go recommendation depends on has still not been run, and treats that as an open item.

## Sources

All citations above trace to [docs/product-discovery/](../product-discovery/00-overview.md), specifically 01, 02, 03, 05, 06, 07, 09, 11, 12, 13, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32. No new research was performed for this document; see those files for full evidence, methodology, and source citations (company sites, pricing pages, standards bodies, regulatory sources).

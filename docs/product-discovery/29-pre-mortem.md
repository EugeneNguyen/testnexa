# 29 — Pre-Mortem

**Note on numbering:** requested as "27 — Pre-Mortem," renumbered to 29. See [00-overview.md](00-overview.md) for the full index.

Assume it's three years from now and this business failed. The 10 most likely causes, ranked, each grounded in evidence from this discovery set (largely 28's red team, extended with team/execution risks not covered there).

## 1. An incumbent shipped the same combination first

Kiwi TCMS or Squash TM added MCP + BYO-LLM support within 6–12 months of seeing this product gain any visible traction, to an installed base this product never had. **Most likely single cause of death**, per 28 — the technology isn't proprietary and the position isn't defensible on its own (30 will confirm this directly).

## 2. A well-funded SaaS incumbent neutralized the objection without going open source

TestRail, Xray, or Zephyr added a "bring your own private AI endpoint" option to their existing self-hosted/Data Center tiers, satisfying the data-residency objection (03 #9) that was this product's core wedge — without the customer ever having to leave their existing tool, existing test-case history, or existing Jira integration.

## 3. The monetization model couldn't collect from the best-fit customer

Usage-based metering (25's recommended Model B) requires a license-check/telemetry call even in self-hosted deployments. The most security-strict buyers — the ones with the most acute pain (03 #9) — refused or disabled it, and revenue never scaled from the exact segment the whole thesis was built around.

## 4. Generated test-case quality never cleared the adoption bar

Local/BYO-LLM output was rated "usable with light edits" by pilots at a rate below the threshold set in 27's experiment, and adoption stalled at the technical-quality gate before the self-hosting differentiation ever got a fair test. **Live risk, not hypothetical:** open-weight models closed most of the frontier-model gap on structured coding tasks by 2026 (Qwen 3.6 Plus scoring 77.2% on SWE-Bench Verified on consumer hardware, per this session's research), which *reduces* this risk relative to what it would have been a year earlier — but "closed most of the gap" is not "closed," and test-case generation quality specifically was never benchmarked in this research.

## 5. The addressable market was smaller than assumed

The self-hosted + regulated/security-conscious + AI-adopting intersection turned out to be a genuinely small slice of an already-modest ($1.3B–$4.5B, 01) and fragmented category — a slice this research never sized bottom-up (01's own flagged gap) — and the revenue ceiling simply wasn't large enough to sustain a company past initial pilot traction, even with strong product-market fit at small scale.

## 6. Switching cost worked against, not for, this product

26's MVP shipped with zero import/migration tooling. Prospects already running TestRail, Xray, Kiwi TCMS, or Squash TM (11's Tier 1 "soon-to-be" noncustomers, the most promising near-term segment) faced a real cost to move years of test-case history over, and most simply didn't, regardless of how much they liked the self-hosted AI capability in isolation.

## 7. Maintainer/team burnout ended the project before revenue caught up

Open-source project sustainability is a well-documented, current failure mode: **60% of OSS maintainers report considering leaving entirely, 73% have experienced burnout, and 2025–2026 saw real, high-profile project failures from exactly this cause** — Kubernetes retired Ingress NGINX in November 2025 when maintainers could no longer sustain it, and the External Secrets Operator froze updates when four of its maintainers burned out ([Medium — OSS Maintainer Burnout Crisis](https://medium.com/@sohail_saifii/the-open-source-maintainer-burnout-crisis-nobodys-fixing-5cf4b459a72b), [byteiota — Open Source Maintainer Crisis](https://byteiota.com/open-source-maintainer-crisis-60-unpaid-burnout-hits-44/)). A small or single-maintainer team is structurally exposed to this exact risk, and nothing in 25's business models accounts for funding a sustainable team before Model A/B revenue materializes.

## 8. Distribution took far longer than the low-CAC assumption implied

25 assumed a low-CAC, self-serve OSS funnel (Kiwi TCMS/Squash TM's own model). But those competitors have years of accumulated GitHub stars, SEO, and community presence (04, 05) that this product starts at zero against — organic discovery took materially longer than modeled, and the company ran out of runway waiting for the funnel to reach the volume Model B's usage-based economics needed to work.

## 9. The core differentiation commoditized faster than expected

Self-hosted/local-model deployment tooling kept getting easier industry-wide (Ollama-class tooling, open-weight model quality improving fast per point 4 above) — the specific integration work that constituted this product's head start became an expected baseline capability within a year or two rather than a defensible position, and the "why us" advantage from being first compressed to near-zero before the company reached scale.

## 10. Validated demand for the narrow MVP hypothesis didn't translate into a purchasable product

27's experiment succeeded on its own terms (pilots activated, generated usable test cases, even signed LOIs) — but production conversion stalled because the deferred scope (traceability, multi-tenant/RBAC, GRC export — all cut in 26) turned out to be what actually gated the buying decision for the target regulated segment, not the AI-generation capability alone. The team had validated a feature, not the reason a regulated buyer replaces their incumbent tool, and the real build turned out to be much larger than the MVP implied, arriving after runway (cause 7/8) had already run out.

## Insight

**INSIGHT:** Causes 1, 2, and 9 are all variants of the same root risk red-teamed in 28 — **no durable moat, a copyable position with a closing window.** Causes 3, 6, and 10 are all variants of a second root risk — **the MVP's deliberate narrowness (26) protects speed-to-learn but doesn't protect the eventual production-conversion path,** which may depend on exactly the depth that was cut. Causes 5, 7, and 8 are the classic small-company/small-market risks any early-stage bet carries, evidenced here rather than assumed. **RECOMMENDATION:** 27's experiment as currently scoped tests demand for the narrow hypothesis well, but should be extended with at least one qualitative question per pilot — "what would you need to see before actually replacing your current tool in production" — specifically to get an early read on cause 10 before committing further engineering investment past the MVP.

## Sources
- [Medium — The Open Source Maintainer Burnout Crisis](https://medium.com/@sohail_saifii/the-open-source-maintainer-burnout-crisis-nobodys-fixing-5cf4b459a72b)
- [byteiota — Open Source Maintainer Crisis: 60% Unpaid, Burnout Hits 44%](https://byteiota.com/open-source-maintainer-crisis-60-unpaid-burnout-hits-44/)
- [MindStudio — Best Open-Source LLMs for Agentic Coding in 2026](https://www.mindstudio.ai/blog/best-open-source-llms-agentic-coding-2026)
- [01](01-market-map.md), [03](03-customer-pain.md), [04](04-current-solutions.md), [05](05-competitor-map.md), [06](06-ai-mcp-landscape.md), [11](11-noncustomers.md), [25](25-business-model.md), [26](26-mvp.md), [28](28-red-team.md)

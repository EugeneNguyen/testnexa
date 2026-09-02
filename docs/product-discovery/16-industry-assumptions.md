# 16 — Break Industry Assumptions

**Note on numbering:** requested as "14 — Break Industry Assumptions," renumbered to 16. See [00-overview.md](00-overview.md) for the full index.

Assumptions the test management industry (open-source and commercial alike) behaves as if true — evidenced by what every competitor studied *doesn't* offer, not stated outright by any vendor. Each is challenged and paired with an alternative already implied by earlier docs.

## 1. "Self-hosted tools can't offer AI features"

**Evidence this is taken for granted:** every self-hosted/open-source competitor studied (Kiwi TCMS, Squash TM, TestLink) has zero first-party AI, while every AI-capable competitor is SaaS-only (06, 09). Nobody has tried to break this — it looks like an unexamined default, not a considered trade-off.
**Challenge:** AI generation doesn't require sending data to a vendor's cloud — a local model or the customer's own API key satisfies the same job.
**Alternative:** BYO-LLM/local-inference AI running entirely inside customer infrastructure (concept #2, 15).

## 2. "Pricing must scale per seat"

**Evidence:** every commercial competitor studied (TestRail, Xray, Zephyr, Qase, Testiny) prices per user/month (01, 05). This directly produces the #1-cited pain in this research (03) — cost that scales with headcount, not usage, punishing exactly the teams (QA inside large Jira orgs) most likely to need the tool.
**Challenge:** headcount is a poor proxy for value delivered; a small QA team on a huge codebase pays disproportionately more per unit of actual testing work than a large QA team on a small codebase, under seat pricing.
**Alternative:** usage/event-based pricing (Sentry model, 17) or a support-subscription model decoupled from the software entirely (Red Hat model, 17).

## 3. "Standards compliance requires heavyweight, complex tooling"

**Evidence:** the only competitor offering real traceability depth (Squash TM) also scores lowest on ease-of-use in this research (09); the only tools with full ALM-grade traceability (Jama, Polarion) are the most complex and expensive in the entire competitive set (05, 13).
**Challenge:** IEEE 829/ISO 29119-3 define document *shape*, and ISTQB defines *vocabulary* — neither standard mandates implementation complexity. The heaviness is a design artifact of the specific tools that happen to support these standards today, not a requirement of the standards themselves (established directly earlier in this discovery process).
**Alternative:** a standards-native but deliberately lightweight data model (07 ERD), with rigor made optional rather than mandatory (concept #7, 15).

## 4. "Testers are human"

**Evidence:** every RBAC/workflow model studied (04, 05) is built exclusively around a human-shaped user record — no competitor's data model has a first-class concept of a non-human actor performing testing work, even as AI-agent-driven testing ships broadly across the category (06).
**Challenge:** this is now empirically false for a growing share of testing work — MCP-driven agents already create test cases, execute them, and report results (06) — but the *governance* model hasn't caught up anywhere in this research.
**Alternative:** the `Actor` supertype (`User` | `AIAgent`) with policy-scoped permissions (07 ERD; concepts #3, #19, 15).

## 5. "A test management tool's competitors are other test management tools"

**Evidence:** every competitive analysis in this discovery set (05) that stayed within the category found a "sea of sameness" (09) — because the category is implicitly defining itself only against other tools with "test management" in the name, while GRC platforms, QMS suites, spreadsheets, and AI-native IDEs are quietly solving the same underlying job for a large population that never evaluates a test tool at all (12).
**Challenge:** the real substitute set is much larger than the tagged competitor set, and several of those substitutes (Vanta, Drata, Greenlight Guru) are larger, better-funded businesses than most test-management vendors studied here.
**Alternative:** position and distribute against the broader "prove verification happened" job, not the narrower "test case tracking" feature set (concept #14, 15).

## 6. "Open-source test tools must choose between free-and-simple or compliance-capable-and-complex"

**Evidence:** this is the central gap found in the strategic-groups analysis (13, Gap 1) — no group occupies both ends simultaneously; Kiwi TCMS owns simple/free, Squash TM owns compliance/complex, and nothing sits between them.
**Challenge:** this trade-off is an artifact of how these two specific products were designed, not an inherent law of the category — nothing about being free or being standards-capable requires being simple or being complex respectively.
**Alternative:** progressive/opt-in rigor (concept #7, 15) — the same underlying schema serves both ends depending on what a team turns on.

## 7. "Traceability matrices must be manually reconstructed at audit time"

**Evidence:** every test management competitor studied treats an RTM as an exportable report generated on demand (04, 05); the DIY-Jira-hack workaround pattern (03, 11) exists specifically because assembling one by hand is expensive enough that teams try to avoid buying a tool at all and do it manually instead.
**Challenge:** the GRC industry solved exactly this problem for a structurally identical job — Vanta/Drata treat evidence as something that accumulates continuously, not something reconstructed reactively (12).
**Alternative:** event-driven, always-current traceability (concept #5, 15).

## 8. "The buyer is always a QA manager"

**Evidence:** every competitor's marketing and feature set studied targets QA/test leadership explicitly (01, 05); none address the compliance/security/platform stakeholders or the external-auditor persona directly (03, 11, 14) even though those stakeholders are named, real consumers of the tool's output.
**Challenge:** the actual population with a stake in "was this properly tested and can we prove it" is broader than the QA org chart — it includes security/compliance teams (facing SOC 2/ISO 27001 audits), platform teams (now needing to govern AI agents), and external auditors.
**Alternative:** multi-persona positioning — sell traceability to QA, agent-governance to platform/security, and read-only evidence access to auditors as three distinct value propositions from one product (concepts #4, #19, 15).

## 9. "IEEE 829 and ISTQB are redundant or competing standards — pick one"

**Evidence:** Kiwi TCMS claims IEEE 829 compatibility and nothing else; no competitor studied claims both, or explains the relationship between them (checked directly earlier this session).
**Challenge:** established directly in this discovery process — they operate at different layers (document format vs. vocabulary/technique) and are historically related (both descend from BS 7925), not competing.
**Alternative:** support both natively in one schema (07 ERD; concept #6, 15) — a claim no competitor in this research makes correctly, largely because nobody appears to have examined the relationship closely enough to realize both can be supported at once.

## 10. "Community-supported open source can't carry enterprise-grade trust"

**Evidence:** implicit in the market structure — the only enterprise-trusted options in this category (TestRail, Jama, Polarion, Xray/Zephyr) are all commercial-vendor-backed; the open-source options (Kiwi TCMS, TestLink, Squash TM community edition) are positioned as the budget/DIY tier, not the trust-and-governance tier.
**Challenge:** Red Hat, GitLab, Elastic, and HashiCorp all built billion-dollar businesses on open-source cores that regulated, risk-averse enterprises trust for infrastructure-critical work (17) — the "open source = less trustworthy" assumption doesn't hold in adjacent categories.
**Alternative:** a support-subscription trust model (concept #9, 15) rather than a feature-paywall trust model — notably, Elastic's own history is a cautionary tale here: gating core security features behind X-Pack caused enough backlash that Elastic made core security free again in 2019 ([Elastic Blog](https://www.elastic.co/blog/security-for-elasticsearch-is-now-free)) — a live example of this exact assumption being tested and failing in an adjacent market.

## Insight

**INSIGHT:** Assumptions #1, #4, #6, and #9 are specific to this category and appear to be genuine, unexamined blind spots — nobody studied has broken them, and nothing here suggests anyone is about to. Assumptions #2, #3, #5, #8, and #10 are category instances of assumptions *other* industries have already broken (Sentry broke #2, Elastic's own history is a live lesson against #10, GRC platforms broke #7, Salesforce's original CRM move broke a version of #5). **RECOMMENDATION:** the four category-specific blind spots (#1, #4, #6, #9) are the more defensible bet — breaking an assumption nobody else has even identified is harder for a fast-follower to copy than importing a lesson from an adjacent industry that a well-funded competitor could just as easily import too.

## Sources
- [Elastic Blog — Security for Elasticsearch is now free](https://www.elastic.co/blog/security-for-elasticsearch-is-now-free)
- [03 — Customer Pain](03-customer-pain.md), [06 — AI & MCP Landscape](06-ai-mcp-landscape.md), [07 — Conceptual ERD](07-erd-draft.md), [09 — Strategy Canvas](09-strategy-canvas.md), [11 — Noncustomers](11-noncustomers.md), [12 — Alternative Industries](12-alternative-industries.md), [13 — Strategic Groups](13-strategic-groups.md), [14 — Complementary Products](14-complementary-products.md), [15 — Blue Ocean Concepts](15-blue-ocean-concepts.md), [17 — Cross-Industry Inspiration](17-cross-industry-inspiration.md)

# 13 — Strategic Groups

**Note on numbering:** requested as "11 — Strategic Groups," renumbered to 13. See [00-overview.md](00-overview.md) for the full index.

Strategic groups: clusters of competitors pursuing similar strategies along price, quality (offering depth), complexity, convenience, and target customer segment — as distinct from a simple competitor-by-competitor list (05 already did that; this groups them to find the *gaps between clusters*, which is where uncontested space lives).

## The groups

| Group | Price | Complexity to adopt/operate | Convenience | Target segment | Members |
|---|---|---|---|---|---|
| **A. Free OSS generalist** | Free | Low | High (fast setup, Docker-native) | SMB, hobbyist, general Agile teams | Kiwi TCMS, TestLink |
| **B. Open-core compliance OSS** | Free (Community) → mid (~€2,000+/yr Premium) | High | Low-Medium | Enterprise regulated teams | Squash TM |
| **C. Modern low-cost SaaS** | Low-mid ($18–30/user/mo) | Low | High | SMB/mid-size Agile teams | Qase, Testiny, TestMonitor |
| **D. Jira-native SaaS** | Mid, scales with Jira seat tier ($10–20/user/mo) | Medium | High *if already on Jira*, poor otherwise | Jira-centric orgs of any size | Xray, Zephyr |
| **E. Enterprise SaaS incumbent** | Mid-high (~$370/user/yr self-hosted, or SaaS tiers) | Medium-High | Medium | Mid-large enterprise QA orgs | TestRail |
| **F. Enterprise ALM/QMS suite** | High (five to six figures/yr) | Very High | Low | Heavily regulated large enterprise | Jama Connect, Polarion, OpenText ALM, Greenlight Guru/MasterControl (adjacent QMS layer, 12) |

Pricing/positioning sourced from 01, 04, 05; QMS pricing from 12 (Greenlight Guru ~$29K/yr, MasterControl ~$109/user/mo).

## Gaps between groups

**Gap 1 — between Group A and Groups B/F: free-and-easy vs. compliance-deep.** No group is simultaneously free/low-complexity (A's strength) and traceability/compliance-capable (B/F's strength). A regulated mid-market buyer today must accept either A's inadequate traceability or B/F's cost and complexity penalty. This is the primary gap already surfaced in 03/04/05 — now confirmed a second way, structurally, as a gap *between groups* rather than a gap in any one competitor's feature list.

**Gap 2 — between Group C and Group D: modern UX vs. Jira-native convenience.** Group C wins on ease-of-use but requires teams to adopt a second tool outside Jira; Group D offers zero-context-switch convenience for Jira shops but inherits Jira's seat-based cost structure and, per 03, its own UX complaints ("clunky step authoring"). No group combines modern standalone UX *with* Jira-native convenience *with* a pricing model decoupled from Jira's seat tiers.

**Gap 3 — no group combines self-hosting with AI/MCP-native design.** This is the same finding as 06 and 09, restated at the group level: Groups A and B (self-hosted) both score near-zero on AI/MCP (09); Groups C, D, and E (all SaaS or SaaS-hosted-primary) are where every AI/MCP feature found in this research lives. **No strategic group currently occupies the intersection.** Three independent analytical passes (09's canvas, 12's alternative-industry lens, and this group-gap analysis) now converge on the identical whitespace — the strongest triangulation in this discovery set.

**Gap 4 — no group serves the third-tier noncustomer overlap identified in 11.** None of the six groups target GRC/compliance-adjacent buyers, ISTQB training providers, or AI-agent-primary dev teams as a defined segment — every group is built around a "QA team buys QA software" mental model, leaving the noncustomer segments in 11 entirely outside any group's positioning, not contested space within a group.

## Where the proposed idea would sit

If built as scoped in 06/07/09/10, the proposed idea doesn't fit cleanly into any existing group — it would need to *create* a new group positioned at:

- **Price:** Free/open-core (matching Group A/B, not C/D/E/F) — self-hosted-first economics.
- **Complexity:** Targeting below Group B's level (reduce, per 10 ERRC) while exceeding Group A's traceability depth (raise, per 10 ERRC) — a genuinely intermediate complexity position no group currently occupies.
- **Convenience:** Targeting Group C's ease-of-use standard, not Group A's or B's current level.
- **Segment:** Explicitly the regulated/security-conscious mid-market (Gap 1) with a secondary bridge into the noncustomer overlap from 11 (Gap 4) — neither of which any existing group's marketing or product currently addresses.

**RECOMMENDATION:** This "new group" framing is a useful sanity check on the earlier docs' conclusions (06/09/10) — it confirms the same whitespace from a fourth independent angle, but it does **not** by itself prove customers in that gap will pay, only that competitors have collectively left it uncontested. Uncontested and *valuable* are different claims — the former is now well-evidenced across four analyses, the latter still requires direct validation (11's recommendation to prioritize interviews stands).

## Sources
- [01 — Market Map](01-market-map.md), [04 — Current Solutions](04-current-solutions.md), [05 — Competitor Map](05-competitor-map.md), [09 — Strategy Canvas](09-strategy-canvas.md), [11 — Noncustomers](11-noncustomers.md), [12 — Alternative Industries](12-alternative-industries.md)

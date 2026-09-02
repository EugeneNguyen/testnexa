# 23 — Winner

**Note on numbering:** requested as "21 — Winner," renumbered to 23 (06–22 already in use). See [00-overview.md](00-overview.md) for the full index.

## The pick

**Self-hosted, MCP-native AI test generation with BYO-LLM** — the merger of survivors #1 (MCP-native from day one) and #2 (BYO-LLM test generation) from 21. They're inseparable in practice: MCP is the access layer, BYO-LLM AI generation is the value delivered through it, and neither is a complete product alone. Working name for the rest of this discovery set: **"sovereign AI testing."**

## Why not the other four survivors

- **#14 (Evidence-bundle API):** highest raw score (19) and strongest $ evidence (22), but 20 and 22 both independently flagged the same fatal dependency — it requires a GRC/QMS vendor's willingness to integrate, which is entirely outside this product's control and currently unverified. Not a winner; a phase-2 expansion bet once a partner conversation de-risks it (per 22's own recommendation).
- **#19 (Agent-governance framing):** strong budget evidence ($492M→$1B+ by 2030, 22) but fails "why us" and "can we reach them economically" (Decision-Making Q11/Q15) — it asks a small self-hosted test-tool team to win credibility against OneTrust, IBM, and Microsoft in a category this product has zero heritage in, via an enterprise security sales motion an OSS-rooted team isn't built to run. Real option later, wrong first bet.
- **#10 (Policy-as-code governance):** the only payment evidence is from an adjacent category (HashiCorp's infrastructure-governance market, 22) — zero evidence anyone has ever paid for *testing* governance specifically. Too speculative to be the wedge.
- **#12 (ISTQB sandbox):** not a monetization concept at all (22) — a funnel play with unmeasurable conversion economics from secondary research alone. Worth pursuing as marketing/acquisition, not as the core bet.

## Why #1+#2 wins on the criteria that matter, not just the criteria that score highest

- **Directly extends the original idea's DNA** (self-hosted, Dockerized) rather than pivoting into an adjacent category — "why us" is simply: this is what a self-hosted-first team is positioned to build, unlike #19's security-governance stretch.
- **No new sales motion required** — same buyer (QA/engineering leadership) already targeted by every other self-hosted competitor in this research; distribution reuses the same self-serve/OSS-download funnel Kiwi TCMS and Squash TM already validate as viable (04).
- **Feasible for a small team**, unlike #14 (requires external BD) or #19 (requires enterprise security sales infrastructure) — "integrate a BYO API key / local model endpoint into a generation pipeline" is an engineering problem this team can own end to end.
- **Willingness-to-pay evidence is real, if narrower than #14/#19**: Qase already charges separately, consumption-based, for AI generation (06, 22) — proof the market pays for this feature category, even before the self-hosted variant is priced.

## Why it creates new demand, not just competitive improvement

Four independent analyses in this discovery set — the strategy canvas (09), the AI/MCP landscape (06), the alternative-industries analysis (12), and the strategic-groups gap analysis (13) — separately found the same structural fact: **every competitor studied forces a choice between self-hosting and AI capability. Nobody occupies both.** This isn't a feature gap one vendor happened to miss; it's a category-wide blind spot (16, assumption #1) nobody has tried to break. Closing it doesn't make an existing factor better — it removes a forced trade-off, which is the textbook Blue Ocean definition of value innovation (10's ERRC grid classifies both #1 and #2 as "Create," not "Raise"), and 21's stricter competition test confirmed both survive as genuine new-market-space concepts, not disguised competitive improvements.

New demand specifically comes from:
- **Tier 2 refusing noncustomers** (11) — regulated/security-conscious teams who evaluated SaaS AI tools, hit a GDPR/Schrems II wall (03 pain #9), and concluded "no AI" was the unavoidable price of staying compliant. This removes that conclusion entirely.
- **Tier 3 unexplored noncustomers** (11) — AI-agent-driven teams with no dedicated human tester, who have never had a self-hosted tool an agent could operate at all (06 confirms zero self-hosted competitor ships first-party MCP).

## Why customers switch

- **From Kiwi TCMS / Squash TM (free self-hosted, zero AI):** they keep the self-hosting property they chose these tools for and gain the AI productivity every SaaS competitor already has — no sacrifice required to switch.
- **From Qase / TestRail / Xray / Zephyr (SaaS with AI):** for the regulated subset, this isn't preference-driven switching, it's recovering demand that was previously *disqualified entirely* — 03's research shows GDPR/Schrems II reviews reject SaaS AI vendors outright for some teams, meaning this segment currently can't buy any AI-capable competitor at all, regardless of price or feature quality.
- **From "nothing" (do-nothing/spreadsheet segment, 04) with AI-agent-primary workflows:** first time this capability exists in the category at all for them.

## Honest limitation

This concept deliberately does **not** lead with the standards/traceability depth built into the 07 ERD (test-condition-level traceability, IEEE 829/ISO 29119-3 document export, ISTQB CTFL vocabulary). That work remains valuable — 08/09/10 confirm traceability depth is a real, underserved factor — but 20 and 21 both concluded it's a "Raise," not a "Create": it makes an already-contested factor (Squash TM, Jama already compete here) better, not uncontested. It belongs in the product as supporting depth that reinforces the target segment's fit (regulated buyers value both), not as the headline reason to switch. **RECOMMENDATION:** ship it as a fast-follow, not the wedge.

## Sources
- [06 — AI & MCP Landscape](06-ai-mcp-landscape.md), [09 — Strategy Canvas](09-strategy-canvas.md), [10 — ERRC Grid](10-errc-grid.md), [11 — Noncustomers](11-noncustomers.md), [12 — Alternative Industries](12-alternative-industries.md), [13 — Strategic Groups](13-strategic-groups.md), [16 — Industry Assumptions](16-industry-assumptions.md), [20 — Strategic Fit](20-strategic-fit.md), [21 — Competition Test](21-competition-test.md), [22 — Willingness to Pay](22-willingness-to-pay.md)

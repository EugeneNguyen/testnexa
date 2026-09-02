# 20 — Strategic Fit

**Note on numbering:** requested as "18 — Strategic Fit," renumbered to 20. See [00-overview.md](00-overview.md) for the full index.

Top 5 concepts from 19 (14, 19, 1, 2, 5), each checked against customer pain (03), market trends (01), existing alternatives (04), and the ERRC grid (10), with contradictions and weak assumptions surfaced deliberately — the point of this exercise is to find the cracks, not confirm the ranking.

## #14 — Evidence-bundle API for GRC/QMS platforms

- **Fit vs. pain (03):** strong — directly answers pain #10 (no turnkey traceability without heavyweight ALM spend) by routing evidence to where regulated buyers already assemble it.
- **Fit vs. trends (01):** strong — rides the explicit 2026 data-residency/audit-evidence trend and the GRC-platform growth documented in 12/17.
- **Fit vs. existing alternatives (04):** strong — no current alternative (manual RTM-in-Jira, Squash TM, full ALM) offers automatic upstream feeding of a GRC/QMS platform.
- **Fit vs. ERRC (10):** consistent — squarely a "Create" item.
- **Contradiction / weak assumption:** the entire concept assumes Vanta/Drata/Greenlight Guru are willing to *ingest* evidence from a small, unproven open-source test tool. Research found Greenlight Guru's integration list is Jira, SSO, PLM, EDC platforms ([Greenlight Guru API](https://www.greenlight.guru/api)) — **no evidence any GRC/QMS platform currently accepts a generic test-management evidence feed from a third party.** This is a real, unvalidated dependency on someone else's roadmap, not just an engineering task on this product's own roadmap. **Weak assumption, flagged for direct validation before committing engineering effort — talk to Vanta/Drata/Greenlight Guru's partnership teams, not just the buyer.**

## #19 — Agent-governance framing for security/platform buyers

- **Fit vs. pain (03):** indirect — doesn't map to a named pain in 03 at all; 03 was built entirely from *QA-persona* pain research, so this concept's target pain (AI agent governance risk) was never directly researched as a pain point for this specific buyer in this discovery set.
- **Fit vs. trends (01):** strong — validated independently this turn: Gartner projects AI governance platform spend at **$492M in 2026, surpassing $1B by 2030**, and agentic AI spending overall at **$201.9B in 2026** ([Secure Privacy Blog / Gartner via softwarestrategiesblog.com](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/)) — a real, fast-growing, well-documented budget line.
- **Fit vs. existing alternatives (04):** weak — the alternatives a security/platform buyer currently evaluates are dedicated AI-governance platforms (OneTrust, IBM's agentic control plane, Microsoft Agent 365 — found this turn), **not test management tools of any kind.** This product would be entering a category comparison it has never been part of.
- **Fit vs. ERRC (10):** consistent — a "Create" item.
- **Contradiction / weak assumption:** this directly collides with **industry assumption #8 named in 16** ("the buyer is always a QA manager") — the whole point of #19 is to break that assumption, but doing so means positioning one product simultaneously to two buyers (QA managers evaluating test coverage, security/platform teams evaluating agent governance) who read completely different trade press, attend different conferences, and compare against completely different competitor sets. **Real risk: diluted, confusing positioning** if pursued alongside the QA-buyer-facing concepts (#14, #1, #2, #5) in the same launch — this is a distinct go-to-market motion, not a bundled feature, and should be sequenced, not shipped simultaneously with the others. Flagged as the single largest internal contradiction across the top 5.

## #1 — MCP-native from day one

- **Fit vs. pain (03):** indirect — no 03 pain names "lack of MCP support" explicitly (unsurprising, since MCP itself only reached mainstream adoption in 2026 per 06 — the pain research predates the solution's own market).
- **Fit vs. trends (01):** strong — MCP's 97M monthly SDK downloads by March 2026 (06) is real, cited, fast-moving.
- **Fit vs. existing alternatives (04):** strong — no self-hosted alternative offers this; the only competitors with agent access are all SaaS.
- **Fit vs. ERRC (10):** consistent — a "Create" item, arguably the ERRC grid's central bet.
- **Contradiction / weak assumption:** this concept assumes a **buyer already exists** who is actively looking for "a self-hosted tool an AI agent can operate." 06 explicitly flagged this as still emerging, not yet a defined budget line — the same timing risk noted for #19, but here it's a "why now" risk for the *core* product rather than a secondary buyer. **Weak assumption: that the market is ready today, not 12–18 months from now.** If MCP-agent-driven testing is still early, building this first optimizes for a market that doesn't fully exist yet at the expense of validated, currently-monetizable pain (#14's traceability gap, which has existed and gone unaddressed for years per 03/04).

## #2 — BYO-LLM test generation

- **Fit vs. pain (03):** strong, indirect — addresses pain #9 (data residency blocking SaaS AI) precisely.
- **Fit vs. trends (01):** strong — GDPR/Schrems II SaaS-avoidance trend directly evidenced in 01/03.
- **Fit vs. existing alternatives (04):** strong — genuinely nobody offers this combination (06, 09).
- **Fit vs. ERRC (10):** consistent — "Create."
- **Contradiction / weak assumption:** "self-hosted AI" is underspecified in a way that matters a lot. Does BYO-LLM mean (a) a genuinely local model running on the customer's own hardware — heavier infrastructure, likely lower generation quality, but zero external data flow — or (b) a customer-supplied API key to OpenAI/Anthropic/Azure — no vendor-operated middleman, but data still leaves the premises to a third party, which **may not satisfy the same regulated buyers this concept claims to serve.** This is a real, unresolved internal contradiction: the concept is pitched as solving the data-residency pain (03 #9), but only the local-model variant fully solves it, and that variant is the harder, lower-quality, more expensive one to build and operate. **The MVP-scoping decision (not yet made) needs to pick one interpretation explicitly, not leave it ambiguous — they serve different, non-overlapping buyer risk tolerances.**

## Fit vs. #5 — Continuous/event-driven traceability

- **Fit vs. pain (03):** strong — the most direct pain-to-concept mapping of the whole top 5, hitting pain #10 head-on.
- **Fit vs. trends (01):** strong — the GRC-industry "continuous over periodic" pattern (12, 17) is well-evidenced.
- **Fit vs. existing alternatives (04):** strong — nobody in the test-management category does this; only an adjacent industry (GRC) does.
- **Fit vs. ERRC (10):** **inconsistent** — 10's own ERRC grid places this under "Raise," not "Create" (it makes an *existing*, already-competed-on factor — traceability — better, via a new mechanism, rather than introducing a factor nobody competes on at all). 19's scoring treated it as differentiation-heavy, but the ERRC classification is more precise: this is depth on an existing battlefield (Squash TM, Jama already compete here), not new territory.
- **Contradiction / weak assumption:** "continuous" traceability assumes execution *events* are reliably available to auto-populate the RTM — true for CI-triggered automated tests, **but manual test execution (still job #2 in 02, and likely still dominant for the compliance sign-off activities the regulated beachhead cares about most) requires a human to log a result before anything can be "continuous."** The GRC-industry analogy (12) works cleanly for automated infrastructure controls Vanta/Drata monitor; it works only partially for a testing practice that's still meaningfully manual in the exact segment this idea targets. **This is the weakest technical assumption in the top 5 — "continuous" may end up meaning "continuous for the automated-test subset, same-as-everyone-else for manual," which undercuts the differentiation claim.**

## Cross-cutting insight

**INSIGHT:** Three distinct, real weaknesses surfaced that the raw scores in 19 didn't capture: (1) **#14 depends on a partner's roadmap this product doesn't control** — a distribution/BD risk, not a build risk; (2) **#19 creates a genuine go-to-market contradiction** with the other four top-5 concepts, which are all still QA-buyer-facing — sequencing, not bundling, is the fix; (3) **#1 and #5 both carry a "raise vs. create" and "is the market ready yet" ambiguity** that the ERRC grid (10) already flagged more precisely than 19's scoring did. **RECOMMENDATION:** re-weight #14 downward until partner willingness is checked directly (an email/call, not a full validation cycle), and treat #19 as a second, later product motion rather than a launch-day bundle with #1/#2/#5/#14.

## Sources
- [Greenlight Guru — API & Integrations](https://www.greenlight.guru/api)
- [Information Security Spending 2026 — Gartner via softwarestrategiesblog.com](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/)
- [03](03-customer-pain.md), [06](06-ai-mcp-landscape.md), [09](09-strategy-canvas.md), [10](10-errc-grid.md), [12](12-alternative-industries.md), [16](16-industry-assumptions.md), [19](19-blue-ocean-score.md)

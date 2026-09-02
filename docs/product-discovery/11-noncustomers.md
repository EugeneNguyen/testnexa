# 11 — Noncustomers (Three Tiers)

**Note on numbering:** requested as "09 — Noncustomers," renumbered to 11. See [00-overview.md](00-overview.md) for the full index.

Framework: Kim & Mauborgne's three tiers of noncustomers — first-tier ("soon-to-be," minimal/reluctant users on the industry's edge), second-tier ("refusing," consciously chosen against the category), third-tier ("unexplored," never considered, assumed to belong to another industry) ([Blue Ocean Strategy — Three Tiers of Noncustomers](https://www.blueoceanstrategy.com/tools/three-tiers-of-noncustomers/), [INSEAD Knowledge](https://knowledge.insead.edu/strategy/how-create-your-blue-ocean-through-noncustomer-analysis)). The canonical illustration: Salesforce won by targeting third-tier noncustomers — small businesses tracking sales in spreadsheets who had never been treated as a CRM industry's addressable market ([Blue Ocean Strategy source](https://www.blueoceanstrategy.com/tools/three-tiers-of-noncustomers/)).

## Tier 1 — Soon-to-be noncustomers

Currently paying for/using a test management tool, but minimally, reluctantly, and ready to leave at the next bad renewal or performance complaint.

- **TestRail/Zephyr users hitting the scale wall.** Directly evidenced by the "clunky/slow once suites grow large," "performance issues... slow to load" complaints (03 #2). These are active customers of the category, but mentally checked out — the review language ("starts to feel," "biggest problem") reads as people looking for the exit, not people happy with their choice.
- **Small teams on Kiwi TCMS's or Squash TM's free tier who've hit the AI/traceability ceiling.** They're using the category (self-hosted OSS), but as soon as a competitor offers what they're missing (AI generation for Kiwi TCMS users, ease-of-use for Squash TM users — both per 09's canvas), they're primed to switch, not champion the incumbent.
- **Why they're on the edge, not committed:** the tool solves the base job (organize/execute test cases, 02) adequately but fails on a factor that's rising in importance (performance at scale, AI capability) faster than the incumbent is addressing it.

## Tier 2 — Refusing noncustomers

Aware the category exists, have evaluated it, and consciously chosen not to buy — not out of ignorance, out of rejection.

- **Lean/Agile teams who treat formal test management as waterfall bureaucracy.** Directly evidenced: *"formal test management tools represent significant overhead for the use case... built for waterfall processes and still expect detailed test cases written upfront, formal sign-offs, and separate testing phases – exactly what agile teams are trying to avoid"* ([TestQuality](https://testquality.com/best-test-management-tools-for-agile-qa-teams/)). These teams use Jira tickets, checklists, or nothing formal, by deliberate choice, believing the category's process overhead outweighs its value for their release cadence.
- **Regulated-industry teams doing traceability by hand in Jira/Excel instead of buying Squash TM or an ALM suite.** Evidenced indirectly by the existence of "how to build an RTM inside Jira" guides as a genuine workaround pattern ([Ketryx](https://www.ketryx.com/blog/iec-62304-requirements-traceability-matrix-rtm-in-jira-a-guide-for-medical-device-companies)) — these are teams that know the traceability-focused tools exist, and have judged them not worth the cost/complexity, choosing DIY instead. This is a **refusal of the whole category's current offerings**, not ignorance of the category — and directly overlaps with the beachhead segment this idea targets (03/04), which is a warning as much as an opportunity: if this segment already refused Squash TM specifically for being too heavy (09), a new entrant has to prove it solved that objection, not just replicate the traceability feature set.
- **Why they refuse:** perceived overhead-to-value ratio is unfavorable for their specific context — either the standards rigor isn't worth the process cost (Agile teams), or the standards-capable tools aren't worth their operational cost (regulated DIY teams).

## Tier 3 — Unexplored noncustomers

Never considered a test management tool at all — their need is currently assumed to belong to a different industry, or they don't perceive themselves as having the underlying job.

- **Freelance developers, solo founders, and pre-PMF startups** — the "do nothing"/tribal-knowledge segment named in 04. Genuinely never in the market; the category has never been built for a market of one.
- **Non-QA roles doing ad hoc verification work** — support/CS agents verifying reported bugs, product managers running acceptance checks before a release, technical writers validating documentation examples still work. They perform testing-shaped work constantly but have never been treated as the category's customer — the industry markets exclusively to people with "QA" or "Test" in their title.
- **ISTQB exam candidates and training providers** — flagged as a distinct, smaller possible market back in 02 (job #10/hypothesis). They want to *practice* test design techniques and process concepts hands-on, a training/education need, not a production test-management need — genuinely unexplored because every competitor studied builds for production QA teams, none for the certification-training use case specifically.
- **AI-agent-driven / "vibe-coding" teams where testing is executed almost entirely by agents, not humans.** An emerging, directly evidenced-as-real pattern given 06's findings (MCP-driven agentic test generation and execution is now shipping in Katalon, QA Touch, TestCollab, Qase's Agentic Mode) — but the *organizational* pattern of a team with no dedicated human tester role at all, where an agent is the primary "user" of a test management system, is not yet a segment any competitor explicitly designs for. This is the segment most directly unlocked by the Actor-based human/AI model in the 07 ERD.
- **GRC/compliance teams solving an adjacent job with an entirely different tool category.** Teams using Vanta/Drata for SOC 2/ISO 27001 continuous-compliance evidence ([Vanta](https://www.vanta.com/resources/automated-evidence-collection-for-compliance-all-you-need-to-know), [Drata](https://drata.com/products/compliance)) need "prove this control was verified" — structurally the same underlying job as "prove this requirement was tested" — but have never been sold to by the test-management industry because their tool-buying journey starts in security/compliance software, not QA software. Detailed further in 12 (Alternative Industries).

## Insight

**INSIGHT:** The most strategically interesting noncustomer isn't Tier 1 (easiest to convert, but converting them just means winning share in the same red ocean 09 already describes) — it's the overlap between **Tier 2's regulated-DIY-traceability refusers** and **Tier 3's GRC/compliance-adjacent unexplored segment**. Both are already doing the underlying job (proving verification happened) with tools/processes that were never built for it (spreadsheets-in-Jira, or an entirely different software category). Converting either doesn't require beating an incumbent on its own turf — it requires being visibly, obviously better than "assembling evidence by hand," which is a much lower bar than beating TestRail's feature parity. **RECOMMENDATION:** prioritize customer discovery interviews with this overlap segment specifically (regulated mid-market teams currently DIY-ing traceability, and compliance/security roles who've never evaluated a test tool) over generic Agile-team interviews — the Agile segment is Tier 2 for a *reason* (rejects the category's process overhead on principle) and is a harder, lower-value conversion even if larger in raw count.

## Sources
- [Blue Ocean Strategy — Three Tiers of Noncustomers](https://www.blueoceanstrategy.com/tools/three-tiers-of-noncustomers/)
- [INSEAD Knowledge — Noncustomer Analysis](https://knowledge.insead.edu/strategy/how-create-your-blue-ocean-through-noncustomer-analysis)
- [TestQuality — Best Test Management Tools for Agile QA Teams](https://testquality.com/best-test-management-tools-for-agile-qa-teams/)
- [Ketryx — IEC 62304 RTM in Jira](https://www.ketryx.com/blog/iec-62304-requirements-traceability-matrix-rtm-in-jira-a-guide-for-medical-device-companies)
- [Vanta — Automated evidence collection for compliance](https://www.vanta.com/resources/automated-evidence-collection-for-compliance-all-you-need-to-know)
- [Drata — Achieve Continuous Compliance](https://drata.com/products/compliance)
- [03 — Customer Pain](03-customer-pain.md), [04 — Current Solutions](04-current-solutions.md), [06 — AI & MCP Landscape](06-ai-mcp-landscape.md)

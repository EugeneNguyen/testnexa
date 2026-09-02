# 24 — Value Proposition

**Note on numbering:** requested as "22 — Value Proposition," renumbered to 24. See [00-overview.md](00-overview.md) for the full index.

## Target customer

**Primary:** QA/engineering leadership (Test Manager, Head of QA, Platform Engineering Lead) at mid-market software teams that are either (a) contractually/regulatorily required to self-host — regulated industries (medtech, finance, aerospace), GDPR/data-residency-constrained EU teams, or security-conscious enterprises with a Schrems II-sensitive DPA review — or (b) already committed to self-hosting for cost/control reasons and are early adopters or active pilots of AI coding agents (Claude Code, Cursor, GitHub Copilot). **HYPOTHESIS**, not yet interview-validated — this is the segment triangulated across 03, 09, 11, 13.

**Secondary/expansion:** engineering teams operating with an AI-agent-primary testing workflow and no dedicated human tester role (11, Tier 3) — a smaller, newer segment, likely reached after the primary segment validates.

## Job-to-be-done

*"When I need to generate or expand test coverage quickly using AI, I want that AI assistance to run entirely within infrastructure I control, so I can get the same testing productivity every SaaS competitor already offers without violating my data-residency requirements or trusting a third-party vendor's cloud AI pipeline with my requirements, code context, and test data."*

Directly extends job #9 (self-hosting, 02) and job #5 (CI/automation-result unification, 02), combined with the AI-generation job that didn't exist as a named job in 02 because AI test generation only became a mainstream category expectation in 2026 (06) — after the original jobs analysis was run. This value proposition is, in effect, a new job the market created since discovery began, not one this research initially anticipated.

## Pain

Directly maps to **pain #9** (03): *"EU teams shopping for GDPR-compliant test automation hit a wall the moment a SaaS QA vendor's data leaves the EU"* — and to the structural finding, confirmed four independent ways (09, 06, 12, 13), that **every competitor forces customers to choose between self-hosting and AI capability.** The pain isn't "AI tools are bad," it's "the AI tools that exist are categorically unavailable to me," which is a harder, more absolute pain than a feature-quality complaint — there's no workaround, only exclusion.

## Gain

- AI-assisted test generation at parity with what SaaS leaders already ship (TestRail's Sembi IQ, Xray's requirement-to-test-case generation, Qase's Agentic Mode — all confirmed in 06) — closing a capability gap this segment has been excluded from entirely, not incrementally improving something they already have.
- Agent-operable via first-party MCP, so AI-assisted testing fits directly into an already-adopted AI-native dev workflow (Claude Code, Cursor) instead of requiring a context switch into a separate tool — importing the lesson from 12's AI-coding-platform alternative-industry analysis.
- Data (requirements, test cases, code context sent to the model) never leaves customer-controlled infrastructure — the gain isn't just "AI," it's "AI without the compliance conversation," which for the regulated segment is the difference between "usable" and "not usable at all."

## Unique value proposition

> **The only self-hosted test management tool where AI-assisted testing never leaves your infrastructure — and the only self-hosted one an AI agent can operate directly, via MCP.**

Deliberately narrow and falsifiable — it's a claim about what's *absent* everywhere else (06 confirmed zero self-hosted competitor offers first-party AI or MCP), not a broad "best test management tool" claim this research found no evidence anyone could currently support (09's canvas shows a genuine sea of sameness on most factors).

## Reason to believe

- **FACT:** no self-hosted/open-source competitor studied (Kiwi TCMS, Squash TM, TestLink) offers first-party AI generation or a first-party MCP server — Kiwi TCMS's only MCP access is an unofficial, community-built project ([github.com/danish54/kiwi-tcms-mcp-server](https://github.com/danish54/kiwi-tcms-mcp-server)), confirmed directly against vendor documentation this session (06).
- **FACT:** commercial competitors already charge separately for AI test generation — Qase's Agentic Mode is consumption-based, restricted to paid Teams/Enterprise tiers (06) — proving the market pays for this capability category before this product's specific self-hosted variant is even priced.
- **FACT:** MCP reached 97 million monthly SDK downloads by March 2026, with every major AI provider (Anthropic, OpenAI, Google, Microsoft, AWS) supporting it (06) — the access pattern this concept depends on is demonstrably real and fast-growing, not a speculative bet on an unproven protocol.
- **INSIGHT:** four independent analytical lenses in this discovery set — the strategy canvas (09), the direct AI/MCP competitive landscape check (06), the alternative-industries analysis (12), and the strategic-groups gap analysis (13) — arrived at the identical finding (self-hosted + AI/MCP is uncontested) without being designed to reach the same conclusion. Convergence across independently-run analyses is stronger evidence than any one of them alone.

## What's still unproven

Everything above is secondary-research evidence that the *opportunity* is real; it is not evidence that *this specific target customer* will adopt or pay for *this specific product*. Per Decision-Making Q3/Q4/Q10 (how painful, how frequent, will customers pay) — none of these have been tested with a real conversation yet. That's the explicit job of 26 (MVP) and 27 (Experiment), not this document.

## Sources
- [02 — Customer Jobs](02-customer-jobs.md), [03 — Customer Pain](03-customer-pain.md), [06 — AI & MCP Landscape](06-ai-mcp-landscape.md), [09 — Strategy Canvas](09-strategy-canvas.md), [11 — Noncustomers](11-noncustomers.md), [12 — Alternative Industries](12-alternative-industries.md), [13 — Strategic Groups](13-strategic-groups.md), [23 — Winner](23-winner.md)

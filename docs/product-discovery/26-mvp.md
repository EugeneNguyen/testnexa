# 26 — MVP

**Note on numbering:** requested as "24 — MVP," renumbered to 26. See [00-overview.md](00-overview.md) for the full index.

## Core hypothesis this MVP exists to test

> Regulated/self-hosting-committed QA teams will adopt **and pay for** AI-assisted test generation specifically because it runs entirely within their own infrastructure — when they would not adopt or pay for an equivalent SaaS AI generation feature.

Everything in scope below exists to test this one hypothesis as cheaply as possible. Everything cut is cut because it tests a *different* hypothesis (traceability depth, standards compliance, governance, GRC integration) that 20/21/22 already flagged as either lower-priority, unproven, or dependent on someone else's decision. Building those into the MVP would blur the read on this hypothesis, not strengthen it.

## In scope

- **Minimal self-hosted deployment.** Single Docker Compose file, single-org (no multi-tenant `Organization`/`OrgMembership` from the 07 ERD — deliberately deferred, adds setup complexity that isn't being tested here).
- **Core test asset model, minimum viable:** `Requirement` (title + description only), `TestCase`, `TestStep`, `TestSuite`, `TestExecution` (pass/fail/blocked + notes). Just enough to be a usable test tracker — the AI-generation hypothesis can't be tested against an empty product.
- **First-party MCP server**, minimum surface: create/list/update `TestCase`, create `TestExecution`, read `Requirement`. Enough for an agent (Claude Code, Cursor) to actually drive the workflow end to end, not a demo stub.
- **BYO-LLM AI test-case generation**, the core thing being tested: customer supplies either (a) an API key for a commercial provider (OpenAI/Anthropic/Azure-compatible endpoint) or (b) points at a local Ollama-compatible endpoint. Generates draft test cases from a pasted requirement/user story.
- **Basic auth**, single admin + a handful of invited users, local password only — no SSO/LDAP/`AuthIdentity` richness from 07 yet.
- **Usage logging** (generation count, execution count) — instrumented from day one even though not billed yet, specifically to produce the data Model B (25) needs to be priced later.

## Explicitly out of scope (and why)

| Cut | Why it's cut |
|---|---|
| `TestCondition`/CTFL-vocabulary layer, entry/exit criteria, IEEE 829 document export (07's standards-depth entities) | 20/21 classified this as "Raise" (compete better), not "Create" (new market) — valuable, but not what this MVP is testing |
| Multi-tenant `Organization`/`OrgMembership`, full RBAC/`RoleAssignment` | Adds setup friction without testing the core hypothesis; single-org is sufficient to validate demand |
| `Approval` (e-signature-grade or otherwise), `RiskItem`, full `TraceabilityLink` graph | All "compete better" items per 21 — not needed to test a new-market hypothesis |
| Evidence-bundle API / GRC integration (concept #14) | Explicitly deferred per 20/22's own recommendation — validate partner willingness through direct conversation before writing any code against it |
| Policy-as-code governance (#10), ISTQB sandbox (#12), agent-governance security framing (#19) | Each is a distinct concept with its own go-to-market motion (25's Model C logic applies analogously) — none belong in a single-hypothesis MVP |

## What must be true for this MVP to succeed

1. Target users will actually complete BYO-LLM/local-endpoint setup rather than abandoning at that step — an adoption-friction risk nothing in this research has tested directly.
2. Generated test-case quality is good enough to be used with light editing, not discarded — a real technical risk: smaller/local models may produce materially worse output than the GPT-4/Claude-class models SaaS competitors use, and this research has no evidence either way on local-model quality specifically for test-case generation.
3. The self-hosted/BYO-LLM property is *actually* the reason people use it — not just a nice-to-have alongside a product they'd have adopted anyway for other reasons.

## What would invalidate it

If pilot users generate test cases via BYO-LLM at a materially lower rate than they'd use an equivalent feature if it were a hosted/cloud option — i.e., they still open ChatGPT/Cursor manually instead of using the in-tool generation — the "self-hosting was the adoption blocker" hypothesis (03, 09) is falsified. That would mean the forced trade-off this whole discovery process identified wasn't actually preventing adoption, just a secondary preference — a materially different, weaker finding than what 06/09/12/13 collectively suggested, and grounds to revisit whether #1+#2 was the right winner (23) at all, not just an execution problem to fix.

## Sources
- [07 — Conceptual ERD](07-erd-draft.md), [20 — Strategic Fit](20-strategic-fit.md), [21 — Competition Test](21-competition-test.md), [22 — Willingness to Pay](22-willingness-to-pay.md), [23 — Winner](23-winner.md), [25 — Business Model](25-business-model.md)

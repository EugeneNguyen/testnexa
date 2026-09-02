# 12 — Alternative Industries

**Note on numbering:** requested as "10 — Alternative Industries," renumbered to 12. See [00-overview.md](00-overview.md) for the full index.

Blue Ocean "alternative industries" analysis: products in a *different* industry that customers use to accomplish the same underlying job, even though nobody would call them competitors on a feature-comparison chart. The goal is to import a transferable value proposition, not to imitate the alternative industry's product.

## 1. GRC / continuous-compliance platforms (Vanta, Drata, Secureframe)

**Industry:** Security/compliance software, not QA/testing software.
**Same job:** "Produce continuous, defensible evidence that a control/requirement was verified" — structurally identical to "prove a requirement was tested," just scoped to security controls instead of software requirements.
**How they solve it differently:** Vanta's continuous monitoring runs automated tests against connected systems *every hour*; Drata connects to 300+ tools and centralizes evidence collection so it "runs always-on rather than as a periodic manual process" ([Vanta](https://www.vanta.com/resources/automated-evidence-collection-for-compliance-all-you-need-to-know), [Drata](https://drata.com/products/compliance)). Evidence collection cuts audit prep by a claimed 82% ([Vanta](https://www.vanta.com/resources/automated-evidence-collection-for-compliance-all-you-need-to-know)).
**Transferable value proposition:** Every test management tool studied (01–05) treats test execution as a manually-triggered or CI-triggered *event* that a human then reviews and assembles into a report at audit time. The GRC industry's insight — evidence should accumulate continuously and automatically, not be reconstructed on demand — is directly transferable to the `TestExecution`/`TestLog`/`TraceabilityLink` design in 07: an always-current, queryable RTM rather than an exportable snapshot generated only when an auditor asks.

## 2. Medical device / regulated QMS suites (Greenlight Guru, MasterControl)

**Industry:** Quality management systems, broader than software testing — covers the entire regulated product lifecycle.
**Same job:** "Prove requirement → verification traceability to an external auditor/regulator," the same job as 03's pain #10, just addressed at the whole-product level rather than the software-test level.
**How they solve it differently:** Greenlight Guru's traceability matrix "automatically links user needs to design inputs, outputs, verification, and validation activities, providing end-to-end visibility across the product lifecycle **without manual overhead**" ([Greenlight Guru](https://www.greenlight.guru/design-control-software)), and integrates with Jira specifically so engineering teams keep their Agile workflow while traceability is maintained in the QMS layer automatically ([Greenlight Guru Jira integration announcement](https://www.greenlight.guru/blog/greenlight-guru-announces-jira-integration)). Pricing is enterprise-scale — Greenlight Guru can run **~$29,000/year**, vs. MasterControl's **~$109/user/month** ([ERP Research](https://www.erpresearch.com/erp-add-ons/healthcare/greenlight-guru)) — confirming the earlier finding (04) that regulated mid-market teams are priced out of full QMS-grade traceability tooling and fall back to DIY Jira hacks instead.
**Transferable value proposition:** "Automatic traceability without manual overhead" is the exact promise this idea's `TraceabilityLink` model (07) needs to deliver at the *test* layer specifically — and Greenlight Guru's Jira-coexistence pattern (don't replace the team's Agile tool, sit alongside it and maintain traceability automatically) is a distribution/positioning lesson: don't ask regulated teams to abandon Jira, integrate with it the way Greenlight Guru does. Also confirms a **downstream-integration opportunity**, covered further in 14: this product's traceability output should be exportable in a shape a QMS platform can ingest, not just a human-readable report.

## 3. Generic knowledge/project tools repurposed for testing (Notion, Confluence, Linear, Airtable)

**Industry:** General project/knowledge management, not testing-specific.
**Same job:** "Organize and track completion of a defined body of work" — test cases are, structurally, just another kind of tracked work item.
**How they solve it differently:** flexible, template-driven, fast-to-adopt databases/views instead of rigid, testing-specific data-entry forms. This is literally the on-ramp for the "spreadsheet ceiling" segment identified in 04 — teams reach for Notion/Airtable before they reach for a dedicated test tool, for the same reason they reach for spreadsheets: zero setup friction.
**Transferable value proposition:** the lesson isn't a feature, it's a UX posture — Squash TM's heaviness (09's lowest ease-of-use score in the set) is precisely the failure mode this alternative industry avoids. A rigor-optional, template-flexible entry experience (already flagged as ERD open question #1 in 07 — make `TestCondition` optional) is directly importing this alternative industry's core lesson, not a novel idea invented from scratch.

## 4. AI coding-agent platforms and IDEs (Claude Code, Cursor, GitHub Copilot, Windsurf)

**Industry:** Developer tooling / AI coding assistants, not QA software.
**Same job, increasingly:** "verify code behaves as intended" is now something these tools do natively — an agent writes code, writes a test, runs it, and self-corrects, entirely inside the IDE, without ever opening a separate test management tool.
**How they solve it differently:** the verification loop happens where the agent already is, with no context switch. This is the same underlying dynamic 06 identified from the MCP-adoption angle, now reframed from the "alternative industry" lens: dev-tooling platforms aren't a competitor to test management tools, they're gradually *absorbing* part of the job test management tools exist to serve, for the subset of testing that can be fully automated and agent-executed.
**Transferable value proposition:** meet the agent where it already works via MCP (06) rather than compete for a separate screen in the workflow — this is the second independent line of evidence (after the strategy canvas in 09) pointing at first-party MCP support as the load-bearing differentiator, not an optional add-on.

## 5. E-signature / approval workflow platforms (DocuSign, PandaDoc, Adobe Sign)

**Industry:** Document execution/legal-workflow software, not QA software.
**Same job:** "Produce a legally or organizationally defensible record that a specific, identified person approved something at a specific time" — exactly what IEEE 829's Approvals section and the 07 ERD's `Approval` entity are trying to achieve, just generalized across all document types instead of specific to test plans.
**How they solve it differently:** cryptographic/timestamped, non-repudiable signature records with a full audit chain, purpose-built for legal defensibility — a materially higher rigor bar than a database row with an `approved_at` timestamp.
**Transferable value proposition:** the current `Approval` entity design (07) is a reasonable MVP but under-specifies rigor relative to what this alternative industry treats as baseline — worth revisiting whether test-plan approvals in a regulated context need e-signature-grade non-repudiation (audit-log hash chaining, IP/device capture) rather than a plain timestamp, once the regulated beachhead segment (03/04/11) is validated as the actual target buyer.

## Insight

**INSIGHT:** Four of five alternative industries examined point at the same underlying lesson from different angles: **the winning move is automatic, continuous, low-friction evidence/traceability, integrated into tools people already use, rather than a separate system people have to remember to feed.** GRC platforms prove buyers will pay well for "continuous instead of manual" (Vanta/Drata are large, funded businesses). QMS platforms prove the traceability-without-overhead promise is valued highly enough to sustain $29K/year pricing. AI coding platforms prove verification work is migrating to wherever the agent already operates. This converges cleanly with the 06 finding and the 09 strategy-canvas gap — three independent analytical lenses landing on the same answer is a genuine triangulated INSIGHT, not a single-source hunch.

## Sources
- [Vanta — Automated evidence collection for compliance](https://www.vanta.com/resources/automated-evidence-collection-for-compliance-all-you-need-to-know)
- [Drata — Achieve Continuous Compliance](https://drata.com/products/compliance)
- [Greenlight Guru — Design Control Software](https://www.greenlight.guru/design-control-software)
- [Greenlight Guru — Jira Integration announcement](https://www.greenlight.guru/blog/greenlight-guru-announces-jira-integration)
- [ERP Research — Greenlight Guru Review 2026](https://www.erpresearch.com/erp-add-ons/healthcare/greenlight-guru)
- [04 — Current Solutions](04-current-solutions.md), [06 — AI & MCP Landscape](06-ai-mcp-landscape.md), [09 — Strategy Canvas](09-strategy-canvas.md)

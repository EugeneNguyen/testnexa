# 04 — Current Solutions (how customers solve this today)

Applying "Customer → Job → Problem → Existing Alternative" thinking. Alternatives are grouped from most-manual/lowest-cost to most-automated/highest-cost, because that's the axis customers actually move along as they outgrow each option.

## 1. Do nothing / tribal knowledge
Smallest teams (1–3 testers, or developers testing their own code) often track almost nothing formally — tests exist as memory, ad hoc manual checks before a release, or scattered comments in pull requests. **Zero cost, near-zero setup, but zero traceability, zero handoff continuity, and no defensibility if something breaks.** This is the true "do nothing" alternative and it's the default for the smallest noncustomer segment (see future doc 06).

## 2. Spreadsheets (Excel / Google Sheets)
The dominant first tool. *"Spreadsheets are the default first tool for a reason: everyone already has Excel or Google Sheets, there's nothing to set up, and for a handful of test cases they're genuinely faster than any dedicated tool"* ([TestMonitor](https://www.testmonitor.com/blog/the-best-alternatives-to-traditional-excel-based-test-tracking)). Breaks down at scale: **version conflicts, accidental overwrites, no audit trail, limited access control, poor coverage visibility** ([Kualitee](https://www.kualitee.com/blog/test-management/test-management-vs-excel-based-process/)). This is the segment every dedicated tool (commercial or open-source) is ultimately competing to convert — it is not a competitor to differentiate against, it's the acquisition funnel.

## 3. Generic project/issue trackers repurposed as test trackers
Teams already using Jira, Linear, GitHub Issues, or Trello sometimes track test cases as issues/tickets rather than adopting a dedicated tool, especially pre-Series-A startups minimizing tool sprawl. Works for small volume; breaks down because issue trackers lack test-specific structures (steps, expected/actual results, reusable suites, execution history per run) — this gap is exactly what Zephyr/Xray commercialize by building *on top of* Jira rather than requiring customers to leave it.

## 4. Jira-native test management plugins (Xray, Zephyr)
For teams already deep in Jira, adding a test-management Marketplace app is the lowest-friction upgrade from spreadsheets/tickets — no new login, tests live next to the requirements/stories they verify. Costs scale with Jira user tier (~$10–20/user/month), which becomes the #1 named pain at scale (see 03). **This is the dominant current solution for Jira-centric orgs**, and the toughest incumbent to displace precisely because it requires zero new tool adoption — only a self-hosted tool that also integrates cleanly with Jira (not replaces it) has a shot at teams already here.

## 5. Standalone commercial SaaS (TestRail, Qase, Testiny, TestMonitor, PractiTest, QA Sphere)
Chosen by teams that want purpose-built UX and don't want test management coupled to Jira's data model/pricing. TestRail is the incumbent leader (45.33% market share among Xray's named competitors, per [6sense](https://6sense.com/tech/test-management/xray-test-management-market-share)). Newer entrants (Testiny, Qase) compete on price and modern UX against TestRail's "clunky at scale" reputation (see 03). None of these are self-hosted-first; TestRail offers a self-hosted Server tier but at a steep perpetual-license cost, not a lightweight Docker-first option.

## 6. Open-source / self-hosted test management (the direct comparison set for this idea)
- **TestLink** — oldest, PHP/MySQL, dated UI, large but aging community, low release cadence. Free, no vendor.
- **Kiwi TCMS** — Django/Python, GPLv2, actively maintained, modern-for-open-source UI, Docker-native deployment, official automation-framework reporters (Playwright/Cypress/pytest), REST API, RBAC. Commercial hosting/enterprise tiers layered on top of the free self-hosted core ($25–$2,000/month depending on tier). **This is the closest existing product to the stated idea** — open source, self-hosted, Dockerized, active. It does not market itself as "ISTQB-compliant," which is either whitespace or evidence the positioning isn't a real purchase driver (see 02).
- **Squash TM** — open-core, strongest of the open-source set on requirements traceability and enterprise workflow/approval features, explicitly positioned for "large, enterprise organizations... with a broad range of compliance requirements." Free Community edition; Premium from ~€2,000/year. **This is the closest existing product to the "regulated/traceability" beachhead identified in 03.**
- **Allure TestOps** — open-core, built on the popular Allure Report framework, strongest for teams whose testing is automation-heavy and want native ingestion of automated results rather than manual re-entry.

## 7. Enterprise ALM suites (Jama Connect, Polarion, Micro Focus/OpenText ALM, Azure Test Plans)
Chosen by the most heavily regulated organizations (medical device, aerospace, automotive, finance) that need requirement→design→test→risk traceability as a hard compliance requirement (IEC 62304 and analogous standards). High cost, long implementation, but currently the most complete answer to job #4/#10 (traceability, see 02/03). Some teams instead **build a DIY traceability matrix inside Jira** using guides like Ketryx's, rather than buy a dedicated ALM suite — evidence that there's unmet demand for a mid-cost, faster-to-deploy alternative between "spreadsheet/Jira hack" and "$100K+ ALM suite."

## Alternative-adequacy assessment

| Alternative | Adequate for whom | Where it fails |
|---|---|---|
| Nothing / tribal knowledge | Solo devs, pre-product-market-fit startups | No handoff, no audit trail, breaks at any team growth |
| Spreadsheets | <5 testers, low complexity | Version control, access control, coverage visibility, collaboration |
| Repurposed issue trackers | Small teams already in one tool | No test-specific structure, no reusable suites/execution history |
| Xray/Zephyr (Jira-native) | Jira-centric orgs of any size | Cost scales with Jira seat tier, not testing usage; SaaS-only, data leaves premises |
| TestRail/Qase/Testiny (SaaS) | Teams wanting dedicated UX, comfortable with SaaS | Cost at scale, SaaS-only (TestRail has pricey self-hosted option), performance/reporting complaints at scale |
| Kiwi TCMS | Teams wanting free, active, Docker-native OSS | No compliance/traceability-first workflow, no explicit standards alignment, thinner enterprise governance features than Squash TM |
| Squash TM | Enterprise regulated teams needing traceability | Open-core paywall for premium features, French-company-centric support/community reach outside Europe (unverified — **ASSUMPTION**), heavier/more complex to adopt for smaller teams |
| Jama/Polarion/ALM suites | Large regulated enterprises with big budgets | Cost, implementation time, overkill for mid-market regulated teams |

## Insight

**INSIGHT:** There is no existing self-hosted, open-source tool that combines (a) Kiwi TCMS's modern UX/active development/Docker-first deployment with (b) Squash TM's requirements-traceability and compliance-workflow depth, explicitly positioned around ISTQB/ISO 29119 standard vocabulary and process. That combination is the actual whitespace — not "another open-source TestRail clone." Whether that whitespace is *large enough to be worth building for* depends entirely on validating the regulated/audit-driven beachhead segment size directly with target customers — flagged as the top priority for the next research phase (06 Noncustomers / validation plan).

## Sources
- [TestMonitor — Best Alternatives to Excel-Based Test Tracking](https://www.testmonitor.com/blog/the-best-alternatives-to-traditional-excel-based-test-tracking)
- [Kualitee — Test Management vs Excel](https://www.kualitee.com/blog/test-management/test-management-vs-excel-based-process/)
- [6sense — Xray Test Management Market Share](https://6sense.com/tech/test-management/xray-test-management-market-share)
- [Kiwi TCMS](https://kiwitcms.org/) / [GitHub](https://github.com/kiwitcms/Kiwi/) / [SoftwareSuggest pricing](https://www.softwaresuggest.com/kiwi-tcms)
- [Squash TM product page](https://www.squashtest.com/product-squash-tm?lang=en) / [Software Advice pricing](https://www.softwareadvice.com/product/523278-Squash/)
- [Autonoma — Open Source Test Management: TestLink, Kiwi TCMS, and the Real Tradeoffs](https://getautonoma.com/blog/open-source-test-management)
- [Ketryx — IEC 62304 RTM in Jira](https://www.ketryx.com/blog/iec-62304-requirements-traceability-matrix-rtm-in-jira-a-guide-for-medical-device-companies)

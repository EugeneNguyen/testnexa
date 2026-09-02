# 22 — Willingness to Pay

**Note on numbering:** requested as "20 — Willingness to Pay," renumbered to 22. See [00-overview.md](00-overview.md) for the full index.

Evidence of willingness to pay for the six concepts that survived 21's competition test (1, 2, 10, 12, 14, 19), plus 13 as the attached distribution mechanism. **This is secondary-market evidence that a budget line exists and spends money on adjacent things — it is not primary evidence that anyone will pay *this product* for *this concept*.** That gap can only be closed by direct customer conversations (pricing interviews, letter-of-intent, or a paid pilot), which this discovery set has not yet run. Everything below is labeled accordingly.

## #1 — MCP-native from day one

- **Buyer:** QA/engineering leadership at teams already running or piloting AI coding agents (Claude Code, Cursor, Copilot).
- **Budget source:** existing dev-tooling/QA tooling budget — no new budget line required, which is a *point in favor* of willingness to pay (lower purchase friction than #19).
- **Pricing benchmark:** no direct comparable found — MCP server access is currently bundled free into Katalon, QA Touch, and TestCollab's existing paid tiers (06), suggesting the market has not yet established MCP access as a separately-priced line item. **ASSUMPTION:** likely monetized as part of a base subscription/support tier, not billed standalone.
- **Purchasing trigger:** a team already using an AI coding agent hits the wall of the agent being unable to reach test management data — evidenced qualitatively by 06's finding that agent-native competitors ship this as a headline feature, implying vendors believe it drives adoption, though no churn/win-rate data was found to confirm it drives *purchase* specifically.
- **Verdict:** **HYPOTHESIS, moderate confidence.** Real budget exists (it's the same QA budget), but no evidence anyone pays a premium for MCP access specifically — it may be a retention/table-stakes feature rather than a standalone willingness-to-pay driver, contradicting its "NEW" classification in 21 somewhat: new market space doesn't guarantee new spend if incumbents give it away free.

## #2 — BYO-LLM test generation

- **Buyer:** same QA/engineering leadership as #1, specifically at regulated or security-conscious organizations.
- **Budget source:** QA tooling budget, potentially co-funded by security/compliance budget given the data-residency angle (03 #9).
- **Pricing benchmark:** commercial competitors charge for AI generation as a premium feature (Qase's Agentic Mode is consumption-based, restricted to Teams/Enterprise plans per 06) — establishes that **the market already pays extra for AI test generation specifically**, which is stronger evidence than #1 has.
- **Purchasing trigger:** a specific, named blocker — "our DPA/Schrems-II review rejected the SaaS AI vendor" (directly evidenced language from 03's GDPR research) — a hard compliance gate is a strong purchasing trigger because there's no workaround, not just a preference.
- **Verdict:** **HYPOTHESIS, higher confidence than #1.** The market already demonstrates willingness to pay for AI generation as a feature (Qase's consumption pricing); the open question is narrower — whether "self-hosted/BYO-LLM" specifically commands the same or a different price than cloud AI, not whether AI generation itself is worth paying for.

## #10 — Policy-as-code testing governance

- **Buyer:** VP Engineering/Head of QA at larger, process-mature organizations — explicitly *not* the same buyer as smaller regulated teams targeted by #2/#14.
- **Budget source:** engineering governance/platform budget.
- **Pricing benchmark:** directly comparable to HashiCorp's model — Sentinel/policy-as-code is gated to Terraform Cloud's **Premium tier and above** (unlimited policies) with Enterprise pricing entirely custom/negotiated, no public per-user rate ([env0](https://www.env0.com/insights/terraform-cloud-pricing-in-2026), [Spacelift](https://spacelift.io/blog/terraform-cloud-pricing)) — confirms governance-as-a-paid-layer is an established, negotiated-enterprise-deal pattern, not a self-serve line item.
- **Purchasing trigger:** an organization scaling past the point where informal testing standards break down — no direct evidence of this trigger for *testing* governance specifically (Terraform's evidence is for infrastructure governance, an adjacent but different category).
- **Verdict:** **HYPOTHESIS, lower confidence.** Real precedent that governance layers get monetized at enterprise scale exists (HashiCorp), but zero evidence any test-management buyer has ever paid for this specific capability — it's inferring a category that doesn't exist yet in testing from one that exists in infrastructure. Riskiest of the six on pure payment evidence, even though 21 confirmed it's genuinely new territory.

## #12 — Free ISTQB technique-practice sandbox

- **Buyer:** individual exam candidates (self-funded) and corporate L&D budgets (training providers/employers funding staff certification).
- **Budget source:** mixed — individual out-of-pocket for the exam itself, employer L&D budget for training courses.
- **Pricing benchmark:** ISTQB Foundation Level exam costs **$229**; Advanced Level exams **$249**; Expert-level **$575** ([ASTQB](https://astqb.org/istqb-faqs/what-is-the-price-of-an-istqb-exam/), [AT*SQA](https://atsqa.org/pricing-faq)). Training courses range **$250–$300** for self-study to **$1,000–$1,800** for accredited live courses, with premium 3-day courses exceeding **$2,000** ([thepricer.org](https://www.thepricer.org/how-much-does-istqb-certification-cost/)). ISTQB has issued **560,000+ exams and 400,000+ certifications** historically, growing at roughly **50,000 certifications/year** (2015-era data, likely higher now — **ASSUMPTION** that growth has continued at least at that rate) ([GeeksforGeeks](https://www.geeksforgeeks.org/software-testing/how-much-does-istqb-certification-cost/)).
- **Purchasing trigger:** enrollment in a certification course — the sandbox itself would likely be free (per concept design, 15/17's Duolingo analogy), monetized indirectly through downstream production-tool adoption, not through the sandbox itself.
- **Verdict:** **FACT-supported market exists, but the concept as designed generates no direct revenue.** This is the one concept in the set that is explicitly a funnel/acquisition play, not a monetization play — its "willingness to pay" question is really "will free-tier users convert to paid production users later," which is unverifiable from secondary research and requires cohort-tracking data this discovery process cannot produce.

## #14 — Evidence-bundle API for GRC/QMS platforms

- **Buyer:** compliance/security leadership (CISO, Head of Compliance) who already buys GRC software — a genuinely different buyer than the QA-focused concepts above.
- **Budget source:** security/compliance budget, entirely separate from QA tooling budget — this is real, meaningful diversification, not a rebadged QA sale.
- **Pricing benchmark:** strongest quantitative evidence in this set. Companies spend **$45,000–$120,000/year total** on SOC 2 compliance (platform + consulting + audit); Vanta alone ranges **$10,000–$80,000+/year**, Drata **$7,500–$100,000+/year** ([soc2auditors.org](https://soc2auditors.org/insights/soc-2-software-pricing-comparison/), [datavirtualizer.com](https://datavirtualizer.com/content/vanta-vs-drata-soc2-compliance-automation-pricing/)). This establishes the buyer's budget is real, large, and already being spent on adjacent evidence-collection tooling.
- **Purchasing trigger:** audit season, or a failed/costly manual evidence-assembly cycle — directly evidenced by Vanta's own "cuts audit prep by 82%" and "companies overspend by $14,400/year choosing the wrong platform" claims (found this turn), which imply the buyer is actively cost- and time-sensitive around this exact activity.
- **Verdict:** **Strongest quantitative willingness-to-pay evidence of the six — but for the wrong product.** The evidence proves the *buyer* spends heavily on evidence-collection software; it does not prove this buyer would pay *this product* (a test-management tool) for a *feed into* their existing GRC platform, versus expecting that feed for free as a standard integration (the way Vanta/Drata integrate with hundreds of tools already, per 12, generally at no extra charge to the GRC customer). **This is the single most important gap to close with a real conversation before investing here** — confirms 20's flagged partner-dependency risk from the revenue side, not just the technical-integration side.

## #19 — Agent-governance framing for security/platform buyers

- **Buyer:** security/platform engineering leadership evaluating AI agent governance specifically — confirmed as a distinct, fast-growing budget category this session.
- **Budget source:** security/platform budget, not QA — genuine diversification, same category of evidence strength as #14.
- **Pricing benchmark:** **Gartner projects global AI governance platform spending at $492M in 2026, surpassing $1B by 2030**; broader agentic AI spending projected at **$201.9B in 2026** ([softwarestrategiesblog.com, citing Gartner](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/)). Named competing platforms in this space (OneTrust, IBM's agentic control plane, Microsoft Agent 365) are enterprise-tier, custom-quoted products — this is high-budget, deep-pocketed buyer territory.
- **Purchasing trigger:** organizations spending **under 15% of AI budget on governance/risk are significantly more likely to experience agent-related incidents** (found this turn) — a fear-driven, incident-avoidance trigger, a strong and well-evidenced purchase motivator in security categories generally.
- **Verdict:** **Second-strongest quantitative evidence after #14, but the largest category-fit risk (per 20).** The budget is real and growing fast; the open question isn't "does this buyer pay for governance," it's "would this buyer consider a test-management tool's RBAC layer a credible governance product at all" against purpose-built competitors like OneTrust/IBM/Microsoft, who this buyer already evaluates and who this product has never been compared against.

## #13 — Auditor/consultant partner program (distribution, evaluated separately per 21)

- **Not a product the end customer pays for directly** — it's a channel. Willingness-to-pay evidence here is really "willingness of consultants/auditors to refer clients in exchange for compensation," evidenced structurally by Vanta's own formal partner program with a dedicated console and referral relationships ([Vanta for Auditors](https://www.vanta.com/partners/auditors)). **Verdict: proven channel mechanic exists in an adjacent industry; not evidence of payment for this product specifically, evidence that the channel itself is a viable, precedented distribution structure.**

## Ranked by willingness-to-pay evidence strength

| Rank | Concept | Evidence strength | Core gap to close |
|---|---|---|---|
| 1 | #14 Evidence-bundle API | Strong (buyer budget proven) | Partner willingness to integrate, unproven |
| 2 | #19 Agent-governance framing | Strong (buyer budget proven) | Category credibility against purpose-built competitors, unproven |
| 3 | #2 BYO-LLM generation | Moderate (AI-as-feature payment proven) | Self-hosted premium/discount vs. cloud AI, unpriced |
| 4 | #1 MCP-native | Weak-moderate (feature exists, bundled free elsewhere) | Whether it drives purchase or is just expected/free |
| 5 | #10 Policy-as-code governance | Weak (precedent in adjacent category only) | No evidence this specific capability is ever purchased in testing |
| — | #12 ISTQB sandbox | N/A (not a monetization concept) | Funnel-conversion rate, unmeasurable from secondary research |

## Insight

**INSIGHT:** The two strongest concepts by willingness-to-pay evidence (#14, #19) are exactly the two that scored highest in 19 and were flagged with the most serious open questions in 20 — **the pattern across this entire discovery set is consistent: the highest-value opportunities are also the ones most dependent on validating something outside this product's direct control** (a GRC platform's partnership decision, a security buyer's category perception). **RECOMMENDATION:** before any MVP-scoping decision, run direct conversations on exactly these two open questions — (a) would Vanta/Drata/a mid-size QMS vendor accept a third-party test-evidence integration, and (b) would a security/platform buyer seriously evaluate a test-management-rooted product against OneTrust/IBM/Microsoft for agent governance — because both are answerable with a handful of outreach conversations, not a build cycle, and both could independently kill or validate the two highest-scoring concepts in this entire discovery process.

## Sources
- [soc2auditors.org — SOC 2 Software Pricing Comparison 2026](https://soc2auditors.org/insights/soc-2-software-pricing-comparison/)
- [datavirtualizer.com — Vanta vs Drata Pricing 2026](https://datavirtualizer.com/content/vanta-vs-drata-soc2-compliance-automation-pricing/)
- [ASTQB — ISTQB exam pricing](https://astqb.org/istqb-faqs/what-is-the-price-of-an-istqb-exam/), [AT*SQA — Pricing FAQ](https://atsqa.org/pricing-faq)
- [thepricer.org — ISTQB Certification Cost](https://www.thepricer.org/how-much-does-istqb-certification-cost/)
- [GeeksforGeeks — ISTQB Certification Cost](https://www.geeksforgeeks.org/software-testing/how-much-does-istqb-certification-cost/)
- [env0 — Terraform Cloud Pricing 2026](https://www.env0.com/insights/terraform-cloud-pricing-in-2026), [Spacelift — Terraform Cloud Pricing](https://spacelift.io/blog/terraform-cloud-pricing)
- [softwarestrategiesblog.com — Information Security Spending 2026 (Gartner)](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/)
- [Vanta for Auditors](https://www.vanta.com/partners/auditors)
- [03](03-customer-pain.md), [06](06-ai-mcp-landscape.md), [12](12-alternative-industries.md), [19](19-blue-ocean-score.md), [20](20-strategic-fit.md), [21](21-competition-test.md)

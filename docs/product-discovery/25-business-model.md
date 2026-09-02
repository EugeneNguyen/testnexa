# 25 — Business Model

**Note on numbering:** requested as "23 — Business Model," renumbered to 25. See [00-overview.md](00-overview.md) for the full index.

Three viable models for the winning concept (23), each drawing on a specific precedent already validated in 17's cross-industry research — not invented from scratch. All revenue figures below are **benchmarks from comparable businesses, not projections for this product** — clearly a different evidentiary status, kept separate throughout.

## Model A — Open-core + support subscription (Red Hat / GitLab pattern)

**Mechanism:** core product (traceability, execution, MCP server, BYO-LLM generation) is free, open source, and self-hosted forever. Revenue comes from support/SLA subscriptions, managed hosting, and enterprise auth (SSO/SAML/LDAP) — never from gating the AI or traceability features the target segment needs most (directly avoids the trust risk Squash TM's premium paywall creates, per 04/16 assumption #10).

- **Customer:** same QA/platform buyer as 24; budget = existing tooling budget.
- **Pricing:** benchmarked against Kiwi TCMS's own published tiers — $25–$2,000/month depending on support level (01, 04) — likely similar range for a comparable-maturity product.
- **Revenue potential:** proven pattern at scale (Red Hat, GitLab), but per-customer revenue is capped by what a support relationship is worth, not by usage or value delivered.
- **Acquisition cost:** low — self-serve OSS download/community funnel, no outbound sales required for the free tier.
- **Margins:** high once support infrastructure exists (software has near-zero marginal cost), but support/SLA delivery has a real, headcount-linked cost floor that scales with customer count.
- **Scalability:** scales with community size and support team headcount — a lower ceiling than usage-based models unless a managed-hosting attach rate is strong.

## Model B — Usage-based AI/execution metering (Sentry / n8n pattern)

**Mechanism:** core product free and self-hosted, same as Model A; billing is metered by AI-generation volume (and/or test-execution volume) even in self-hosted deployments, via a license-key-gated usage-reporting mechanism (n8n's model, 17) — directly implementing concept #8 from 15 (usage-based self-hosted pricing), which 03 identified as eliminating the industry's #1 cited pain (seat-cost scaling unrelated to actual usage).

- **Customer:** same buyer; budget = tooling budget, but cost now scales with actual AI/testing activity, not headcount.
- **Pricing:** e.g., free tier up to N AI generations/month, metered pricing beyond that. No directly comparable self-hosted-AI-metering benchmark was found; Qase's consumption-based Agentic Mode (06, 22) confirms the category accepts consumption pricing for AI generation specifically, which is the closest available proxy.
- **Revenue potential:** higher ceiling than Model A — revenue grows in proportion to usage/value delivered, not a flat support fee, and captures expansion revenue naturally as a customer's AI usage grows.
- **Acquisition cost:** similar low/self-serve funnel to Model A, with a stronger net-revenue-retention profile because usage (and therefore spend) grows within existing accounts without a renegotiation.
- **Margins:** slightly lower than Model A if the vendor operates real-time metering/license-check infrastructure, but still high since the customer's own infrastructure absorbs the actual compute cost (BYO-LLM keeps LLM inference cost off this product's books entirely — a meaningful structural margin advantage over SaaS AI competitors who must pay for the inference themselves).
- **Scalability:** strong — grows with each customer's own usage, without a proportional increase in this product's support burden.

## Model C — Evidence/API B2B2B layer (deferred, tied to concept #14)

**Mechanism:** Models A/B remain the core QA-buyer offering; a separate, later, paid "Evidence Connector" tier is sold to compliance/GRC-adjacent buyers, monetizing the export/integration layer distinctly from the core tool — explicitly the demoted-from-winner concept #14 (23), retained here as a *business-model* option rather than the product wedge, per 20/22's shared recommendation to validate partner willingness before building it.

- **Customer:** two distinct buyers — QA (low-cost/free core, Model A or B) and compliance/security (paid connector) — real budget diversification, not a rebadged QA sale.
- **Pricing:** benchmarked against the buyer's existing GRC spend — SOC 2 compliance software runs $10,000–$80,000+/year (Vanta) and $7,500–$100,000+/year (Drata) per company (22) — even a modest fraction of that captured per connector deal would be large relative to per-seat QA pricing.
- **Revenue potential:** highest ceiling of the three *if* the unresolved partner-dependency risk (20, 22) resolves favorably — explicitly the least de-risked of the three models.
- **Acquisition cost:** high — requires an enterprise/BD-style partnership motion to land GRC-platform integrations, not a self-serve funnel; a materially different cost structure than Models A/B.
- **Margins:** potentially very high per deal, but revenue is concentrated and lumpy (few large partners) rather than distributed across many self-serve customers.
- **Scalability:** capped by the number of viable GRC/QMS partners willing to integrate — not a community-scalable model like A/B.

## Comparison table

| Dimension | A. Support subscription | B. Usage-based metering | C. B2B2B evidence connector |
|---|---|---|---|
| Customer | QA/platform buyer | QA/platform buyer | QA buyer + compliance/GRC buyer |
| Pricing benchmark | $25–$2,000/mo (Kiwi TCMS analog) | Consumption-based (Qase Agentic Mode analog) | $10K–$100K+/yr (Vanta/Drata analog) |
| Revenue potential | Moderate, capped by support value | Higher, grows with usage | Highest, but unvalidated |
| Acquisition cost | Low, self-serve | Low, self-serve | High, BD/partnership-led |
| Margins | High, headcount-linked floor | High, LLM cost stays on customer infra | Very high per deal, concentrated |
| Scalability | Moderate (support headcount) | Strong (usage-driven) | Weak (partner-count-capped) |
| De-risked today? | Yes — proven pattern (Red Hat/GitLab) | Yes — proven pattern (Sentry/n8n), partial category proxy (Qase) | No — explicit open dependency (20, 22) |

## Recommendation

**RECOMMENDATION:** lead with **Model B (usage-based metering)** as the primary near-term model — it aligns naturally with the winning concept's AI-consumption shape, directly eliminates the single most-cited industry pain (03 #1) rather than reproducing it in a new form, and requires no unproven external dependency. Layer **Model A (support subscription)** underneath as the near-term revenue floor for customers who want a flat, predictable cost and an SLA — a low-risk, well-proven pattern that can ship alongside B without conflict. **Defer Model C** explicitly until the partner-willingness question flagged in 20/22 is answered through direct outreach — not abandoned, sequenced as an expansion bet once the core product has traction and a real conversation has de-risked it.

## Sources
- [01](01-market-map.md), [03](03-customer-pain.md), [04](04-current-solutions.md), [06](06-ai-mcp-landscape.md), [15](15-blue-ocean-concepts.md), [17](17-cross-industry-inspiration.md), [20](20-strategic-fit.md), [22](22-willingness-to-pay.md), [23](23-winner.md)

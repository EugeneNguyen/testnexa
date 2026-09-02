# 17 — Cross-Industry Inspiration

**Note on numbering:** requested as "15 — Cross-Industry Inspiration," renumbered to 17. See [00-overview.md](00-overview.md) for the full index.

10 business models from unrelated industries (all self-hosted/open-source-adjacent infrastructure or B2B SaaS, chosen because they've each solved a monetization or distribution problem this idea also faces — not because they're testing-industry peers), with the specific transferable mechanism named for each.

## 1. Red Hat — subscription-for-support, not for software

**Model:** software itself is open and free; revenue comes entirely from subscriptions covering updates, security patches, professional support, and training — a predictable recurring-revenue business built without ever charging for the core product ([Red Hat business model overview](https://giftsandentertainment.roche.com/open-outlook/red-hats-open-source-business-model-a-deep-dive-1767648557)).
**Transferable mechanism:** decouples "is the compliance/traceability feature free" from "does the business make money" — directly solves the trust problem Squash TM's premium paywall creates for the exact regulated segment this idea targets (03/04). Maps to concept #9 (15).

## 2. Sentry — usage-based dual pricing, self-hosted-free / cloud-metered

**Model:** core is open source (FSL license) and free to self-host with no per-event cost; the hosted cloud product prices by event volume (errors, transactions, replays) rather than seats, with a generous free tier (5K errors/month) ([Vendr](https://www.vendr.com/marketplace/sentry), [Last9](https://last9.io/blog/sentry-pricing/)). Self-hosting becomes the rational choice specifically above ~500K–1M events/month with in-house DevOps capacity.
**Transferable mechanism:** pricing tied to actual usage (test executions run, AI generations consumed) instead of headcount directly eliminates the #1 cited industry pain (03) — and Sentry's own documented crossover point ("self-host once you're big enough to justify the ops cost") is a reusable heuristic for when to recommend self-hosted vs. a future hosted tier of this product. Maps to concept #8 (15).

## 3. GitLab — open-core with a hard rule: never move a free feature behind a paywall

**Model:** MIT-licensed Community Edition; paid Premium/Ultimate tiers add security, compliance, and advanced collaboration features — but GitLab's explicit policy is that features already in the free tier never get moved to a paid one, regardless of who built them ([GitLab Handbook — tiers](https://handbook.gitlab.com/handbook/marketing/brand-and-product-marketing/product-and-solution-marketing/tiers)).
**Transferable mechanism:** the "never retroactively paywall" policy is a trust mechanism specifically relevant to a self-hosted, standards-compliance-focused product — a regulated buyer building a multi-year deployment around this tool needs confidence that the traceability features they rely on won't later be pulled into a paid tier. Worth adopting as an explicit, published policy, not just a practice.

## 4. HashiCorp Sentinel — governance-as-a-paid-layer on top of a free open-source core

**Model:** Terraform/Vault/Consul/Nomad cores are open source; Sentinel (policy-as-code governance — encode and enforce organizational rules automatically) is exclusively an enterprise-tier feature layered on top ([HashiCorp — Sentinel](https://www.hashicorp.com/en/sentinel)).
**Transferable mechanism:** governance/policy enforcement (concept #10, 15 — "every P0 requirement needs 2 test cases with a documented technique") is a legitimate, precedented place to draw the free/paid line — it's an organizational-control feature valuable specifically to larger, more process-mature buyers, unlike core traceability which the target regulated-mid-market segment needs regardless of size.

## 5. n8n — "fair-code," self-hosted-first, pay only for team/org features

**Model:** Community Edition is free to self-host with unlimited workflows, executions, and users under a Fair Code license; paid Business/Enterprise tiers add SSO, environments, projects, and external secrets management — capabilities that only matter once an organization, not an individual, is running it ([n8n docs](https://docs.n8n.io/deploy/host-n8n/community-edition-features), [Codimite](https://codimite.ai/n8n/n8n-community-vs-enterprise/)).
**Transferable mechanism:** the free/paid line drawn at "individual/small-team usage is unlimited and free; organizational features (SSO, multi-tenant governance) are what you pay for" maps almost exactly onto the 07 ERD's `Organization`/`AuthIdentity`/RBAC layer — validates that layer as a sensible monetization boundary, not just a technical one.

## 6. Elastic — core security free, advanced security paid (with a documented reversal)

**Model:** X-Pack originally bundled security as a paid add-on; backlash led Elastic to make *core* security features (TLS, RBAC, basic auth) free in 2019, while advanced features (SSO, LDAP/AD integration, field-level security) remain paid ([Elastic Blog](https://www.elastic.co/blog/security-for-elasticsearch-is-now-free)).
**Transferable mechanism:** a cautionary, evidence-based lesson rather than a pattern to copy directly — gating *core* trust/security features produces backlash strong enough that a major vendor reversed course publicly. Reinforces industry-assumption #10 (16): don't paywall the traceability/compliance features the target segment needs most; paywall advanced governance/SSO/support instead, matching HashiCorp's line (#4 above), not Elastic's original one.

## 7. Vanta — auditor and consultant partner network as a distribution channel

**Model:** a formal partner program connecting Vanta with compliance consultants, contract auditors, and service providers, who refer clients and manage multi-client accounts through a dedicated partner console — audit prep time cut by up to 50% for clients coming through this channel ([Vanta for Auditors](https://www.vanta.com/partners/auditors), [Vanta Service Provider Program](https://www.vanta.com/partners/service-providers)).
**Transferable mechanism:** directly maps onto the multi-org `OrgMembership` design already in the 07 ERD — a consultant/auditor who manages traceability for multiple regulated clients through one login is both a technical use case *and*, per Vanta's proof, a genuine distribution channel (referral/rev-share) worth building deliberately rather than treating as an edge case. Maps to concept #13 (15).

## 8. Duolingo — free certification-adjacent product as a funnel into paid usage

**Model:** the core app is free and monetized separately (subscriptions, ads); the Duolingo English Test is a distinct paid certification product priced far below incumbent exams ($49 vs. up to $200), built on top of the same free-user base and brand trust ([FourWeekMBA](https://fourweekmba.com/how-does-duolingo-make-money/), [Umbrex](https://umbrex.com/resources/company-profiles/duolingo/)).
**Transferable mechanism:** a free ISTQB technique-practice sandbox (concept #12, 15) aimed at exam candidates isn't just goodwill — it's a funnel: today's free-tier trainee is next year's hire who already knows this tool's terminology and UI when their new employer is choosing between it and a competitor. The certification-adjacent free product *is* the acquisition strategy, not a side project.

## 9. Zapier / GitHub Marketplace — third-party connector ecosystem as a growth engine

**Model:** Zapier grew from a utility into "an ecosystem unto itself" by opening a developer platform in 2012, now supporting 8,000+ third-party app integrations built largely by others, not just Zapier itself ([Sacra](https://sacra.com/c/zapier/)); GitHub Marketplace similarly lets third parties publish and monetize integrations directly into the core platform.
**Transferable mechanism:** a community connector marketplace (concept #11, 15) for automation frameworks (beyond the official Playwright/Cypress/pytest/Robot Framework set Kiwi TCMS ships, per 06) and QMS/GRC export targets turns integration coverage into a crowd-scaled asset instead of a permanent vendor engineering backlog — directly addresses the risk that a small team can't out-integrate TestRail/Xray's much larger engineering organizations.

## 10. Plausible Analytics — self-hosted-core / cloud-full-feature, privacy as the explicit wedge

**Model:** Community Edition is free, self-hosted, AGPL-licensed, and covers core analytics only; the paid cloud product (from $9/month) adds funnels, GA4 import, and team SSO, explicitly marketed around EU-only data processing and privacy as the differentiator against Google Analytics ([Plausible GitHub](https://github.com/plausible/analytics), [Plausible self-hosted page](https://plausible.io/self-hosted-web-analytics)).
**Transferable mechanism:** Plausible's positioning — self-hosting isn't a downgrade path, it's the *primary* trust argument, with cloud as the convenience upsell rather than the "real" product — is the exact positioning this idea needs against SaaS-only competitors (Qase, TestRail Cloud, Xray/Zephyr). It also validates a specific product-tier split: core traceability/execution free and self-hosted forever, advanced convenience features (managed hosting, SSO, premium AI capacity) as the paid layer — consistent with #4/#5 above, and directly counter to #6's cautionary lesson.

## Insight

**INSIGHT:** Eight of ten models (all but #6 and #8) independently converge on the same free/paid boundary: **core functionality that the target segment needs to trust the product (security, traceability, core features) stays free; organizational/convenience/governance features (SSO, multi-tenant admin, managed hosting, policy enforcement, advanced support) are what's monetized.** This is a strong, cross-validated pattern for the eventual business-model doc (not yet produced) — not a novel insight invented here, but a genuinely converging signal across unrelated industries, which is exactly what this kind of research is supposed to surface.

## Sources
- [Red Hat business model](https://giftsandentertainment.roche.com/open-outlook/red-hats-open-source-business-model-a-deep-dive-1767648557)
- [Vendr — Sentry Pricing](https://www.vendr.com/marketplace/sentry), [Last9 — Sentry Pricing 2026](https://last9.io/blog/sentry-pricing/)
- [GitLab Handbook — tiers](https://handbook.gitlab.com/handbook/marketing/brand-and-product-marketing/product-and-solution-marketing/tiers)
- [HashiCorp — Sentinel](https://www.hashicorp.com/en/sentinel)
- [n8n docs — Community Edition features](https://docs.n8n.io/deploy/host-n8n/community-edition-features), [Codimite — n8n Community vs Enterprise](https://codimite.ai/n8n/n8n-community-vs-enterprise/)
- [Elastic Blog — Security for Elasticsearch is now free](https://www.elastic.co/blog/security-for-elasticsearch-is-now-free)
- [Vanta for Auditors](https://www.vanta.com/partners/auditors), [Vanta Service Provider Program](https://www.vanta.com/partners/service-providers)
- [FourWeekMBA — How Duolingo Makes Money](https://fourweekmba.com/how-does-duolingo-make-money/), [Umbrex — Duolingo Strategy](https://umbrex.com/resources/company-profiles/duolingo/)
- [Sacra — Zapier](https://sacra.com/c/zapier/)
- [Plausible — GitHub](https://github.com/plausible/analytics), [Plausible — Self-hosted](https://plausible.io/self-hosted-web-analytics)

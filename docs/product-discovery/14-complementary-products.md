# 14 — Complementary Products, Services, and Stakeholders

**Note on numbering:** requested as "12 — Complementary Products," renumbered to 14. See [00-overview.md](00-overview.md) for the full index.

Products, services, processes, and stakeholders that surround the customer's actual experience of getting testing verified and evidenced — beyond the test management tool itself — and where friction between them creates opportunity.

## The ecosystem map

| Category | Examples | Relationship to the customer experience |
|---|---|---|
| Requirements/PM tools (upstream) | Jira, Linear, Azure Boards, GitHub Issues | Source of `Requirement` content (07 ERD); where the work is defined before testing begins |
| Source control & CI/CD (parallel) | GitHub Actions, GitLab CI, Jenkins | Source of automated `TestExecution` results; where Playwright/Cypress/pytest/Robot Framework runs actually happen (06) |
| Bug/defect trackers (parallel, often same tool as PM) | Jira, Bugzilla, Redmine, GitHub Issues, GitLab Issues | Destination for `Defect` records raised from failed executions |
| Identity/SSO providers | Okta, Azure AD, Google Workspace, LDAP | Source of `AuthIdentity` (07 ERD); how users actually log in in a self-hosted deployment |
| Wikis/knowledge tools | Confluence, Notion | Where test plans/evidence often live *ad hoc* today, in the absence of (or alongside) a dedicated tool — direct overlap with 12's "generic knowledge tools" alternative-industry finding |
| Regulated QMS platforms (downstream) | Greenlight Guru, MasterControl | Consumer of the traceability matrix for regulatory submission — the QMS layer sits *above* the test tool in a medical-device workflow (12) |
| GRC/continuous-compliance platforms (downstream) | Vanta, Drata, Secureframe | Consumer of "was this control/requirement tested" evidence for SOC 2/ISO 27001 audits (12) |
| E-signature/approval platforms | DocuSign, PandaDoc | Could formalize the `Approval` entity's rigor beyond a plain timestamp (12) |
| AI coding-agent platforms / IDEs | Claude Code, Cursor, GitHub Copilot, ChatGPT (via MCP) | Increasingly a primary *actor*, not just an integration — the entity that creates/executes test artifacts through the MCP server (06, 07 `AIAgent`) |
| Monitoring/observability tools | Datadog, Sentry, New Relic | Source of production incidents that, in a mature traceability model, should be linkable back to "was there a test that should have caught this" — **not currently modeled in 07's ERD, flagged below as a gap** |

## Friction points and opportunities

1. **Requirement duplication/drift between the PM tool and the test tool.** Most competitors studied (04/05) offer one-directional import (pull a Jira ticket in as a `Requirement`) rather than genuine two-way sync — requirement text changes in Jira silently go stale in the test tool. **Opportunity:** a real two-way sync connector, not just an importer, closing a gap every competitor in 05 currently leaves open.

2. **Test evidence scattered across wiki, spreadsheet, test tool, and QMS/GRC platform with no single source of truth.** Directly connects to 12's GRC/QMS findings — Vanta/Drata and Greenlight Guru both solve *their* half of this by centralizing evidence, but neither ingests test-execution evidence *from* a test management tool automatically today (no integration path found in this research). **Opportunity:** an exportable "evidence bundle" shaped to match what GRC/QMS platforms expect as input (API-first, not just a PDF report) — turns this product into a source-of-truth *feeder* for the downstream compliance stack, rather than one more disconnected system an auditor has to manually cross-reference.

3. **Approval records lack e-signature-grade rigor.** Per 12's alternative-industry analysis — the current `Approval` entity (07) is a plain timestamped row, below the non-repudiation bar DocuSign-class tools set as the ambient buyer expectation for "this specific person approved this specific thing." **Opportunity, deferred:** worth strengthening only once the regulated beachhead (03/04/11) is confirmed as the real buyer — not worth the complexity for a generalist Agile buyer.

4. **SSO/identity fragmentation across self-hosted deployments.** Every org self-hosting this product will run its own mix of LDAP/OIDC/SAML/local accounts — already anticipated by the multi-provider `AuthIdentity` design (07), called out here to confirm it isn't scope creep, it's a real, named integration surface (Kiwi TCMS already supports LDAP/OAuth, per 01/04, confirming this is expected table-stakes for the self-hosted segment specifically, not gold-plating).

5. **AI agents currently do verification work entirely outside any test management tool**, inside the IDE (12's AI-coding-platform finding). **Opportunity:** MCP as the friction-remover — this is the third place in this discovery set (after 06 and 09) this exact point has surfaced, now from the "surrounding ecosystem" angle rather than the "competitor" or "canvas" angle. Three-times-triangulated is about as confident as secondary research can get without primary interviews.

6. **Production incidents aren't linked back to test coverage gaps.** Not evidenced by direct customer complaint in this research — this is an **ASSUMPTION/opportunity flag**, not a validated finding — but it's a logical extension of the traceability model (07): if a production bug (surfaced via Datadog/Sentry) maps back to "no test case covered this," that's a powerful, automatic argument for *why* testing investment matters, and currently no competitor studied closes that loop. Worth a scoping conversation for a v2 `IncidentLink` entity, not MVP (07's ERD doesn't currently include it — flagged here as a gap in that design, not a retroactive edit to 07).

## Insight

**INSIGHT:** The complementary-product map reinforces, rather than adds, most of the earlier findings — which is itself useful confirmation that the discovery set is internally consistent rather than accumulating contradictory signals. The one genuinely new finding here is #2 and #6: this product's real distribution/retention lever may not be "replace the test tool teams already have," but "become the evidence source the GRC/QMS layer above it needs" — a B2B2B positioning (sell into QA, but design the export/integration layer to satisfy the compliance stakeholder who never directly evaluates test management tools, per 11's Tier 3 unexplored-noncustomer finding). That's a distribution insight as much as a product one, and should carry into the eventual go-to-market/business-model discussion (not yet produced in this discovery set).

## Sources
- [06 — AI & MCP Landscape](06-ai-mcp-landscape.md)
- [07 — Conceptual ERD](07-erd-draft.md)
- [11 — Noncustomers](11-noncustomers.md)
- [12 — Alternative Industries](12-alternative-industries.md)
- [01 — Market Map](01-market-map.md), [04 — Current Solutions](04-current-solutions.md)

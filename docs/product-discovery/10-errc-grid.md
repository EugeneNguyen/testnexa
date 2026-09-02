# 10 — ERRC Grid (Eliminate–Reduce–Raise–Create)

**Note on numbering:** requested as "08 — ERRC Grid," renumbered to 10. See [00-overview.md](00-overview.md) for the full index.

Built directly on the strategy canvas's dominant pattern (09): a "sea of sameness" on table-stakes factors, plus two genuine trade-offs (self-hosting vs. AI/MCP; traceability vs. ease-of-use) that no incumbent has resolved. The ERRC grid's job is to force a value-curve decision, not just list nice features — every item below should make the offering *less* competitive on some factor in exchange for being *categorically* different on others. **All items are RECOMMENDATIONS/HYPOTHESES pending MVP-scoping and validation — not commitments.**

## Eliminate

Factors the industry competes on that add cost/complexity without corresponding customer value, and that this idea should refuse to compete on at all:

- **Per-seat SaaS pricing coupled to an unrelated tool's license tier.** The single most-cited structural pain (03 #1) — Xray/Zephyr pricing tied to Jira user count regardless of who actually tests. Self-hosted + open-core eliminates this by design; there is no seat-metering mechanism to build.
- **Vendor support/billing systems as separate, disconnected experiences.** Named TestRail pain (03 #5). An open-source project has no billing system to disconnect from support in the first place — eliminated structurally, not through engineering effort.
- **The false binary "self-hosted OR AI-capable."** Every competitor studied treats these as mutually exclusive (09). This idea eliminates the assumption itself, not a feature — BYO-LLM/local-model support means self-hosting and AI generation stop being opposing choices.
- **Free-text, unauditable "role" fields.** Already eliminated in the 07 ERD design (RoleAssignment replaces `User.role` as free text) — carried here as a named principle, not just a schema detail.

## Reduce

Factors worth offering, but at deliberately lower investment than the heaviest incumbents, because the evidence says the extra depth isn't what wins the target segment:

- **Operational/deployment complexity relative to full enterprise ALM suites** (Jama, Polarion). Regulated mid-market buyers are underserved *because* the only traceability-capable options are either Squash TM (heavier than Kiwi TCMS, per 04/05) or a six-figure ALM suite — reduce setup/operational burden below both, without matching their full feature breadth (a deliberate scope cut, not a shortcut).
- **Mandatory rigor for teams that don't want it.** Making `TestCondition` optional (07 ERD open question #1) is a "reduce," not an "eliminate" — the CTFL-aligned layer stays available, just not forced on every team from day one. Reduces adoption friction for the generalist Agile segment without abandoning the compliance segment's needs.
- **Feature-breadth-for-its-own-sake.** The strategy canvas (09) shows five competitors converging on similar mid-range scores across Integrations/Reporting/RBAC — chasing parity on all of these is exactly the "sea of sameness" Blue Ocean strategy warns against. Match table stakes, don't try to win them.

## Raise

Factors the industry already values, but underinvests in relative to how much customers say they care (03, 08):

- **Self-hosted data control and residency guarantees**, raised above every SaaS competitor and above Kiwi TCMS/Squash TM's baseline self-hosting (which don't specifically address AI-data-flow concerns, since neither has AI) — explicit BYO-LLM/local-inference guarantees so "self-hosted" also covers AI features, not just the core CRUD app.
- **Traceability depth**, raised to Squash TM's level (test-condition-level linkage, structured entry/exit criteria) but delivered without Squash TM's ease-of-use penalty (09) — the specific trade-off the canvas shows nobody has broken.
- **Audit-readiness as a checkable property**, not a claim — append-only test log (07 ERD), structured `Approval` records restricted to human actors, RTM generation on demand. Raised above every competitor studied, none of which evidence this level of audit-trail rigor.
- **RBAC granularity spanning org and project scope, for both human and AI actors** — raised above the generic RBAC every competitor offers (08 #10), specifically to answer the emerging "what is this agent allowed to do" question that no competitor's RBAC model was built to answer (07 ERD).

## Create

Factors the industry has not offered at all — genuine new value, not a better version of an existing one:

- **First-party MCP server + BYO-LLM AI test generation that runs entirely within the customer's infrastructure.** The single clearest whitespace found across 06 and 09 — no competitor (commercial or open-source) combines self-hosting with first-party agent-native AI. This is the category's actual blue-ocean move, not an incremental feature.
- **Dual-standard native data model (ISTQB CTFL v4.0.1 vocabulary + IEEE 829/ISO 29119-3 document structure) in one schema**, rather than as an export template bolted onto a generic tool. Validated as absent everywhere, including Squash TM (04/05, and the direct terminology check this session).
- **Human/AI-agent accountability as a sellable trust feature, not an internal implementation detail.** `Actor`-based provenance, policy-enforced human-only approvals, and scoped agent roles (07 ERD) turn "can an AI agent break our audit trail?" from a buyer's fear into an answerable, structural "no" — a marketing-legible answer no competitor currently offers because none of them have first-party agent access to begin with.
- **A first-class, buyer-facing `auditor` role**: read-only access plus one-click RTM/evidence export, explicitly designed for the *external* auditor persona (03 pain #10, 12 Complementary Products), not just internal QA roles. No competitor studied markets a role built specifically for this stakeholder.

## Insight

**INSIGHT:** Nearly every "Create" item traces back to the same root capability — a data model and integration layer built for both human and AI actors, running entirely inside the customer's infrastructure, natively speaking two standards other tools treat as afterthoughts. That's a coherent value innovation, not a feature list — which is the actual test of whether an ERRC grid is doing its job (per Blue Ocean discipline, a good grid produces one clear differentiated story, not four independent wish-lists). Whether this coherent story is something a *definable, reachable, paying* customer segment actually wants is still unproven — that's the job of 11 (Noncustomers) and the eventual value-proposition/MVP docs, not this one.

## Sources
- [08 — Industry Factors](08-industry-factors.md)
- [09 — Strategy Canvas](09-strategy-canvas.md)
- [07 — Conceptual ERD](07-erd-draft.md)
- [03 — Customer Pain](03-customer-pain.md)
- [06 — AI & MCP Landscape](06-ai-mcp-landscape.md)

# User Stories — Governance (Approval, RiskItem, Attachment)

**Date:** 2026-09-03
**Feature area:** Approval, RiskItem, Attachment
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

---

## Story GOV-1: Approve a test plan (human-only)

**As** Marcus (regulated compliance QA manager), holding the `test_manager` role,
**I want** to record a formal Approval of a TestPlan (who, when),
**so that** the plan's IEEE 829 "Approvals" section has a real sign-off record, not a verbal okay (07's IEEE 829 mapping table).

**Acceptance criteria:**
- Given a TestPlan in `draft` status, when a user with `test_plan.approve` permission (never an `AIAgent` — see RBAC-5) submits an Approval, then an Approval row is created (`approved_by_user_id`, `approved_at`) and the TestPlan transitions to `approved`.
- Given an attempt to create an Approval where the actor resolves to an `AIAgent`, then the request is rejected with 403 regardless of any `RoleAssignment` (RBAC-5's enforcement, exercised here).
- An approved TestPlan can later transition to `superseded` when a new version is approved, but the original Approval record is never deleted (audit trail).

---

## Story GOV-2: Track risk items against a requirement or plan

**As** Marcus,
**I want** to record RiskItems (description, likelihood, impact, mitigation) against a Requirement or a TestPlan,
**so that** "Software Risk Issues" (an IEEE 829 Test Plan section) are tracked as structured data, answerable in the same traceability view as everything else, not a separate spreadsheet.

**Acceptance criteria:**
- Given a Requirement or a TestPlan, when a user with `risk_item.create` permission adds a RiskItem, then it's linked to that Requirement and/or TestPlan and listed on both detail views.
- RiskItem's `likelihood`/`impact` fields are structured (enum: low/medium/high, or equivalent), not free text, so risk can be filtered/sorted, not just read one at a time.

---

## Story GOV-3: Attach supporting files to a test case

**As** Priya (self-hosted OSS QA lead),
**I want** to attach a file (screenshot, log excerpt, spec document) to a TestCase,
**so that** context that doesn't fit in a text field (a screenshot of expected UI state, for example) travels with the test case instead of living in a separate chat thread.

**Acceptance criteria:**
- Given a TestCase, when a user with `test_case.update` permission uploads a file, then an Attachment row (url_or_path, mime_type) is created and linked to that TestCase.
- Attachments are stored on the self-hosted deployment's own filesystem/volume (or an S3-compatible endpoint the operator configures) — never routed through a third-party SaaS storage service by default, consistent with the self-hosting property this whole product is positioned on (03 #9, business case).
- File size/type limits are enforced server-side (configurable, sane defaults) to prevent unbounded storage growth on a self-hosted deployment with no elastic storage guarantee.

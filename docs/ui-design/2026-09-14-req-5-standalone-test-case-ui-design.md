# UI Design Document — REQ-5 Standalone TestCase Authoring

**Date:** 2026-09-14
**Owner:** xuanbinh91@gmail.com (CTO)
**Story:** REQ-5, [ADR-0068](../adr/0068-req-5-standalone-test-case-with-optional-requirement-link.md)
**Sources:** [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md), [ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md) (project-scope entity nav — the sidebar entry this story finally makes functional), [ADR-0055](../adr/0055-admin-3-backend-driven-entity-schema.md) (backend-driven entity schema — why no frontend field-shape change is needed here), [ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md) (the `EntityFormPage`-conditional-section precedent this story's "Link to Requirement" action follows)

## Scope

No new screen and no new route. Two existing surfaces change behavior:

1. **`EntityListPage`/`EntityFormPage` at `/projects/:projectId/admin/test-cases`** — already reachable via the project-mode sidebar's "Test cases" nav item (ADR-0051), and already schema-driven off `GET /entities/{resource}/schema` (ADR-0055) — starts rendering a working list + "New Test Case" create form the moment the backend's `_TEST_CASE_CONFIG` registers `list`+`create` (ADR-0068). No frontend code changes the rendering logic; the generic surface picks up the new methods automatically from the schema response, exactly the mechanism ADR-0055 exists to provide.
2. **`EntityFormPage`'s `test-case` edit page** (the same page the EXEC-3 "Defects" section already conditionally added onto, per that ADR's own precedent for a single-entity addition to the otherwise-generic edit page) gains one new conditional action, **"Link to Requirement"**, visible only when the loaded `TestCase` has no existing Requirement traceability (`test_condition_id` is `null` **and** `GET`-ing the case's own traceability shows no `RequirementTestCaseLink`).

## Screen 1 — generic-admin `test-cases` list + create (no new markup, behavior-only change)

Before this story: loading `/projects/:projectId/admin/test-cases` shows `EntityListPage`'s existing "Listing is not available for this entity" empty state (`canList` derives `false` from the schema response's `methods`).

After this story: the schema response's `methods` now includes `list`+`create`, so the page renders the standard generic table (columns per `field_meta`'s `show_in_table` — same derivation every other entity already uses) and a "New Test Case" button opening the standard generic create form (fields: Title, Preconditions, Expected result, Status, Test level, Test type — the same `field_order` `_TEST_CASE_CONFIG` already declares, `project_id` supplied implicitly from the route's own `:projectId`, never a form field the user fills in — same convention `TestSuite`'s own create form already uses for its `project_id`).

No new component, no new `data-testid` beyond what `EntityListPage`/`EntityFormPage`/`EntityTable` already emit generically for every entity — this screen's "design" is entirely the pre-existing generic-admin template, unlocked.

## Screen 2 — `EntityFormPage`'s `test-case` edit page — new conditional "Link to Requirement" action

```
┌─────────────────────────────────────────────┐
│  Edit Test Case                              │
│                                               │
│  Title            [___________________]     │
│  Preconditions    [___________________]     │
│  Expected result  [___________________]     │
│  Status           [draft ▾]                  │
│  Test level       [Component Testing ▾]      │
│  Test type        [Functional Testing ▾]     │
│                                               │
│  ── Requirement (only when unlinked) ──      │
│  This test case has no Requirement.          │
│  [ Link to Requirement ]                     │
│                                               │
│  ── Defects (EXEC-3, unaffected) ──          │
│  ...                                         │
│                                               │
│  [ Save ]  [ Cancel ]                        │
└─────────────────────────────────────────────┘
```

**"Link to Requirement" button** opens a small modal — a single `FkAutocomplete`-style Requirement picker (same primitive `TestStep`'s own `test_case_id` picker and `TestCycleDetail`'s "Record Result" `test_case_id` picker already use, scoped to the current project) + a "Link" submit button, calling `POST /test-cases/{id}/link-requirement`.

**States:**
- Case has `test_condition_id` set, or an existing `RequirementTestCaseLink` — section renders as "Linked to Requirement: {requirement title}" (a plain read-only line, no action), not the "Link to Requirement" button. No unlink control (out of scope, ADR-0068 Decision §5).
- Case is standalone (`project_id` set, no link) — section renders the "This test case has no Requirement" text + button, as sketched above.
- Successful link → toast, section switches to the "Linked to Requirement" read-only state without a full page reload (re-fetch the case's own traceability).
- `422` (cross-project Requirement picked) → inline form error on the picker field.
- `409` (already linked — a race, e.g. two tabs) → toast, section re-fetches and switches to the read-only state, same "reconcile with server state rather than trust local state" posture every other retrofit-shaped action in this codebase already takes.

## Accessibility

No new pattern beyond what this codebase's existing modals/pickers already establish (root `CLAUDE.md`'s design-system section: `role="alert"` on the toast/error, real `<label>` on the picker, focus returns to the "Link to Requirement" button on modal close). The generic list/create screen (Screen 1) inherits `EntityTable`/`EntityListPage`'s existing accessible markup verbatim — nothing new to verify there beyond the existing generic-surface test suite already covering.

## Out of scope (explicit, ADR-0068 Decision §5)

No unlink action. No "Link to TestCondition" retrofit (Requirement only). No new dedicated `TestCasesPage` — Screen 1 is the pre-existing generic-admin surface, not a new bespoke page (CTO scope decision, this story).

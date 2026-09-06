/**
 * `TestExecution` (backend/app/api/routes/execution.py
 * `_TEST_EXECUTION_CONFIG`, backend/app/schemas/execution.py). Full CRUD,
 * added by ADR-0025 (previously had zero routes at all).
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** the
 * real `scope_field` is `test_cycle_id`, not `project_id`. Uses a
 * scope-selector against `TestCycle`.
 *
 * `executed_at` is a `datetime`, not a plain `date` — the field-type enum
 * (UI Design Document §3) only has `"date"` (native `CFormInput
 * type="date"`, which truncates time-of-day). Rendered as `type: "string"`
 * instead so a full ISO-8601 datetime can round-trip losslessly; the same
 * choice applies to every other `datetime` column across these configs
 * (`TestLog.logged_at`, the 4 link tables' `created_at`, etc.).
 * `test_case_id` autocompletes against `TestCase`, which currently has no
 * list route — see `test-case.ts`'s own docstring.
 */
import { EntityConfig } from "./types";

const testExecution: EntityConfig = {
  resource: "test_execution",
  path: "/test-executions",
  scopeField: "test_cycle_id",
  scopeSelector: { refEntity: "test-cycle", paramName: "test_cycle_id" },
  methods: ["list", "get", "create", "update", "delete"],
  filterFields: ["test_case_id", "result"],
  fields: [
    { name: "test_cycle_id", label: "Test cycle", type: "fk", refEntity: "test-cycle", labelField: "name", required: true },
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", required: true },
    { name: "result", label: "Result", type: "enum", values: ["pass", "fail", "blocked", "skipped"], required: true },
    { name: "actual_result", label: "Actual result", type: "string", showInTable: false },
    { name: "executed_at", label: "Executed at", type: "string", required: true },
  ],
};

export default testExecution;

/**
 * `TestStep` (backend/app/api/routes/assets.py `_TEST_STEP_CONFIG`,
 * backend/app/schemas/assets.py). Full CRUD.
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** the
 * real `scope_field` is `test_case_id`, not `project_id`. Uses a
 * scope-selector against `TestCase` — see `test-case.ts`'s own docstring for
 * why that selector's search can't resolve against a live backend today
 * (no `TestCase` list route exists).
 *
 * `sequence` is an integer column; the field-type enum (UI Design Document
 * §3) has no numeric type, so it's rendered as `type: "string"` (a plain
 * text input) — the same approximation `attachment.ts`'s `size_bytes` uses.
 */
import { EntityConfig } from "./types";

const testStep: EntityConfig = {
  resource: "test_step",
  path: "/test-steps",
  scopeField: "test_case_id",
  scopeSelector: { refEntity: "test-case", paramName: "test_case_id" },
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", required: true },
    { name: "sequence", label: "Sequence", type: "string", required: true },
    { name: "action", label: "Action", type: "string", required: true },
    { name: "expected_result", label: "Expected result", type: "string" },
  ],
};

export default testStep;

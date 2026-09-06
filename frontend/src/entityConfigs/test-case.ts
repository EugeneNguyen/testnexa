/**
 * `TestCase` (backend/app/api/routes/assets.py `_TEST_CASE_CONFIG`,
 * backend/app/schemas/assets.py). `methods = {"get", "update", "delete"}` —
 * no `create` (reserved for a future bespoke atomic-create route) **and no
 * `list` at all**: `TestCase` has no single non-nullable FK the factory's
 * `scope_field` mechanism could require as a list-scope query param (see
 * that module's own docstring). This is a real, structural gap, not an
 * oversight in this config — `EntityListPage`/`EntityTable` render a
 * "listing not available" state for any config whose `methods` omits
 * `"list"` rather than calling an endpoint that doesn't exist.
 *
 * Consequence flagged for the story's final report: `FkAutocomplete`
 * instances targeting `refEntity: "test-case"` (`TestStep`'s scope-selector,
 * `Attachment`'s scope-selector, `TestExecution.test_case_id`,
 * `TestCaseDefectLink.test_case_id`, `TestConditionTestCaseLink.test_case_id`,
 * `RequirementTestCaseLink.test_case_id`) cannot resolve a live `?q=` search
 * against a real backend today — there is no `GET /test-cases` route to
 * call. The component code is generic and correct; it will start working
 * the moment a `TestCase` list route exists.
 */
import { EntityConfig } from "./types";

const testCase: EntityConfig = {
  resource: "test_case",
  path: "/test-cases",
  methods: ["get", "update", "delete"],
  filterFields: ["status", "test_level_id", "test_type_id"],
  searchFields: ["title", "preconditions", "expected_result"],
  fields: [
    { name: "test_condition_id", label: "Test condition", type: "fk", refEntity: "test-condition", labelField: "description" },
    { name: "test_level_id", label: "Test level", type: "fk", refEntity: "test-level", labelField: "name" },
    { name: "test_type_id", label: "Test type", type: "fk", refEntity: "test-type", labelField: "name" },
    { name: "title", label: "Title", type: "string", required: true },
    { name: "preconditions", label: "Preconditions", type: "string", showInTable: false },
    { name: "expected_result", label: "Expected result", type: "string", showInTable: false },
    { name: "status", label: "Status", type: "enum", values: ["draft", "reviewed", "approved", "deprecated"], required: true },
  ],
};

export default testCase;

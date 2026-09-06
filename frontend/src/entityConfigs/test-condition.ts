/**
 * `TestCondition` (backend/app/api/routes/assets.py `_TEST_CONDITION_CONFIG`,
 * backend/app/schemas/assets.py). `methods = {"list","get","update","delete"}`
 * — **no `create`** (ADR-0028): the factory's `POST /test-conditions` only
 * ever wrote the `TestCondition` row, never the required
 * `RequirementTestConditionLink` row, so it was removed in favour of the
 * bespoke atomic-create route `POST /requirements/{id}/test-conditions`
 * (REQ-3, surfaced inline on `ProjectDetail`, not on the generic admin
 * surface). This array mirrors the backend's `CrudEntityConfig.methods` 1:1;
 * re-adding `"create"` here would render a "New" button calling a route that
 * no longer accepts POST. Same posture as `test-case.ts`'s own exclusion.
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** the
 * real `scope_field` is `requirement_id`, not `project_id` — no route lists
 * `TestCondition` by project. Uses a scope-selector against `Requirement`.
 */
import { EntityConfig } from "./types";

const testCondition: EntityConfig = {
  resource: "test_condition",
  path: "/test-conditions",
  scopeField: "requirement_id",
  scopeSelector: { refEntity: "requirement", paramName: "requirement_id" },
  methods: ["list", "get", "update", "delete"],
  fields: [
    { name: "requirement_id", label: "Requirement", type: "fk", refEntity: "requirement", labelField: "description", required: true },
    { name: "description", label: "Description", type: "string", required: true },
    { name: "priority", label: "Priority", type: "enum", values: ["low", "medium", "high"], required: true },
  ],
};

export default testCondition;

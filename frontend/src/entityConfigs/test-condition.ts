/**
 * `TestCondition` (backend/app/api/routes/assets.py `_TEST_CONDITION_CONFIG`,
 * backend/app/schemas/assets.py). Full CRUD.
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
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "requirement_id", label: "Requirement", type: "fk", refEntity: "requirement", labelField: "description", required: true },
    { name: "description", label: "Description", type: "string", required: true },
    { name: "priority", label: "Priority", type: "enum", values: ["low", "medium", "high"], required: true },
  ],
};

export default testCondition;

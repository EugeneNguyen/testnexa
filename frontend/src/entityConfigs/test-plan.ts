/**
 * `TestPlan` (backend/app/api/routes/planning.py `_TEST_PLAN_CONFIG`,
 * backend/app/schemas/planning.py). Full CRUD, direct project scope (§4
 * shape B, real `scope_field` is "project_id" — matches). `created_by_actor_id`
 * is factory-auto-stamped (`_ACTOR_STAMPED_FIELDS`), never client-supplied —
 * omitted from `fields[]` entirely (no `User`/`AIAgent` ref entity exists on
 * this surface to autocomplete against anyway, ADR-0025).
 */
import { EntityConfig } from "./types";

const testPlan: EntityConfig = {
  resource: "test_plan",
  path: "/test-plans",
  scopeField: "project_id",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true },
    { name: "identifier", label: "Identifier", type: "string", required: true },
    { name: "scope", label: "Scope", type: "string", showInTable: false },
    { name: "approach", label: "Approach", type: "string", showInTable: false },
    { name: "staffing_and_training", label: "Staffing & training", type: "string", showInTable: false },
    { name: "schedule", label: "Schedule", type: "string", showInTable: false },
    { name: "status", label: "Status", type: "enum", values: ["draft", "approved", "superseded"], required: true },
  ],
};

export default testPlan;

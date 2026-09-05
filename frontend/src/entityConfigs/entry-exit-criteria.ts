/**
 * `EntryExitCriteria` (backend/app/api/routes/planning.py
 * `_ENTRY_EXIT_CRITERIA_CONFIG`, backend/app/schemas/planning.py). Full CRUD.
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** the
 * Sitemap lists this entity under the project-scoped "plain" table (§4 shape
 * B — list fires immediately with `?project_id=:projectId`). The real
 * backend `scope_field` is `test_plan_id`, not `project_id` — there is no
 * route that lists `EntryExitCriteria` by project at all. This config uses a
 * scope-selector (§4 shape C's own mechanism, generalized per
 * `entityConfigs/types.ts`'s module doc comment) against `TestPlan` instead
 * of a plain project-scoped list.
 */
import { EntityConfig } from "./types";

const entryExitCriteria: EntityConfig = {
  resource: "entry_exit_criteria",
  path: "/entry-exit-criteria",
  scopeField: "test_plan_id",
  scopeSelector: { refEntity: "test-plan", paramName: "test_plan_id" },
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "test_plan_id", label: "Test plan", type: "fk", refEntity: "test-plan", labelField: "identifier", required: true },
    { name: "type", label: "Type", type: "enum", values: ["entry", "exit", "suspension", "resumption"], required: true },
    { name: "condition_text", label: "Condition", type: "string", required: true },
  ],
};

export default entryExitCriteria;

/**
 * `TestCycle` (backend/app/api/routes/planning.py `_TEST_CYCLE_CONFIG`,
 * backend/app/schemas/planning.py). No `create` (FR-PLAN-3's own scope, not
 * built by this pass — matches the Sitemap/ADR-0025 note).
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** same
 * shape as `entry-exit-criteria.ts` — the real `scope_field` is
 * `test_plan_id`, not `project_id`, so this uses a scope-selector against
 * `TestPlan` rather than a plain project-scoped list.
 */
import { EntityConfig } from "./types";

const testCycle: EntityConfig = {
  resource: "test_cycle",
  path: "/test-cycles",
  scopeField: "test_plan_id",
  scopeSelector: { refEntity: "test-plan", paramName: "test_plan_id" },
  methods: ["list", "get", "update", "delete"],
  fields: [
    { name: "test_plan_id", label: "Test plan", type: "fk", refEntity: "test-plan", labelField: "identifier", readOnly: true },
    { name: "release_id", label: "Release", type: "fk", refEntity: "release", labelField: "version_label", readOnly: true },
    { name: "environment_id", label: "Environment", type: "fk", refEntity: "environment", labelField: "name" },
    { name: "name", label: "Name", type: "string" },
    { name: "start_date", label: "Start date", type: "date" },
    { name: "end_date", label: "End date", type: "date" },
  ],
};

export default testCycle;

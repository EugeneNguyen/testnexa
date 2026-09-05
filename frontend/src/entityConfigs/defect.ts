/**
 * `Defect` (backend/app/api/routes/execution.py `_DEFECT_CONFIG`,
 * backend/app/schemas/execution.py). No `create` (reserved for a future
 * bespoke `POST /executions/{id}/defects` route).
 *
 * **Deviation from the Sitemap's "plain" classification, flagged here:** the
 * real `scope_field` is `test_execution_id`, not `project_id`. Uses a
 * scope-selector against `TestExecution`.
 *
 * `status` is a plain `str` on the backend (`UpdateDefectRequest.status:
 * str | None`), not a `Literal` enum like `severity` — rendered as
 * `type: "string"`, not `"enum"`, matching the real schema exactly.
 */
import { EntityConfig } from "./types";

const defect: EntityConfig = {
  resource: "defect",
  path: "/defects",
  scopeField: "test_execution_id",
  scopeSelector: { refEntity: "test-execution", paramName: "test_execution_id" },
  methods: ["list", "get", "update", "delete"],
  filterFields: ["severity", "status"],
  searchFields: ["external_ref"],
  fields: [
    { name: "test_execution_id", label: "Test execution", type: "fk", refEntity: "test-execution", labelField: "result", readOnly: true },
    { name: "external_ref", label: "External ref", type: "string" },
    { name: "severity", label: "Severity", type: "enum", values: ["low", "medium", "high", "critical"], required: true },
    { name: "status", label: "Status", type: "string", required: true },
  ],
};

export default defect;

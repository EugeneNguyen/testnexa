/**
 * `TestLog` (backend/app/api/routes/execution.py `_TEST_LOG_CONFIG`,
 * backend/app/schemas/execution.py). `methods = {"list", "get"}` — immutable
 * by schema (no `updated_at` column, ADR-0025); `EntityForm` never mounts
 * for this entity (no `create`/`update` in `methods`).
 *
 * **Deviation from the Sitemap's "plain"-vs-"read-only" note:** the Sitemap
 * marks this "read-only" (correct) but the real `scope_field` is
 * `test_execution_id` — this uses a scope-selector against `TestExecution`,
 * same mechanism as `defect.ts`/`test-execution.ts`.
 *
 * `logged_at` is a `datetime` -> `type: "string"` (see `test-execution.ts`'s
 * docstring). `payload` is a JSON `dict` column — the field-type enum has no
 * object/JSON type, rendered as `type: "string"` (displayed via
 * `JSON.stringify`, `EntityTable`'s own generic string-cell fallback).
 */
import { EntityConfig } from "./types";

const testLog: EntityConfig = {
  resource: "test_log",
  path: "/test-logs",
  scopeField: "test_execution_id",
  scopeSelector: { refEntity: "test-execution", paramName: "test_execution_id" },
  methods: ["list", "get"],
  filterFields: ["event_type"],
  fields: [
    { name: "test_execution_id", label: "Test execution", type: "fk", refEntity: "test-execution", labelField: "result", readOnly: true },
    { name: "logged_at", label: "Logged at", type: "string", readOnly: true },
    { name: "event_type", label: "Event type", type: "enum", values: ["status_change", "comment", "attachment", "agent_action"], readOnly: true },
    { name: "payload", label: "Payload", type: "string", readOnly: true },
  ],
};

export default testLog;

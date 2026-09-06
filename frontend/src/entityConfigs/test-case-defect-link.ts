/**
 * `TestCaseDefectLink` (backend/app/api/routes/trace.py, ADR-0025).
 * `methods = {"list", "get"}`. Scope-selector against `TestCase` — see
 * `test-case.ts`'s own docstring for why that search can't resolve against
 * a live backend today (no `TestCase` list route exists).
 */
import { EntityConfig } from "./types";

const testCaseDefectLink: EntityConfig = {
  resource: "test_case_defect_link",
  path: "/test-case-defect-links",
  scopeField: "test_case_id",
  scopeSelector: { refEntity: "test-case", paramName: "test_case_id" },
  methods: ["list", "get"],
  fields: [
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", readOnly: true },
    { name: "defect_id", label: "Defect", type: "fk", refEntity: "defect", labelField: "external_ref", readOnly: true },
    { name: "created_at", label: "Created at", type: "string", readOnly: true },
  ],
};

export default testCaseDefectLink;

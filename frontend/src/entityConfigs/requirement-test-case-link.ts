/**
 * `RequirementTestCaseLink` (backend/app/api/routes/trace.py, ADR-0025).
 * `methods = {"list", "get"}` — no create/update/delete route exists for any
 * of the 4 link tables at all, generic or bespoke (ADR-0005): a row is only
 * ever created as a side effect of a bespoke route elsewhere. Scope-selector
 * against `Requirement` (the real `scope_field`).
 */
import { EntityConfig } from "./types";

const requirementTestCaseLink: EntityConfig = {
  resource: "requirement_test_case_link",
  path: "/requirement-test-case-links",
  scopeField: "requirement_id",
  scopeSelector: { refEntity: "requirement", paramName: "requirement_id" },
  methods: ["list", "get"],
  fields: [
    { name: "requirement_id", label: "Requirement", type: "fk", refEntity: "requirement", labelField: "description", readOnly: true },
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", readOnly: true },
    { name: "created_at", label: "Created at", type: "string", readOnly: true },
  ],
};

export default requirementTestCaseLink;

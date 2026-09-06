/**
 * `RequirementTestConditionLink` (backend/app/api/routes/trace.py,
 * ADR-0025). `methods = {"list", "get"}`, same read-only-link-table posture
 * as `requirement-test-case-link.ts`. Scope-selector against `Requirement`.
 */
import { EntityConfig } from "./types";

const requirementTestConditionLink: EntityConfig = {
  resource: "requirement_test_condition_link",
  path: "/requirement-test-condition-links",
  scopeField: "requirement_id",
  scopeSelector: { refEntity: "requirement", paramName: "requirement_id" },
  methods: ["list", "get"],
  fields: [
    { name: "requirement_id", label: "Requirement", type: "fk", refEntity: "requirement", labelField: "description", readOnly: true },
    { name: "test_condition_id", label: "Test condition", type: "fk", refEntity: "test-condition", labelField: "description", readOnly: true },
    { name: "created_at", label: "Created at", type: "string", readOnly: true },
  ],
};

export default requirementTestConditionLink;

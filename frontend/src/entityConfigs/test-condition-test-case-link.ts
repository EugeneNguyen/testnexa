/**
 * `TestConditionTestCaseLink` (backend/app/api/routes/trace.py, ADR-0025).
 * `methods = {"list", "get"}`. Scope-selector against `TestCondition` (the
 * real `scope_field`).
 */
import { EntityConfig } from "./types";

const testConditionTestCaseLink: EntityConfig = {
  resource: "test_condition_test_case_link",
  path: "/test-condition-test-case-links",
  scopeField: "test_condition_id",
  scopeSelector: { refEntity: "test-condition", paramName: "test_condition_id" },
  methods: ["list", "get"],
  fields: [
    { name: "test_condition_id", label: "Test condition", type: "fk", refEntity: "test-condition", labelField: "description", readOnly: true },
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", readOnly: true },
    { name: "created_at", label: "Created at", type: "string", readOnly: true },
  ],
};

export default testConditionTestCaseLink;

/**
 * `RiskItem` (backend/app/api/routes/governance.py `_RISK_ITEM_CONFIG`,
 * backend/app/schemas/governance.py). Full CRUD. UI Design Document §4 shape
 * C: a toggle between "by Requirement" / "by TestPlan", then an
 * `FkAutocomplete` against whichever — `scopeSelector` is an array of the
 * two options for exactly this reason (`entityConfigs/types.ts`'s module doc
 * comment, point 2). Both `requirement_id`/`test_plan_id` are nullable on
 * `RiskItemSummary` (exactly one is ever set) — neither is marked
 * `required` in `fields[]` since the "exactly one" rule is enforced by
 * whichever scope-selector option the admin surface's own scope-resolution
 * flow locks in, not by Zod.
 */
import { EntityConfig } from "./types";

const riskItem: EntityConfig = {
  resource: "risk_item",
  path: "/risk-items",
  scopeField: ["requirement_id", "test_plan_id"],
  scopeSelector: [
    { refEntity: "requirement", paramName: "requirement_id", label: "By requirement" },
    { refEntity: "test-plan", paramName: "test_plan_id", label: "By test plan" },
  ],
  methods: ["list", "get", "create", "update", "delete"],
  filterFields: ["likelihood", "impact"],
  fields: [
    { name: "requirement_id", label: "Requirement", type: "fk", refEntity: "requirement", labelField: "description" },
    { name: "test_plan_id", label: "Test plan", type: "fk", refEntity: "test-plan", labelField: "identifier" },
    { name: "description", label: "Description", type: "string", required: true },
    { name: "likelihood", label: "Likelihood", type: "enum", values: ["low", "medium", "high"], required: true },
    { name: "impact", label: "Impact", type: "enum", values: ["low", "medium", "high"], required: true },
    { name: "mitigation", label: "Mitigation", type: "string", showInTable: false },
  ],
};

export default riskItem;

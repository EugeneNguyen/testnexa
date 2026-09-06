/**
 * `TestSuite` (backend/app/api/routes/assets.py `_TEST_SUITE_CONFIG`,
 * backend/app/schemas/assets.py). Full CRUD, direct project scope (§4 shape
 * B — matches the real `scope_field` of "project_id").
 */
import { EntityConfig } from "./types";

const testSuite: EntityConfig = {
  resource: "test_suite",
  path: "/test-suites",
  scopeField: "project_id",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "purpose", label: "Purpose", type: "string" },
  ],
};

export default testSuite;

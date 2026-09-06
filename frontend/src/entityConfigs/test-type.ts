/**
 * `TestType` (backend/app/api/routes/taxonomy.py `_TEST_TYPE_CONFIG`,
 * backend/app/schemas/taxonomy.py). Global catalog, full CRUD (§4 shape A).
 */
import { EntityConfig } from "./types";

const testType: EntityConfig = {
  resource: "test_type",
  path: "/test-types",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [{ name: "name", label: "Name", type: "string", required: true }],
};

export default testType;

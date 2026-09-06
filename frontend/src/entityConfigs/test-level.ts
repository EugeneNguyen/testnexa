/**
 * `TestLevel` (backend/app/api/routes/taxonomy.py `_TEST_LEVEL_CONFIG`,
 * backend/app/schemas/taxonomy.py). Global catalog, full CRUD (§4 shape A).
 */
import { EntityConfig } from "./types";

const testLevel: EntityConfig = {
  resource: "test_level",
  path: "/test-levels",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [{ name: "name", label: "Name", type: "string", required: true }],
};

export default testLevel;

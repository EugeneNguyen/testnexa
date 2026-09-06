/**
 * `Environment` (backend/app/api/routes/planning.py `_ENVIRONMENT_CONFIG`,
 * backend/app/schemas/planning.py). Full CRUD, direct project scope — UI
 * Design Document §4 shape B, and the real `scope_field` ("project_id")
 * matches that shape exactly (no scope-selector needed).
 */
import { EntityConfig } from "./types";

const environment: EntityConfig = {
  resource: "environment",
  path: "/environments",
  scopeField: "project_id",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "config_notes", label: "Config notes", type: "string" },
  ],
};

export default environment;

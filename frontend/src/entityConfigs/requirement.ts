/**
 * `Requirement` (backend/app/api/routes/assets.py `_REQUIREMENT_CONFIG`,
 * backend/app/schemas/assets.py). Full CRUD, direct project scope (§4 shape
 * B — matches the real `scope_field` of "project_id").
 */
import { EntityConfig } from "./types";

const requirement: EntityConfig = {
  resource: "requirement",
  path: "/requirements",
  scopeField: "project_id",
  methods: ["list", "get", "create", "update", "delete"],
  filterFields: ["external_ref"],
  searchFields: ["description", "external_ref", "source"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true },
    { name: "description", label: "Description", type: "string", required: true },
    { name: "external_ref", label: "External ref", type: "string" },
    { name: "source", label: "Source", type: "string" },
  ],
};

export default requirement;

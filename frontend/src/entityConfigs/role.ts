/**
 * `Role` (backend/app/api/routes/rbac_routes.py `_ROLE_CONFIG`,
 * backend/app/schemas/rbac.py). Full CRUD, direct org scope (§4 shape A —
 * `scope_field` is `org_id`, the current `:orgId` route param, no selector
 * needed). `is_system_role` is never client-supplied (absent from both
 * `CreateRoleRequest`/`UpdateRoleRequest`) — table/display only.
 */
import { EntityConfig } from "./types";

const role: EntityConfig = {
  resource: "role",
  path: "/roles",
  scopeField: "org_id",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "org_id", label: "Organization", type: "fk", refEntity: "organization", labelField: "name", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "is_system_role", label: "System role", type: "boolean", readOnly: true },
  ],
};

export default role;

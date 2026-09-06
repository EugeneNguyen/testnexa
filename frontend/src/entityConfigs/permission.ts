/**
 * `Permission` (backend/app/api/routes/rbac_routes.py `_PERMISSION_CONFIG`,
 * backend/app/schemas/rbac.py). `methods = {"list", "get"}` — read-only, the
 * seeded catalog (`app/db/rbac_seed_catalog.py`'s `READ_ONLY_RESOURCES`), no
 * create/update/delete permission code exists for it at all. Global catalog
 * (`scope_field=None`, §4 shape A) — no `EntityForm` ever mounts.
 */
import { EntityConfig } from "./types";

const permission: EntityConfig = {
  resource: "permission",
  path: "/permissions",
  methods: ["list", "get"],
  fields: [
    { name: "code", label: "Code", type: "string", readOnly: true },
    { name: "resource", label: "Resource", type: "string", readOnly: true },
    { name: "action", label: "Action", type: "string", readOnly: true },
  ],
};

export default permission;

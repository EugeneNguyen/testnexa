/**
 * `RoleAssignment` (backend/app/api/routes/rbac_routes.py
 * `_ROLE_ASSIGNMENT_CONFIG`, backend/app/schemas/rbac.py).
 * `methods = {"get", "update", "delete"}` — deliberately no `create`
 * (RBAC-3's own bespoke `POST /orgs/{org_id}/role-assignments`,
 * `lib/api/roleAssignments.ts`/`RoleAssignmentsPanel.tsx`, already owns
 * creation, ADR-0025).
 *
 * **Deviation flagged here:** the Sitemap describes this entity as
 * reachable via "the sidebar's Admin nav group" like every other shape-A
 * entity, implying a working list view — but the factory genuinely
 * registers **no `list` route at all** for `RoleAssignment` (only
 * `get`/`update`/`delete`); RBAC-3's own bespoke
 * `GET /orgs/{org_id}/role-assignments` exists but returns a bare array, a
 * different response envelope than every other generic list route
 * (`{items, total, page, page_size}`), and is already consumed by
 * `RoleAssignmentsPanel.tsx`'s own bespoke UI. Rather than special-case one
 * entity's list-response envelope inside the otherwise-generic `EntityTable`,
 * `methods` here matches the real generic-surface capability exactly
 * (`get`/`update`/`delete`, no `list`) — `EntityListPage` renders its
 * "listing not available" fallback for this entity, same as `organization`/
 * `test-case`. Editing/deleting an existing `RoleAssignment` row is still
 * reachable directly by id (`/orgs/:orgId/admin/role-assignments/:id/edit`);
 * discovering that id happens via `RoleAssignmentsPanel.tsx`'s existing list.
 *
 * `actor_id`/`org_id` have no ref entity to autocomplete against — `User`/
 * `AIAgent` are structurally excluded from this surface entirely
 * (ADR-0025) — rendered as plain read-only strings (the raw id).
 */
import { EntityConfig } from "./types";

const roleAssignment: EntityConfig = {
  resource: "role_assignment",
  path: "/role-assignments",
  scopeField: "org_id",
  methods: ["get", "update", "delete"],
  fields: [
    { name: "actor_id", label: "Actor", type: "string", readOnly: true },
    { name: "org_id", label: "Organization", type: "string", readOnly: true },
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name" },
    { name: "role_id", label: "Role", type: "fk", refEntity: "role", labelField: "name", required: true },
    { name: "created_at", label: "Created at", type: "string", readOnly: true },
  ],
};

export default roleAssignment;

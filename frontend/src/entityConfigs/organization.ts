/**
 * `Organization` (backend/app/api/routes/organizations.py
 * `_ORGANIZATION_CONFIG`, backend/app/schemas/organizations.py).
 * `methods = {"get", "update", "delete"}` — `create` stays `POST /orgs`'s
 * own bespoke route (`OrgHome`/signup bootstrap, never a bare
 * `POST /organizations`).
 *
 * **Deviation flagged here:** the Sitemap lists this as a shape-A entity
 * ("`EntityTable` fires its list query immediately on mount") but the
 * factory genuinely registers **no `list` route at all** for `Organization`
 * — `resolve_organization_org_id`'s own docstring notes "`list` isn't
 * registered either (no FK-based 'immediate parent' scope makes sense for
 * the tenant root itself)". `EntityListPage` renders its "listing not
 * available" fallback for this entity (same posture as `role-assignment`/
 * `test-case`); the single org an admin actually cares about — the one
 * they're currently in — is reachable directly via
 * `/orgs/:orgId/admin/organizations/:orgId/edit` (using the route's own
 * `:orgId` as the row id, since `Organization.id` IS `org_id`).
 */
import { EntityConfig } from "./types";

const organization: EntityConfig = {
  resource: "organization",
  path: "/organizations",
  methods: ["get", "update", "delete"],
  fields: [
    { name: "name", label: "Name", type: "string", required: true },
    { name: "slug", label: "Slug", type: "string", readOnly: true },
    { name: "default_standards_profile", label: "Default standards profile", type: "string" },
  ],
};

export default organization;

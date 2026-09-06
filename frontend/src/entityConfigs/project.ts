/**
 * `Project` (backend/app/api/routes/projects.py: factory `list`/`delete`
 * plus bespoke `get`/`update` at the same `{path}` URL shape,
 * backend/app/schemas/projects.py). `create` stays `POST
 * /orgs/{org_id}/projects`'s own bespoke route (`OrgHome`'s "New Project"
 * modal) — never a bare `POST /projects` (API Document §3 footnote ***).
 *
 * The real `scope_field` is `org_id`, but this entity's admin page lives at
 * `/projects/:projectId/admin/projects` (Sitemap: "coexists with
 * `ProjectDetail` itself") — that route only has a `:projectId` param, no
 * `:orgId`. `scopeResolution` (see `entityConfigs/types.ts`) resolves the
 * scope automatically: fetch the *current* Project (`GET /projects/{id}`,
 * which this same entity's own `get` method already supports) and read its
 * `org_id` off the response — no user-facing picker, unlike `scopeSelector`.
 */
import { EntityConfig } from "./types";

const project: EntityConfig = {
  resource: "project",
  path: "/projects",
  scopeField: "org_id",
  scopeResolution: { fromRouteParam: "projectId", viaEntity: "project", viaField: "org_id" },
  methods: ["list", "get", "update", "delete"],
  fields: [
    { name: "org_id", label: "Organization", type: "fk", refEntity: "organization", labelField: "name", readOnly: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "standards_profile", label: "Standards profile", type: "string" },
  ],
};

export default project;

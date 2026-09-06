/**
 * `Release` (backend/app/api/routes/releases.py, backend/app/schemas/releases.py).
 * 100% bespoke routes — no factory involvement at all (ADR-0025), and unlike
 * `Project`'s bespoke `get`/`update` (which happen to already sit at the
 * generic `{path}/{id}` shape), `Release`'s `create`/`list` are nested under
 * `/projects/{project_id}/releases`, not `/releases` — `listPath`/
 * `createPath` (see `entityConfigs/types.ts`) override the generic
 * convention for exactly this reason.
 *
 * **Deviation flagged here:** the ADR-0025 Decision section describes
 * `Release` as having "full bespoke CRUD" — the real route module
 * (`app/api/routes/releases.py`) only implements `POST`/`GET
 * /projects/{project_id}/releases`, `GET /releases/{id}`, and the audit
 * query `GET /releases/{id}/test-cycles`. **There is no `PATCH`/`DELETE
 * /releases/{id}` route anywhere in the codebase.** `methods` below matches
 * the real, verified route set (`list`, `get`, `create` only) — no
 * update/delete affordance renders for this entity, structurally, not a
 * permission-hidden one.
 */
import { EntityConfig } from "./types";

const release: EntityConfig = {
  resource: "release",
  path: "/releases",
  listPath: "/projects/:projectId/releases",
  createPath: "/projects/:projectId/releases",
  scopeField: "project_id",
  methods: ["list", "get", "create"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true, readOnly: true },
    { name: "version_label", label: "Version label", type: "string", required: true },
    { name: "target_date", label: "Target date", type: "date" },
  ],
};

export default release;

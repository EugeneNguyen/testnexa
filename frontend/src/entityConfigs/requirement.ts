/**
 * `Requirement` (backend/app/api/routes/assets.py `_REQUIREMENT_CONFIG`,
 * backend/app/schemas/assets.py). Full CRUD, direct project scope (§4 shape
 * B — matches the real `scope_field` of "project_id").
 *
 * `title` is required by the backend (ADR-0025) but was missing here —
 * the generic create form had no field for it, so every submission failed
 * `422 validation_error: title Field required`. Found via a live create
 * attempt (frontend/CLAUDE.md's own "entityConfigs can silently drift out
 * of sync with the backend" class of bug), fixed 2026-09-09.
 */
import { EntityConfig } from "./types";

const requirement: EntityConfig = {
  resource: "requirement",
  path: "/requirements",
  scopeField: "project_id",
  methods: ["list", "get", "create", "update", "delete"],
  filterFields: ["external_ref"],
  searchFields: ["title", "description", "external_ref", "source"],
  fields: [
    { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name", required: true },
    { name: "title", label: "Title", type: "string", required: true },
    { name: "description", label: "Description", type: "string", required: true },
    { name: "external_ref", label: "External ref", type: "string" },
    { name: "source", label: "Source", type: "string" },
  ],
};

export default requirement;

/**
 * `TestDesignTechnique` (backend/app/api/routes/taxonomy.py
 * `_TEST_DESIGN_TECHNIQUE_CONFIG`, backend/app/schemas/taxonomy.py). Global
 * catalog — `scope_field=None`, full CRUD, no `OrgMembership` boundary at
 * all (gated by `has_permission_in_any_org`). UI Design Document §4 shape A.
 */
import { EntityConfig } from "./types";

const testDesignTechnique: EntityConfig = {
  resource: "test_design_technique",
  path: "/test-design-techniques",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "name", label: "Name", type: "string", required: true },
    { name: "istqb_chapter_ref", label: "ISTQB chapter ref", type: "string" },
  ],
};

export default testDesignTechnique;

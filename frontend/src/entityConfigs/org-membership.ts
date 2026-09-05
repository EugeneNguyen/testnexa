/**
 * `OrgMembership` (backend/app/api/routes/org_memberships.py
 * `_ORG_MEMBERSHIP_CONFIG`, backend/app/schemas/org_memberships.py).
 * `methods = {"list", "get", "update", "delete"}` — no `create` (would
 * duplicate/bypass `invite_member`'s own `User`/`Invite`-creation
 * mechanics). Direct org scope (§4 shape A — matches real `scope_field`
 * "org_id"). Coexists with the bespoke `OrgMembers.tsx` screen (ADR-0025 §6)
 * — this generic page is the fallback for actions that screen doesn't
 * surface, e.g. deleting a row outright.
 *
 * `user_id` has no ref entity to autocomplete against (`User` is excluded
 * from this surface entirely, ADR-0025) — plain read-only string.
 */
import { EntityConfig } from "./types";

const orgMembership: EntityConfig = {
  resource: "org_membership",
  path: "/org-memberships",
  scopeField: "org_id",
  methods: ["list", "get", "update", "delete"],
  filterFields: ["status"],
  fields: [
    { name: "org_id", label: "Organization", type: "fk", refEntity: "organization", labelField: "name", readOnly: true },
    { name: "user_id", label: "User", type: "string", readOnly: true },
    { name: "status", label: "Status", type: "enum", values: ["invited", "active", "suspended"], required: true },
    { name: "joined_at", label: "Joined at", type: "string", readOnly: true },
  ],
};

export default orgMembership;

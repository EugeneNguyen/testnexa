/**
 * ADR-0025, as narrowed by [ADR-0053]: the `:entity` route-param registry —
 * now **nav and route wiring only**.
 *
 * Until ADR-0053 this file also carried each entity's `EntityConfig` (28
 * static imports, a flat `entityConfigByKey` map, and a singular-alias table
 * for `FkAutocomplete`'s `refEntity` lookups). All of that described an
 * entity's *data shape*, which the backend now owns and serves from
 * `GET /entities/{resource}/schema` — see `useEntitySchema.ts`. What's left
 * here is the half ADR-0053 deliberately kept frontend-static: which entities
 * exist, what they're called in the nav, and which of the two admin route
 * shapes each one lives under.
 *
 * That split is the ADR's own: nav grouping/order/labels are information
 * architecture, and they don't drift the way a field list does — adding a
 * required backend column doesn't imply a nav reshuffle. The `Requirement.title`
 * incident that motivated ADR-0053 was a *field* drifting, never a nav entry.
 *
 * Two things that used to live here and no longer do:
 *
 * - `entityConfigByKey` — replaced by `useEntitySchema(entityKey)`. Every
 *   former reader (`useAdminRouteContext`, `useEntityScope`, `EntityTable`'s
 *   FK-label resolution, `FkAutocomplete`'s ref lookup) now fetches.
 * - The singular->plural alias table (`"project"` -> `"projects"`). The same
 *   problem it solved still exists — `refEntity` values are singular while
 *   route slugs are plural — but it's now solved at the fetch boundary by
 *   `useEntitySchema.ts`'s `resolveEntityKey()`, which uses
 *   `ADMIN_ENTITY_KEYS` below. Kept there rather than here because it's a
 *   property of the *request*, not of the nav.
 *
 * `entityLabelByKey` survives, because the sidebar/breadcrumb need a label
 * before any fetch could resolve — rendering the whole nav would otherwise
 * mean fetching 28 schemas up front. The backend serves an authoritative
 * `label` too (used for page headings, where a fetch has already happened);
 * a Vitest case asserts the two agree, so this copy can't silently drift.
 */

export interface RegistryEntry {
  /** `:entity` route-param value, e.g. "role-assignments". */
  key: string;
  /** Nav-label / page heading. */
  label: string;
}

function entry(label: string, key: string): RegistryEntry {
  return { key, label };
}

/** Sitemap: "Org/global-scoped" table — `/orgs/:orgId/admin/:entity`. */
export const orgScopedEntities: RegistryEntry[] = [
  entry("Roles", "roles"),
  entry("Role assignments", "role-assignments"),
  entry("Permissions", "permissions"),
  entry("Test design techniques", "test-design-techniques"),
  entry("Test levels", "test-levels"),
  entry("Test types", "test-types"),
  entry("Organizations", "organizations"),
  entry("Org memberships", "org-memberships"),
];

/** Sitemap: "Project-scoped" table — `/projects/:projectId/admin/:entity`. */
export const projectScopedEntities: RegistryEntry[] = [
  entry("Environments", "environments"),
  entry("Test plans", "test-plans"),
  entry("Entry/exit criteria", "entry-exit-criteria"),
  entry("Test cycles", "test-cycles"),
  entry("Requirements", "requirements"),
  entry("Test conditions", "test-conditions"),
  entry("Test cases", "test-cases"),
  entry("Test steps", "test-steps"),
  entry("Test suites", "test-suites"),
  entry("Defects", "defects"),
  entry("Test executions", "test-executions"),
  entry("Test logs", "test-logs"),
  entry("Risk items", "risk-items"),
  entry("Attachments", "attachments"),
  entry("Requirement -> test case links", "requirement-test-case-links"),
  entry("Requirement -> test condition links", "requirement-test-condition-links"),
  entry("Test condition -> test case links", "test-condition-test-case-links"),
  entry("Test case -> defect links", "test-case-defect-links"),
  entry("Projects", "projects"),
  entry("Releases", "releases"),
];

export const allEntities: RegistryEntry[] = [...orgScopedEntities, ...projectScopedEntities];

/**
 * Flat `:entity` key -> nav-label map, so page components render the same
 * human-readable label `AppSidebar`/`AppBreadcrumb`/`ProjectDetail` nav
 * generation uses, instead of re-deriving one from the raw route slug (always
 * lowercase and plural, e.g. "requirements" -> "New requirements").
 */
export const entityLabelByKey: Record<string, string> = Object.fromEntries(
  allEntities.map((e) => [e.key, e.label]),
);

/**
 * Every valid `:entity` slug. Used by `useEntitySchema.ts`'s
 * `resolveEntityKey()` to tell a real key from a singular `refEntity` alias
 * *before* pluralizing — `entry-exit-criteria` is the one key that doesn't
 * end in "s", and naive pluralization would turn it into a 404.
 */
export const ADMIN_ENTITY_KEYS: ReadonlySet<string> = new Set(allEntities.map((e) => e.key));

export function isOrgScoped(key: string): boolean {
  return orgScopedEntities.some((e) => e.key === key);
}

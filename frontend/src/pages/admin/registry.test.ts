import { describe, expect, it } from "vitest";
import { ADMIN_ENTITY_KEYS, allEntities, entityLabelByKey, projectScopedEntities } from "./registry";

/**
 * [ADR-0093](../../../docs/adr/0093-retire-test-conditions-standalone-admin-page.md):
 * TC-SHELL-040's registry-absence half. `test-conditions` is retired
 * entirely from the registry, not merely excluded from the sidebar's nav
 * groups — this is a distinct, independently-checkable fact from
 * `PROJECT_ENTITY_GROUPS`'s own child count (see `app-sidebar.test.tsx`'s
 * own TC-SHELL-040 case for that half), since a registry entry could in
 * principle exist while still being excluded from every group (the
 * junction-link entities already do exactly that).
 */
describe("registry.ts — ADR-0093 test-conditions retirement", () => {
  it("`test-conditions` is not a member of projectScopedEntities", () => {
    expect(projectScopedEntities.some((e) => e.key === "test-conditions")).toBe(false);
  });

  it("`test-conditions` is not a member of ADMIN_ENTITY_KEYS (the set useAdminRouteContext's gate reads)", () => {
    expect(ADMIN_ENTITY_KEYS.has("test-conditions")).toBe(false);
  });

  it("`test-conditions` has no entry in entityLabelByKey", () => {
    expect(entityLabelByKey["test-conditions"]).toBeUndefined();
  });

  it("every other project-scoped entity from before this retirement is still present (a targeted removal, not a broader regression)", () => {
    const keys = allEntities.map((e) => e.key);
    for (const stillExpected of [
      "requirements",
      "test-cases",
      "test-suites",
      "requirement-test-condition-links",
      "test-condition-test-case-links",
    ]) {
      expect(keys).toContain(stillExpected);
    }
  });
});

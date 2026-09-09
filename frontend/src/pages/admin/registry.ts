/**
 * ADR-0025: the `:entity` route-param -> `EntityConfig` registry. Two
 * grouped lists (`orgScopedEntities`/`projectScopedEntities`) back
 * `App.tsx`'s route wiring and `AppSidebar`'s/`ProjectDetail`'s nav
 * generation (Sitemap's org/global-scoped vs. project-scoped tables); a
 * flat `entityConfigByKey` map backs `FkAutocomplete`'s `refEntity` lookups,
 * which cross the org/project grouping freely (e.g. `TestStep.test_case_id`
 * autocompletes against `TestCase`, a project-scoped entity, regardless of
 * which group the referencing entity's own page lives in — ADR-0025's own
 * point that an FK's ref entity "doesn't necessarily have its own admin
 * page" on the *same* side of that split).
 *
 * `:entity` keys are each config's own `path` with the leading slash
 * stripped — this is not a coincidence: `backend/app/api/crud_factory.py`'s
 * `_resource_path()` convention (`resource.replace("_", "-") + "s"`, with
 * `entry_exit_criteria` as its one grammatical exception) already produces
 * exactly the slugs the Sitemap names, so reusing `path` here keeps a single
 * source of truth instead of a second, hand-maintained slug list.
 */
import attachment from "../../entityConfigs/attachment";
import defect from "../../entityConfigs/defect";
import entryExitCriteria from "../../entityConfigs/entry-exit-criteria";
import environment from "../../entityConfigs/environment";
import orgMembership from "../../entityConfigs/org-membership";
import organization from "../../entityConfigs/organization";
import permission from "../../entityConfigs/permission";
import project from "../../entityConfigs/project";
import release from "../../entityConfigs/release";
import requirement from "../../entityConfigs/requirement";
import requirementTestCaseLink from "../../entityConfigs/requirement-test-case-link";
import requirementTestConditionLink from "../../entityConfigs/requirement-test-condition-link";
import riskItem from "../../entityConfigs/risk-item";
import role from "../../entityConfigs/role";
import roleAssignment from "../../entityConfigs/role-assignment";
import testCase from "../../entityConfigs/test-case";
import testCaseDefectLink from "../../entityConfigs/test-case-defect-link";
import testCondition from "../../entityConfigs/test-condition";
import testConditionTestCaseLink from "../../entityConfigs/test-condition-test-case-link";
import testCycle from "../../entityConfigs/test-cycle";
import testDesignTechnique from "../../entityConfigs/test-design-technique";
import testExecution from "../../entityConfigs/test-execution";
import testLevel from "../../entityConfigs/test-level";
import testLog from "../../entityConfigs/test-log";
import testPlan from "../../entityConfigs/test-plan";
import testStep from "../../entityConfigs/test-step";
import testSuite from "../../entityConfigs/test-suite";
import testType from "../../entityConfigs/test-type";
import { EntityConfig } from "../../entityConfigs/types";

export interface RegistryEntry {
  /** `:entity` route-param value, e.g. "role-assignments". */
  key: string;
  /** Nav-label / page heading. */
  label: string;
  config: EntityConfig;
}

function entry(label: string, config: EntityConfig): RegistryEntry {
  return { key: config.path.slice(1), label, config };
}

/** Sitemap: "Org/global-scoped" table — `/orgs/:orgId/admin/:entity`. */
export const orgScopedEntities: RegistryEntry[] = [
  entry("Roles", role),
  entry("Role assignments", roleAssignment),
  entry("Permissions", permission),
  entry("Test design techniques", testDesignTechnique),
  entry("Test levels", testLevel),
  entry("Test types", testType),
  entry("Organizations", organization),
  entry("Org memberships", orgMembership),
];

/** Sitemap: "Project-scoped" table — `/projects/:projectId/admin/:entity`. */
export const projectScopedEntities: RegistryEntry[] = [
  entry("Environments", environment),
  entry("Test plans", testPlan),
  entry("Entry/exit criteria", entryExitCriteria),
  entry("Test cycles", testCycle),
  entry("Requirements", requirement),
  entry("Test conditions", testCondition),
  entry("Test cases", testCase),
  entry("Test steps", testStep),
  entry("Test suites", testSuite),
  entry("Defects", defect),
  entry("Test executions", testExecution),
  entry("Test logs", testLog),
  entry("Risk items", riskItem),
  entry("Attachments", attachment),
  entry("Requirement -> test case links", requirementTestCaseLink),
  entry("Requirement -> test condition links", requirementTestConditionLink),
  entry("Test condition -> test case links", testConditionTestCaseLink),
  entry("Test case -> defect links", testCaseDefectLink),
  entry("Projects", project),
  entry("Releases", release),
];

export const allEntities: RegistryEntry[] = [...orgScopedEntities, ...projectScopedEntities];

/** Flat `:entity` key -> `EntityConfig` map, for both page routing and `FkAutocomplete` ref lookups. */
export const entityConfigByKey: Record<string, EntityConfig> = Object.fromEntries(
  allEntities.map((e) => [e.key, e.config]),
);

/**
 * Flat `:entity` key -> nav-label map, so page components (`EntityListPage`'s
 * heading + "New <label>" modal title) render the same human-readable label
 * `AppSidebar`/`ProjectDetail` nav generation already uses, instead of
 * re-deriving one from the raw route slug (which is always lowercase and
 * plural, e.g. "requirements" -> "New requirements").
 */
export const entityLabelByKey: Record<string, string> = Object.fromEntries(
  allEntities.map((e) => [e.key, e.label]),
);

/**
 * **Bugfix (found writing ADMIN-2 UI E2E coverage):** every `refEntity`
 * value used across every `entityConfigs/*.ts` file's `fields[]`,
 * `scopeSelector`, and `scopeResolution.viaEntity` is the entity's singular
 * noun (`"project"`, `"requirement"`, `"test-case"`, ...) — but this map's
 * own keys above are `key = config.path.slice(1)`, always plural, since
 * every backend route is plural REST (`/projects`, `/requirements`, ...).
 * Before this alias table, every one of those lookups (`FkAutocomplete`'s
 * `entityConfigByKey[refEntity]`, `EntityTable`'s FK-label resolution,
 * `useEntityScope`'s `entityConfigByKey[scopeResolution.viaEntity]`) always
 * returned `undefined`: every FK field's autocomplete was permanently
 * disabled ("Search unavailable for this field") or showed a raw id instead
 * of its label, every `scopeSelector` picker (`RiskItem`, `TestCondition`,
 * `TestCycle`, `EntryExitCriteria`, `Defect`, `TestExecution`, `TestLog`, the
 * 4 link tables, `Attachment`) could never resolve a scope, and `Project`'s
 * own admin page (`scopeResolution.viaEntity: "project"`) could never leave
 * its loading state. Adding a plural-stripped singular alias for every key
 * fixes every one of those lookups without touching the config files
 * themselves — verified by inspection that every `refEntity`/`viaEntity`
 * string actually used in this codebase is a plain "-s" singular of an
 * existing key (no irregular plurals appear in this domain, and no alias
 * collides with a real key: `entry-exit-criteria` is the only key not ending
 * in "s" and is never referenced as a `refEntity` anyway).
 */
for (const entityEntry of allEntities) {
  if (entityEntry.key.endsWith("s")) {
    const singularAlias = entityEntry.key.slice(0, -1);
    if (!(singularAlias in entityConfigByKey)) {
      entityConfigByKey[singularAlias] = entityEntry.config;
    }
  }
}

export function isOrgScoped(key: string): boolean {
  return orgScopedEntities.some((e) => e.key === key);
}

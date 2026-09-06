/**
 * ADR-0025 / UI Design Document §4: resolves the concrete `{field, value}`
 * scope pair `EntityListPage`/`EntityFormPage` need before they can call
 * `listEntities`/`createEntity`, across all three scope shapes plus this
 * story's two documented extensions (`entityConfigs/types.ts`'s module doc
 * comment):
 *
 * - No `scopeField` at all (global catalog, §4 shape A) — always ready,
 *   nothing to resolve.
 * - `scopeResolution` set (`Project` only) — fetched automatically, no user
 *   interaction; "ready" once the fetch resolves.
 * - `scopeSelector` set (§4 shape C, plus this story's generalization of it
 *   to every "plain" entity whose real `scope_field` isn't `project_id`/
 *   `org_id` — see e.g. `entityConfigs/test-condition.ts`) — "ready" only
 *   once the caller has picked something via `ScopeSelector`.
 * - Plain `scopeField` of exactly `"project_id"`/`"org_id"` matching a route
 *   param already in context (§4 shape B, the *narrow* set of entities
 *   where that's actually true — `Environment`/`TestPlan`/`Requirement`/
 *   `TestSuite`/`Role`/`RoleAssignment`/`Permission`/`OrgMembership`) —
 *   ready immediately, value taken straight from the route.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EntityConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { entityConfigByKey } from "./registry";

export interface ResolvedScope {
  ready: boolean;
  field?: string;
  value?: string;
}

export function useEntityScope(
  config: EntityConfig | undefined,
  routeParams: { orgId?: string; projectId?: string },
): { scope: ResolvedScope; onScopeSelectorResolved: (field: string, value: string) => void } {
  const [selector, setSelector] = useState<{ field: string; value: string } | undefined>(undefined);

  const scopeResolution = config?.scopeResolution;
  const viaConfig = scopeResolution ? entityConfigByKey[scopeResolution.viaEntity] : undefined;
  const routeParamValue = scopeResolution ? routeParams[scopeResolution.fromRouteParam] : undefined;

  const resolutionQuery = useQuery({
    queryKey: ["entity-scope-resolution", config?.resource, routeParamValue],
    queryFn: () => getEntity<EntityRow>(viaConfig as EntityConfig, routeParamValue as string),
    enabled: Boolean(scopeResolution) && Boolean(viaConfig) && Boolean(routeParamValue),
  });

  function onScopeSelectorResolved(field: string, value: string) {
    setSelector({ field, value });
  }

  if (!config || !config.scopeField) {
    return { scope: { ready: true }, onScopeSelectorResolved };
  }

  if (scopeResolution) {
    if (!resolutionQuery.data) {
      return { scope: { ready: false }, onScopeSelectorResolved };
    }
    const value = resolutionQuery.data[scopeResolution.viaField];
    return {
      scope: { ready: true, field: scopeResolution.viaField === "org_id" ? "org_id" : (config.scopeField as string), value: String(value) },
      onScopeSelectorResolved,
    };
  }

  if (config.scopeSelector) {
    if (!selector) {
      return { scope: { ready: false }, onScopeSelectorResolved };
    }
    return { scope: { ready: true, field: selector.field, value: selector.value }, onScopeSelectorResolved };
  }

  if (config.scopeField === "project_id" && routeParams.projectId) {
    return { scope: { ready: true, field: "project_id", value: routeParams.projectId }, onScopeSelectorResolved };
  }
  if (config.scopeField === "org_id" && routeParams.orgId) {
    return { scope: { ready: true, field: "org_id", value: routeParams.orgId }, onScopeSelectorResolved };
  }

  return { scope: { ready: false }, onScopeSelectorResolved };
}

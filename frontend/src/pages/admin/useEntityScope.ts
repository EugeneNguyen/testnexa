/**
 * ADR-0025 / UI Design Document §4: resolves the concrete `{field, value}`
 * scope pair `EntityListPage`/`EntityFormPage` need before they can call
 * `listEntities`/`createEntity`, across all three scope shapes plus this
 * story's two documented extensions (`entityConfigs/types.ts`'s module doc
 * comment):
 *
 * - No `scopeField` at all (global catalog, §4 shape A) — always ready,
 *   nothing to resolve.
 * - Plain `scopeField` of exactly `"project_id"`/`"org_id"` matching a route
 *   param already in context (§4 shape B, the *narrow* set of entities
 *   where that's actually true — `Environment`/`TestPlan`/`Requirement`/
 *   `TestSuite`/`Role`/`RoleAssignment`/`Permission`/`OrgMembership`, plus
 *   `Project` itself on its two org-scoped routes since ADR-0060) — ready
 *   immediately, value taken straight from the route. **Checked before
 *   `scopeResolution` below**, not after (ADR-0060 fix — see that ADR) —
 *   an entity can have both a `scopeResolution` (for one of its routes)
 *   and a route context where the plain field is already present (for
 *   another of its routes); the fast, no-fetch path must win whenever it
 *   genuinely can, or a `scopeResolution` declared for one route silently
 *   disables scope resolution entirely on the entity's other routes.
 * - `scopeResolution` set (`Project` only, on its project-scoped
 *   generic-admin route specifically — the *only* remaining route where
 *   `org_id` isn't already directly available) — fetched automatically, no
 *   user interaction; "ready" once the fetch resolves.
 * - `scopeSelector` set (§4 shape C, plus this story's generalization of it
 *   to every "plain" entity whose real `scope_field` isn't `project_id`/
 *   `org_id` — see e.g. `entityConfigs/test-condition.ts`) — "ready" only
 *   once the caller has picked something via `ScopeSelector`.
 *
 * **ADR-0053:** the `scopeResolution` branch's "via" config (the entity whose
 * row carries the value we need — `Project`, today's only case) is fetched via
 * `useEntitySchema` instead of the deleted `entityConfigByKey` map. Two things
 * to keep in mind when editing this file:
 *
 * - `useEntitySchema` is a **hook**, so it is called unconditionally at the
 *   top, before any of the early `return`s below. It tolerates an `undefined`
 *   key (no fetch, no config) — that is what makes the unconditional call
 *   legal for the entities that have no `scopeResolution` at all.
 * - `scopeResolution.viaEntity` is **singular** (`"project"`), while schema
 *   keys are the plural route slugs; `useEntitySchema`'s own
 *   `resolveEntityKey()` does that mapping, so it is passed through as-is.
 *
 * Behavior is unchanged: while the via-entity's schema is in flight the
 * resolution query stays disabled, so `scope.ready` is `false` — exactly the
 * state this branch already produced while the Project row itself was loading.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EntityConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { useEntitySchema } from "./useEntitySchema";

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
  // Unconditional hook call — see this file's own docstring. `undefined` key
  // (no `scopeResolution`) means no fetch and no config, not a skipped hook.
  const { config: viaConfig } = useEntitySchema(scopeResolution?.viaEntity);
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

  // ADR-0060: this direct-from-route-params check now runs BEFORE
  // `scopeResolution` below, not after — see this file's own module
  // docstring for why. A route that already carries `:orgId`/`:projectId`
  // directly should never pay for the extra fetch, even when the entity's
  // config *also* declares a `scopeResolution` for a DIFFERENT route shape
  // (`Project`'s is for its project-scoped generic-admin path specifically —
  // it doesn't stop applying just because another of Project's routes
  // doesn't need it).
  if (config.scopeField === "project_id" && routeParams.projectId) {
    return { scope: { ready: true, field: "project_id", value: routeParams.projectId }, onScopeSelectorResolved };
  }
  if (config.scopeField === "org_id" && routeParams.orgId) {
    return { scope: { ready: true, field: "org_id", value: routeParams.orgId }, onScopeSelectorResolved };
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

  return { scope: { ready: false }, onScopeSelectorResolved };
}

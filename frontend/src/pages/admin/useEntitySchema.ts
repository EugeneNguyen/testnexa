/**
 * ADR-0053: fetch-an-entity's-shape-at-runtime, replacing the static
 * `entityConfigByKey[entityKey]` lookup every admin surface used to do.
 *
 * Returns a plain `EntityConfig` — the exact type `EntityTable`/`EntityForm`/
 * `FkAutocomplete`/`useEntityScope` already consume — assembled from the
 * fetched schema plus the frontend-static route wiring in
 * `entityConfigs/overrides.ts`. Keeping the assembled shape identical to the
 * old hand-written one is deliberate: it confines this migration's blast
 * radius to "where does the config come from", not "what does a config look
 * like", so none of the downstream components needed rewriting around a new
 * type.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { EntityConfig } from "../../entityConfigs/types";
import { EntitySchemaResponse, getEntitySchema } from "../../lib/api/entitySchema";
import { ROUTE_OVERRIDES, STATIC_ENTITY_CONFIGS, pathFor } from "../../entityConfigs/overrides";
import { ADMIN_ENTITY_KEYS } from "./registry";

/**
 * An entity's schema changes on deploy, never during a session — and a
 * frontend deploy forces a reload, which builds a fresh QueryClient anyway.
 * So there is no window in which a refetch could observe a newer schema than
 * the bundle that's asking for it; refetching would be pure latency.
 */
const SCHEMA_STALE_TIME = Infinity;

/**
 * `refEntity` values are singular (`"project"`, `"test-case"`) while route
 * slugs — and this route's own `{resource}` param — are plural
 * (`"projects"`, `"test-cases"`). `registry.ts` has carried a singular-alias
 * map for exactly this since ADMIN-2; this is the same fix at the fetch
 * boundary, so a bad singular never becomes a 404'd request.
 *
 * Membership is checked BEFORE pluralizing so a real key that doesn't end in
 * "s" survives — `entry-exit-criteria` is the one such key, and naive
 * pluralization would turn it into `entry-exit-criterias`.
 */
export function resolveEntityKey(key: string): string {
  if (ADMIN_ENTITY_KEYS.has(key)) {
    return key;
  }
  const plural = `${key}s`;
  return ADMIN_ENTITY_KEYS.has(plural) ? plural : key;
}

/** Merge a fetched schema with the frontend-static route wiring. */
export function toEntityConfig(key: string, schema: EntitySchemaResponse): EntityConfig {
  return {
    resource: schema.resource,
    path: pathFor(key),
    ...ROUTE_OVERRIDES[key],
    methods: schema.methods,
    fields: schema.fields,
    ...(schema.scopeField !== null ? { scopeField: schema.scopeField } : {}),
    ...(schema.scopeSelector !== null ? { scopeSelector: schema.scopeSelector } : {}),
    ...(schema.scopeResolution !== null ? { scopeResolution: schema.scopeResolution } : {}),
    searchFields: schema.searchFields,
    filterFields: schema.filterFields,
  };
}

export interface EntitySchemaResult {
  config: EntityConfig | undefined;
  /** The entity's own backend-declared nav/heading label. */
  label: string | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useEntitySchema(entityKey: string | undefined): EntitySchemaResult {
  const key = entityKey ? resolveEntityKey(entityKey) : undefined;
  // `Release` has no backend CrudEntityConfig to derive from — see
  // `entityConfigs/overrides.ts` note 3. Served statically, never fetched.
  const staticConfig = key ? STATIC_ENTITY_CONFIGS[key] : undefined;

  const query = useQuery({
    queryKey: ["entity-schema", key],
    queryFn: () => getEntitySchema(key as string),
    enabled: Boolean(key) && !staticConfig,
    staleTime: SCHEMA_STALE_TIME,
  });

  const config = useMemo(() => {
    if (staticConfig) {
      return staticConfig;
    }
    return query.data && key ? toEntityConfig(key, query.data) : undefined;
  }, [staticConfig, query.data, key]);

  return {
    config,
    label: staticConfig ? undefined : query.data?.label,
    isLoading: Boolean(key) && !staticConfig && query.isLoading,
    isError: query.isError,
  };
}

/**
 * Batch sibling of `useEntitySchema`, for a caller that needs an unknown
 * number of configs at once and therefore cannot call the single hook in a
 * loop (`EntityTable` resolves one ref-entity config per FK column, and the
 * column list is data, not a fixed shape — the Rules of Hooks make a
 * per-column `useEntitySchema` illegal).
 */
export function useEntitySchemas(entityKeys: string[]): Record<string, EntityConfig> {
  const keys = useMemo(() => Array.from(new Set(entityKeys.map(resolveEntityKey))), [entityKeys]);

  const results = useQueries({
    queries: keys.map((key) => ({
      queryKey: ["entity-schema", key],
      queryFn: () => getEntitySchema(key),
      enabled: !STATIC_ENTITY_CONFIGS[key],
      staleTime: SCHEMA_STALE_TIME,
    })),
  });

  return useMemo(() => {
    const out: Record<string, EntityConfig> = {};
    keys.forEach((key, i) => {
      const staticConfig = STATIC_ENTITY_CONFIGS[key];
      if (staticConfig) {
        out[key] = staticConfig;
        return;
      }
      const data = results[i]?.data;
      if (data) {
        out[key] = toEntityConfig(key, data);
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, results.map((r) => r.dataUpdatedAt).join(",")]);
}

/**
 * ADR-0053: `GET /api/v1/entities/{resource}/schema` — the runtime
 * counterpart to the backend's `crud_factory.derive_entity_schema`.
 *
 * Response shape matches `entityConfigs/types.ts`'s `EntityConfig`/
 * `FieldConfig` minus only the frontend-only *routing* fields (`path`,
 * `listPath`, `createPath`) — see `entityConfigs/overrides.ts`.
 *
 * `scopeSelector`/`scopeResolution` ARE served here: an earlier draft of this
 * file listed them as frontend-only, but they moved backend-side (their own
 * `ScopeSelectorOption`/`ScopeResolution` dataclasses in `crud_factory.py`)
 * per the CTO's explicit "fully backend-driven, no residual static frontend
 * file" direction. They describe how an entity's list *resolves its scope*,
 * which is data shape, not route wiring.
 */
import { apiFetch } from "./client";
import {
  CompoundCreateAction,
  EntityRelation,
  LinkCreateAction,
  LinkDeleteAction,
  FieldType,
  ScopeResolution,
  ScopeSelectorOption,
} from "../../entityConfigs/types";

export interface BackendFieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  showInTable: boolean;
  sortable: boolean;
  values?: string[];
  refEntity?: string;
  labelField?: string;
  badgeColors?: Record<string, string>;
  readOnly?: boolean;
  /** fk only — see `entityConfigs/types.ts`'s `FieldConfig.select` doc comment. */
  select?: boolean;
}

export interface EntitySchemaResponse {
  resource: string;
  label: string;
  methods: ("list" | "get" | "create" | "update" | "delete")[];
  scopeField: string | [string, string] | null;
  /** Single option, or an array for a branching scope (`RiskItem`). */
  scopeSelector: ScopeSelectorOption | ScopeSelectorOption[] | null;
  scopeResolution: ScopeResolution | null;
  searchFields: string[];
  filterFields: string[];
  fields: BackendFieldConfig[];
  /**
   * ADR-0074: this entity's *inbound* relationships — see
   * `entityConfigs/types.ts`'s `EntityRelation`. Optional on this type
   * (not on the wire) so a response captured before ADR-0074 — every
   * hand-written Vitest fixture in this repo, of which there are many —
   * still type-checks; `toEntityConfig` normalizes the absent case to `[]`.
   */
  relations?: EntityRelation[];
  /**
   * ADR-0076: this entity's bespoke link-create route, or `null` for the 25
   * entities that are not link tables. Optional on this type for the same
   * fixture-compatibility reason as `relations` above; `toEntityConfig` drops
   * both the `null` and the absent case.
   */
  linkCreate?: LinkCreateAction | null;
  /**
   * ADR-0077: this entity's bespoke link-*delete* route, or `null` for the 25
   * entities that are not link tables. Optional on this type for the same
   * fixture-compatibility reason as `linkCreate` above; `toEntityConfig` drops
   * both the `null` and the absent case.
   */
  linkDelete?: LinkDeleteAction | null;
  /**
   * ADR-0078: per-*direction* compound-create actions for a junction whose far
   * entity has no generic `create` — `[]` for every entity that declares none,
   * which is most of them. Optional here for the same fixture-compatibility
   * reason as `relations`/`linkCreate` above; `toEntityConfig` normalizes the
   * absent case to `[]` rather than dropping it, since a caller searches this
   * list by direction and an empty list is already the "none for me" answer.
   */
  compoundCreates?: CompoundCreateAction[];
  /**
   * ADR-0079: `compoundCreates`' one-to-many sibling — same shape, declared on
   * the CHILD entity's own config instead of a link entity's, matched by the
   * caller against `relation.scopeField` instead of `relation.targetField`.
   * Optional/normalized-to-`[]` for the identical fixture-compatibility
   * reason `compoundCreates` is.
   */
  childCompoundCreates?: CompoundCreateAction[];
}

/** `entityKey` is the plural `:entity` route slug (`registry.ts`'s own keys). */
export async function getEntitySchema(entityKey: string): Promise<EntitySchemaResponse> {
  return apiFetch<EntitySchemaResponse>(`/api/v1/entities/${entityKey}/schema`);
}

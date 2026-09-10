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
import { FieldType, ScopeResolution, ScopeSelectorOption } from "../../entityConfigs/types";

export interface BackendFieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  showInTable: boolean;
  values?: string[];
  refEntity?: string;
  labelField?: string;
  badgeColors?: Record<string, string>;
  readOnly?: boolean;
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
}

/** `entityKey` is the plural `:entity` route slug (`registry.ts`'s own keys). */
export async function getEntitySchema(entityKey: string): Promise<EntitySchemaResponse> {
  return apiFetch<EntitySchemaResponse>(`/api/v1/entities/${entityKey}/schema`);
}

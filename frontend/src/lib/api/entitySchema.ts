/**
 * ADR-0053: `GET /api/v1/entities/{resource}/schema` — the runtime
 * counterpart to the backend's `crud_factory.derive_entity_schema`. Response
 * shape matches `entityConfigs/types.ts`'s `EntityConfig`/`FieldConfig`
 * minus the frontend-only routing fields (`path`, `listPath`, `createPath`,
 * `scopeSelector`, `scopeResolution`) — those stay declared in
 * `entityConfigs/overrides.ts` (see that file's own docstring for why).
 */
import { apiFetch } from "./client";
import { FieldType } from "../../entityConfigs/types";

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
  searchFields: string[];
  filterFields: string[];
  fields: BackendFieldConfig[];
}

/** `entityKey` is the plural `:entity` route slug (`registry.ts`'s own keys). */
export async function getEntitySchema(entityKey: string): Promise<EntitySchemaResponse> {
  return apiFetch<EntitySchemaResponse>(`/api/v1/entities/${entityKey}/schema`);
}

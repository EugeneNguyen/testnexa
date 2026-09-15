/**
 * ADR-0072 (ENTITY-FILTER-1) — the draft-condition model behind `EntityTable`'s
 * "Filter" header button and its `FilterModal`.
 *
 * This module is the *pure* half of the feature: no React, no DOM, no network,
 * so every add/remove/AND-combination/serialization rule below is unit-testable
 * on its own (`entityFilters.test.ts`) without rendering a modal. Same split
 * `lib/columnPreferences.ts` uses for the sibling column-visibility feature.
 *
 * **Why a list of conditions rather than a `Record<field, value>` map in the
 * UI layer.** The wire format *is* a map — `?<field>=<value>` query params,
 * `AND`-ed by the backend's own chained `.where()` calls (`crud_factory.py`'s
 * `apply_filters_and_search`). But a map cannot represent the intermediate
 * state a builder UI needs: a row the user has just added but not yet assigned
 * a field to. So the modal edits an ordered `FilterCondition[]` draft and
 * serializes down to the map exactly once, on Apply (`filtersFromConditions`).
 *
 * **AND only, and at most one condition per field.** The backend supports
 * exact equality and nothing else, and chained `.where()` clauses are `AND`ed
 * unconditionally — there is no `OR` to express and no per-condition operator
 * to choose. A second condition on an already-used field would compile to
 * `field = a AND field = b`, which is *always* empty for `a != b` — a trap the
 * user would read as "no results," not as "this query is contradictory." So
 * `availableFieldsFor` excludes any field another condition already claims,
 * making the impossible state unrepresentable rather than merely discouraged.
 */
import { EntityConfig, FieldConfig } from "../entityConfigs/types";

export interface FilterCondition {
  /** `FieldConfig.name`, or `""` for a freshly-added row the user hasn't assigned yet. */
  field: string;
  /** Always the raw string that will go on the wire; `""` means "not yet set". */
  value: string;
}

/**
 * The fields this entity's list route will actually honour as filters.
 *
 * Source of truth is the backend-served `filterFields` list
 * (`GET /entities/{resource}/schema`, derived per ADR-0072 from the entity's
 * own schema rather than a hand-kept tuple) — intersected with `config.fields`
 * so the modal can only ever offer a field it also has a label, type and (for
 * an enum) a value list for. Order follows `config.fields`, i.e. the same
 * order the table's own columns are in, so the picker reads consistently with
 * the screen behind it.
 *
 * An entity whose schema serves no `filterFields` at all yields `[]` — the
 * caller (`EntityTable`) suppresses the whole Filter button in that case,
 * exactly as it already suppresses the search box for an entity with no
 * `searchFields`.
 */
export function filterableFields(config: EntityConfig): FieldConfig[] {
  const allowed = new Set(config.filterFields ?? []);
  if (allowed.size === 0) {
    return [];
  }
  return config.fields.filter((field) => allowed.has(field.name));
}

/**
 * The fields selectable in row `index`'s own field picker: every filterable
 * field except those *other* rows have already claimed. Row `index`'s own
 * current field stays in the list — otherwise the `<select>` would have no
 * option matching its own value and would render blank.
 */
export function availableFieldsFor(
  fields: FieldConfig[],
  conditions: FilterCondition[],
  index: number,
): FieldConfig[] {
  const claimed = new Set(conditions.filter((_, i) => i !== index).map((condition) => condition.field));
  return fields.filter((field) => !claimed.has(field.name));
}

/** The first filterable field no condition has claimed yet, or `undefined` when all are used. */
export function nextUnusedField(fields: FieldConfig[], conditions: FilterCondition[]): FieldConfig | undefined {
  const claimed = new Set(conditions.map((condition) => condition.field));
  return fields.find((field) => !claimed.has(field.name));
}

/**
 * Appends a new row, pre-assigned to the first unused field so the common case
 * (open, click Add, type a value) needs no field selection at all. Returns the
 * list unchanged when every filterable field is already claimed — there is no
 * valid field left to give the new row, and a second blank-field row could
 * never be completed.
 */
export function addCondition(fields: FieldConfig[], conditions: FilterCondition[]): FilterCondition[] {
  const field = nextUnusedField(fields, conditions);
  if (!field) {
    return conditions;
  }
  return [...conditions, { field: field.name, value: "" }];
}

export function removeCondition(conditions: FilterCondition[], index: number): FilterCondition[] {
  if (index < 0 || index >= conditions.length) {
    return conditions;
  }
  return conditions.filter((_, i) => i !== index);
}

/**
 * Immutably updates one row. Changing a row's *field* also clears its value —
 * a value typed against a `date` column is meaningless once the row is
 * re-pointed at an enum, and silently carrying it over would submit a filter
 * the user never intended.
 */
export function updateCondition(
  conditions: FilterCondition[],
  index: number,
  patch: Partial<FilterCondition>,
): FilterCondition[] {
  return conditions.map((condition, i) => {
    if (i !== index) {
      return condition;
    }
    if (patch.field !== undefined && patch.field !== condition.field) {
      return { field: patch.field, value: "" };
    }
    return { ...condition, ...patch };
  });
}

/**
 * Serializes the draft down to the `?<field>=<value>` map the list query
 * carries. Incomplete rows (no field chosen, or no value typed) are dropped
 * rather than submitted — an empty value is already a no-op backend-side
 * (`apply_filters_and_search` skips `None`/`""`), so sending it would only
 * inflate the React Query key and force a pointless refetch. A later row wins
 * a duplicate field, which `availableFieldsFor` already makes unreachable
 * through the UI but which a hand-constructed draft could still produce.
 */
export function filtersFromConditions(conditions: FilterCondition[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const condition of conditions) {
    if (condition.field && condition.value !== "") {
      out[condition.field] = condition.value;
    }
  }
  return out;
}

/**
 * Re-seeds the draft from the applied filters each time the modal opens, so a
 * cancelled edit is genuinely discarded. A filter naming a field the schema no
 * longer serves as filterable is dropped here rather than rendered as an
 * unselectable row — same "a stale preference degrades to the default, never
 * to an error" posture `lib/columnPreferences.ts` takes for a stale column name.
 */
export function conditionsFromFilters(
  filters: Record<string, string>,
  fields: FieldConfig[],
): FilterCondition[] {
  const known = new Set(fields.map((field) => field.name));
  return Object.entries(filters)
    .filter(([field, value]) => known.has(field) && value !== "")
    .map(([field, value]) => ({ field, value }));
}

/**
 * How many filters are currently applied — the number painted in the Filter
 * button's own badge.
 *
 * This badge is load-bearing, not decoration. ADR-0072 deliberately does *not*
 * persist filters (unlike the sibling column-preferences feature), and the
 * reason is exactly what this count exists to mitigate: a hidden column is
 * visible as an absence in a row of headers, but an active filter is invisible
 * — the user just sees fewer rows, which reads as missing data rather than as
 * a query they themselves narrowed.
 */
export function activeFilterCount(filters: Record<string, string>): number {
  return Object.values(filters).filter((value) => value !== "").length;
}

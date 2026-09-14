/**
 * `components/molecules/` (ADR-0043) — sibling of `FkAutocomplete`
 * (`components/molecules/fk-autocomplete/`), for an fk field whose ref
 * entity's own `FieldConfig.select` is `true` (2026-09-15, live-manual-test
 * feedback on REQ-5's standalone TestCase form: "test level, test type, test
 * condition should be dropdown select"). Fetches the ref entity's full list
 * **once** (no debounce, no `?q=` search) and renders a plain native
 * `<select>` — appropriate only for a small, bounded catalog
 * (`TestLevel`/`TestType`/per-project `TestCondition`), never for an
 * unbounded ref entity like `Requirement`/`Project` (those stay on
 * `FkAutocomplete`).
 *
 * Deliberately NOT a variant/prop of `FkAutocomplete` itself — the two have
 * almost no shared rendering logic (a text input + debounced dropdown vs. a
 * native `<select>`), and forcing one component to branch its entire render
 * tree on a boolean would be harder to read than two small, focused
 * components sharing only their config-resolution setup. Props mirror
 * `FkAutocompleteProps` 1:1 (minus the ones that only make sense for a
 * type-to-search input) so `EntityForm` can pick between them with a single
 * `field.select` check.
 */
import { useEffect, useState } from "react";
import { EntityRow, listEntities } from "../../../lib/api/entityCrud";
import { useEntitySchema } from "../../../pages/admin/useEntitySchema";
import type { EntityConfig } from "../../../entityConfigs/types";
import { Select } from "../../atoms/select";

/** Comfortably above any of today's bounded catalogs (5 test levels, a handful of test types/conditions). */
const FULL_LIST_PAGE_SIZE = 100;

export interface FkSelectProps {
  id: string;
  label: string;
  refEntity: string;
  labelField?: string;
  value?: string;
  onChange: (id: string | undefined) => void;
  error?: string;
  disabled?: boolean;
  extraParams?: Record<string, string | undefined>;
  routeParams?: Record<string, string | undefined>;
  /** See `FkAutocompleteProps.config`'s own doc comment — same override mechanism. */
  config?: EntityConfig;
}

function labelFor(row: EntityRow, labelField: string | undefined): string {
  if (!labelField) {
    return String(row.id ?? "");
  }
  const raw = row[labelField];
  return raw === null || raw === undefined || raw === "" ? String(row.id ?? "") : String(raw);
}

function FkSelect({
  id,
  label,
  refEntity,
  labelField,
  value,
  onChange,
  error,
  disabled,
  extraParams,
  routeParams,
  config,
}: FkSelectProps) {
  // ADR-0053: called unconditionally, mirrors `FkAutocomplete`'s own reasoning.
  const { config: fetchedConfig, isLoading: isSchemaLoading } = useEntitySchema(refEntity);
  const refConfig = config ?? fetchedConfig;
  const isResolvingConfig = !config && isSchemaLoading;
  const canList = Boolean(refConfig?.methods.includes("list"));

  const [rows, setRows] = useState<EntityRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!canList || !refConfig) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    listEntities(refConfig, routeParams ?? {}, { pageSize: FULL_LIST_PAGE_SIZE, params: extraParams })
      .then((response) => {
        if (!cancelled) {
          setRows(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canList, refConfig, JSON.stringify(extraParams), JSON.stringify(routeParams)]);

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <Select
        invalid={Boolean(error)}
        id={id}
        value={value ?? ""}
        disabled={disabled || !canList || isLoading}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">
          {canList ? (isLoading || isResolvingConfig ? "Loading..." : "Select...") : "Search unavailable for this field"}
        </option>
        {rows.map((row) => (
          <option key={String(row.id)} value={String(row.id)}>
            {labelFor(row, labelField)}
          </option>
        ))}
      </Select>
      {error && (
        <div className="invalid-feedback d-block" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default FkSelect;

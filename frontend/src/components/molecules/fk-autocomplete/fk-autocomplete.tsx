/**
 * `components/molecules/` (ADR-0043, superseding ADR-0023's `components/crud/`
 * location): a generic entity-CRUD widget, not a markup-duplication-driven
 * composition primitive — this is driven entirely by an `EntityConfig`'s
 * shape, tiered here on composition complexity (one control unit) same as
 * every other molecule.
 *
 * UI Design Document §2: a text input with a debounced (300ms) dropdown of
 * matches, `?q=<term>` against the referenced entity's own list route;
 * selecting an option stores its `id`, displays its `labelField`.
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** raw Bootstrap 5 markup now —
 * `CFormLabel`/`CFormInput` -> `<label class="form-label">` + `<input
 * class="form-control">` (`invalid` -> the `is-invalid` class), `CSpinner` ->
 * `<div class="spinner-border spinner-border-sm">`, `CFormFeedback invalid`
 * -> `<div class="invalid-feedback d-block">`, and the `CListGroup` dropdown
 * -> `<div class="list-group">` of `<button type="button" class="list-group-item
 * list-group-item-action">`.
 *
 * **On that wrapper being a `<div>`, not a `<ul>`:** `CListGroup` +
 * `CListGroupItem as="button"` really did render `<button>` elements as direct
 * children of a `<ul>`, which is invalid HTML — `<ul>` permits only `<li>`.
 * The first pass of this migration reproduced that shape verbatim for DOM
 * parity, but it is not worth preserving: a `<ul>` whose children are all
 * non-`<li>` already exposes a degenerate accessibility tree (a list
 * containing no list items), so copying it buys no real fidelity. This is
 * Bootstrap's own documented actionable-list-group markup instead, which is
 * valid and renders identically. Verified before switching that no Vitest or
 * Playwright spec selects this dropdown via `getByRole("list")` /
 * `getByRole("listitem")` — the `getByRole("listitem")` usages in the e2e
 * suite all target genuine `<ul>/<li>` lists on other screens
 * (`execution-history-list`, `included-suite-list`, `coverage-list`,
 * `criteria-list`), which stay as they are.
 *
 * Interaction is unchanged: the same `onMouseDown` preventDefault keeps the
 * blur-close timer from beating the click, and the option is still a real
 * `<button>`, so it stays keyboard-reachable and Enter/Space-activatable.
 *
 * `refEntity` is a registry key (`pages/admin/registry.ts`'s
 * `entityConfigByKey`), not necessarily an entity with its own admin page —
 * only its `list` method needs to exist (ADR-0025). If the resolved config's
 * `methods` doesn't include `"list"` at all (`TestCase` today — see
 * `entityConfigs/test-case.ts`'s own docstring), this renders a plain
 * disabled input explaining why, rather than firing a request against a
 * route that doesn't exist.
 */
import { useEffect, useRef, useState } from "react";
import { EntityRow, getEntity, listEntities } from "../../../lib/api/entityCrud";
import { entityConfigByKey } from "../../../pages/admin/registry";
import type { EntityConfig } from "../../../entityConfigs/types";

const DEBOUNCE_MS = 300;

export interface FkAutocompleteProps {
  id: string;
  label: string;
  refEntity: string;
  /** Which field of the ref entity's summary to display (`FieldConfig.labelField`, UI Design Document §3). */
  labelField?: string;
  value?: string;
  onChange: (id: string | undefined) => void;
  error?: string;
  disabled?: boolean;
  /** Extra fixed query params merged into the ref entity's own list call (e.g. an already-known `project_id`). */
  extraParams?: Record<string, string | undefined>;
  /**
   * Route params for interpolating a `listPath` placeholder (PLAN-3).
   * Only `Release` has one today (`/projects/:projectId/releases`,
   * `entityConfigs/release.ts`) — every other config's `listPath` is a literal,
   * so omitting this (the default) is correct for all of them. Without it a
   * `release` autocomplete would request the literal `:projectId` segment.
   */
  routeParams?: Record<string, string | undefined>;
  /**
   * EXEC-1 (ADR-0034): use this `EntityConfig` instead of the registry's own
   * entry for `refEntity`. Additive and optional — every existing call site
   * omits it and keeps the registry lookup unchanged.
   *
   * The one real use today is `TestCycleDetail`'s "Record Result" picker,
   * which must list from `GET /test-plans/{id}/test-cases` (PLAN-1's coverage
   * query) rather than a project-wide `TestCase` list. The registry's own
   * `test-case` config deliberately has **no `list` method at all** — there is
   * no `GET /test-cases` route (`entityConfigs/test-case.ts`) — so without an
   * override this widget would correctly render its disabled "search
   * unavailable" state and the scoped picker would be impossible to express.
   *
   * Deliberately a whole config rather than a bare `listPath` string: the
   * config is what `getEntity` (the selected-value label lookup) and the
   * `methods.includes("list")` capability check already read, so overriding
   * one field in isolation would leave those two reading the registry's
   * config and the search reading another — two sources of truth for one
   * widget. Callers derive the override from the registry config with a
   * spread, the same `{...config, ...}` derivation `TestPlanDetail`'s own
   * `editConfig`/`criteriaConfig` already use.
   */
  config?: EntityConfig;
}

function labelFor(row: EntityRow, labelField: string | undefined): string {
  if (!labelField) {
    return String(row.id ?? "");
  }
  const raw = row[labelField];
  return raw === null || raw === undefined || raw === "" ? String(row.id ?? "") : String(raw);
}

function FkAutocomplete({
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
}: FkAutocompleteProps) {
  // An explicit `config` wins over the registry lookup (EXEC-1/ADR-0034); with
  // it omitted this is the original `entityConfigByKey[refEntity]` behavior.
  const refConfig = config ?? entityConfigByKey[refEntity];
  const canSearch = Boolean(refConfig) && refConfig.methods.includes("list");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const hasUserTypedRef = useRef(false);

  // Best-effort: show the currently-selected value's own label on mount /
  // when `value` changes from outside (e.g. loading an existing row into
  // `EntityForm`), without requiring the caller to already know it.
  useEffect(() => {
    let cancelled = false;
    hasUserTypedRef.current = false;
    if (!value || !refConfig) {
      setQuery("");
      return;
    }
    getEntity<EntityRow>(refConfig, value)
      .then((row) => {
        if (!cancelled) {
          setQuery(labelFor(row, labelField));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuery(value);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [value, refEntity, refConfig, labelField]);

  useEffect(() => {
    if (!canSearch || !hasUserTypedRef.current) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!query) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setIsLoading(true);
      listEntities(refConfig, routeParams ?? {}, { q: query, params: extraParams })
        .then((response) => {
          setResults(response.items);
          setIsOpen(true);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => setIsLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleSelect(row: EntityRow) {
    hasUserTypedRef.current = false;
    setQuery(labelFor(row, labelField));
    setIsOpen(false);
    onChange(String(row.id));
  }

  return (
    <div className="mb-3 position-relative">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        className={`form-control${error ? " is-invalid" : ""}`}
        id={id}
        type="text"
        value={query}
        disabled={disabled || !canSearch}
        placeholder={canSearch ? "Type to search..." : "Search unavailable for this field"}
        onChange={(event) => {
          hasUserTypedRef.current = true;
          setQuery(event.target.value);
          if (!event.target.value) {
            onChange(undefined);
          }
        }}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        autoComplete="off"
      />
      {isLoading && (
        <div
          className="spinner-border spinner-border-sm position-absolute"
          role="status"
          style={{ right: "0.5rem", top: "2.1rem" }}
        >
          <span className="visually-hidden">Loading...</span>
        </div>
      )}
      {isOpen && results.length > 0 && (
        <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 1000 }}>
          {results.map((row) => (
            <button
              key={String(row.id)}
              type="button"
              className="list-group-item list-group-item-action"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(row)}
            >
              {labelFor(row, labelField)}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="invalid-feedback d-block" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default FkAutocomplete;

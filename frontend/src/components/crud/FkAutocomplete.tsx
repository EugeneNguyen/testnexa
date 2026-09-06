/**
 * `components/crud/` (ADR-0023): generic entity-CRUD widget, not a
 * `components/shared/` cross-screen primitive — this is driven entirely by
 * an `EntityConfig`'s shape, not markup-duplication evidence.
 *
 * UI Design Document §2: `CFormInput` with a debounced (300ms) dropdown of
 * matches, `?q=<term>` against the referenced entity's own list route;
 * selecting an option stores its `id`, displays its `labelField`.
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
import { CFormFeedback, CFormInput, CFormLabel, CListGroup, CListGroupItem, CSpinner } from "@coreui/react";
import { EntityRow, getEntity, listEntities } from "../../lib/api/entityCrud";
import { entityConfigByKey } from "../../pages/admin/registry";

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
}: FkAutocompleteProps) {
  const refConfig = entityConfigByKey[refEntity];
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
      listEntities(refConfig, {}, { q: query, params: extraParams })
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
      <CFormLabel htmlFor={id}>{label}</CFormLabel>
      <CFormInput
        id={id}
        type="text"
        value={query}
        disabled={disabled || !canSearch}
        placeholder={canSearch ? "Type to search..." : "Search unavailable for this field"}
        invalid={Boolean(error)}
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
      {isLoading && <CSpinner size="sm" className="position-absolute" style={{ right: "0.5rem", top: "2.1rem" }} />}
      {isOpen && results.length > 0 && (
        <CListGroup className="position-absolute w-100 shadow" style={{ zIndex: 1000 }}>
          {results.map((row) => (
            <CListGroupItem
              key={String(row.id)}
              as="button"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(row)}
            >
              {labelFor(row, labelField)}
            </CListGroupItem>
          ))}
        </CListGroup>
      )}
      {error && (
        <CFormFeedback invalid role="alert">
          {error}
        </CFormFeedback>
      )}
    </div>
  );
}

export default FkAutocomplete;

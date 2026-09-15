/**
 * `FilterModal` organism (ADR-0072 / FR-ADMIN-5) — the "Filter" dialog behind
 * `EntityTable`'s own header button. Lets the user build one or more
 * exact-match conditions over the entity's filterable fields, all combined
 * with `AND`, and Apply them to the list query.
 *
 * `organisms/` tier per ADR-0043: it composes the `Modal` molecule, the
 * `FkAutocomplete`/`FkSelect` molecules and the `Button`/`Select`/`TextInput`
 * atoms — no new raw `.modal`/`.btn`/`.form-select` markup is hand-rolled here
 * (root `CLAUDE.md`'s mandatory reuse check; the `Modal` molecule already
 * carries this repo's modal semantics — renders nothing when closed, ESC
 * closes, no focus trap by design, `.modal-body`/`.modal-footer` supplied by
 * the caller).
 *
 * **AND only, no operator picker.** The backend's `filter_fields` mechanism is
 * exact equality and nothing else, and its chained `.where()` calls are `AND`ed
 * unconditionally (`crud_factory.py`'s `apply_filters_and_search`). Rather than
 * render a disabled/single-option operator `<select>` that implies a choice
 * nobody has, the conjunction is stated once in prose and each row is a bare
 * field + value pair. If the backend ever grows real operators, the row gains a
 * third control — the draft model (`lib/entityFilters.ts`) already carries a
 * per-row object rather than a flat map for exactly that reason.
 *
 * **One condition per field.** `availableFieldsFor` removes any field another
 * row already claims, so `field = a AND field = b` — always empty, and read by
 * a user as "no results" rather than "contradictory query" — is unrepresentable
 * rather than merely discouraged.
 *
 * **Typed value controls, matching `EntityForm`'s own branch.** A filter value
 * is submitted against a real typed column, so an `enum` gets a `<select>` of
 * its own served `values`, a `boolean` gets a true/false `<select>`, a `date`
 * gets `<input type="date">`, and an `fk` gets `field.select ? FkSelect :
 * FkAutocomplete` — byte-for-byte the same pick `entity-form.tsx` makes for the
 * same field types, so a field is filtered through the same control it is
 * edited through. Everything else is a plain text input. This is what keeps the
 * backend's new per-column coercion (ADR-0072's 422-not-500 half) from being
 * the user's first line of defence against a typo.
 *
 * **Draft state.** Edits are local to the modal until "Apply" — Cancel and ESC
 * both discard them, so a half-built condition never reaches the list query.
 * The draft is re-seeded from the applied filters every time the modal opens
 * (keyed `useEffect` on `visible`), so reopening after a Cancel shows what is
 * actually applied, not the abandoned draft. Same mechanism, and the same
 * reason, as `ColumnPreferencesModal`'s own re-seed.
 */
import { useEffect, useState } from "react";
import { EntityConfig, FieldConfig } from "../../../entityConfigs/types";
import {
  addCondition,
  availableFieldsFor,
  conditionsFromFilters,
  FilterCondition,
  filterableFields,
  filtersFromConditions,
  nextUnusedField,
  removeCondition,
  updateCondition,
} from "../../../lib/entityFilters";
import { Button } from "../../atoms/button";
import { Icon } from "../../atoms/icon";
import { Select } from "../../atoms/select";
import { TextInput } from "../../atoms/text-input";
import FkAutocomplete from "../../molecules/fk-autocomplete";
import FkSelect from "../../molecules/fk-select";
import { Modal } from "../../molecules/modal";

export interface FilterModalProps {
  visible: boolean;
  /** Entity label for the dialog title, e.g. "Requirements". */
  entityLabel?: string;
  config: EntityConfig;
  /** The filters currently applied to the list query. Re-read whenever the modal opens. */
  filters: Record<string, string>;
  onClose: () => void;
  /** Fired on Apply with the complete new filter map — replaces the old one wholesale. */
  onApply: (filters: Record<string, string>) => void;
}

export function FilterModal({ visible, entityLabel, config, filters, onClose, onApply }: FilterModalProps) {
  const fields = filterableFields(config);
  const [draft, setDraft] = useState<FilterCondition[]>(() => conditionsFromFilters(filters, fields));

  // Re-seed from the applied filters each time the modal opens, so a cancelled
  // edit is genuinely discarded rather than lingering until unmount (the Modal
  // molecule keeps this component mounted while closed).
  useEffect(() => {
    if (visible) {
      setDraft(conditionsFromFilters(filters, fields));
    }
    // `filters`/`fields` are fresh identities on every parent render; keying the
    // effect on them would re-seed mid-edit and throw away the user's changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canAdd = Boolean(nextUnusedField(fields, draft));

  function renderValueControl(field: FieldConfig | undefined, condition: FilterCondition, index: number) {
    const testId = `filter-value-${condition.field || index}`;
    const set = (value: string) => setDraft((prev) => updateCondition(prev, index, { value }));

    if (!field) {
      return <TextInput disabled placeholder="Choose a field first" data-testid={testId} />;
    }

    switch (field.type) {
      case "enum":
        return (
          <Select
            aria-label={`${field.label} value`}
            value={condition.value}
            onChange={(event) => set(event.target.value)}
            data-testid={testId}
          >
            <option value="">Any</option>
            {(field.values ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        );
      case "boolean":
        return (
          <Select
            aria-label={`${field.label} value`}
            value={condition.value}
            onChange={(event) => set(event.target.value)}
            data-testid={testId}
          >
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        );
      case "date":
        return (
          <TextInput
            type="date"
            aria-label={`${field.label} value`}
            value={condition.value}
            onChange={(event) => set(event.target.value)}
            data-testid={testId}
          />
        );
      case "fk": {
        // Exactly `entity-form.tsx`'s own branch — a field is filtered through
        // the same control it is edited through. Both molecules own their
        // label + `.mb-3` wrapper, hence the `flex-grow-1` wrapper rather than
        // an extra label of our own.
        const FkControl = field.select ? FkSelect : FkAutocomplete;
        return (
          <div className="flex-grow-1" data-testid={testId}>
            <FkControl
              id={`filter-fk-${field.name}`}
              label={field.label}
              refEntity={field.refEntity ?? ""}
              labelField={field.labelField}
              value={condition.value || undefined}
              onChange={(id) => set(id ?? "")}
            />
          </div>
        );
      }
      default:
        return (
          <TextInput
            type="text"
            aria-label={`${field.label} value`}
            value={condition.value}
            onChange={(event) => set(event.target.value)}
            data-testid={testId}
          />
        );
    }
  }

  return (
    <Modal
      visible={visible}
      title={<>Filter{entityLabel ? <span className="text-body-secondary"> — {entityLabel}</span> : null}</>}
      onClose={onClose}
    >
      <Modal.Body>
        <p className="text-body-secondary small">
          Show only records matching every condition below. Conditions are combined with AND, and each one matches the
          field&apos;s value exactly.
        </p>

        {fields.length === 0 ? (
          <p className="text-body-secondary mb-0" data-testid="filter-no-fields">
            No filterable fields are available for this entity.
          </p>
        ) : draft.length === 0 ? (
          <p className="text-body-secondary mb-0" data-testid="filter-empty">
            No conditions yet — add one to narrow this list.
          </p>
        ) : (
          <ul className="list-unstyled mb-0" data-testid="filter-condition-list">
            {draft.map((condition, index) => {
              const field = fields.find((candidate) => candidate.name === condition.field);
              return (
                <li
                  key={`${condition.field}-${index}`}
                  className="d-flex align-items-end gap-2 mb-3"
                  data-testid={`filter-condition-${index}`}
                >
                  <div style={{ width: 180, maxWidth: "40%" }}>
                    <Select
                      aria-label={`Condition ${index + 1} field`}
                      value={condition.field}
                      onChange={(event) => setDraft((prev) => updateCondition(prev, index, { field: event.target.value }))}
                      data-testid={`filter-field-${index}`}
                    >
                      {availableFieldsFor(fields, draft, index).map((candidate) => (
                        <option key={candidate.name} value={candidate.name}>
                          {candidate.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex-grow-1">{renderValueControl(field, condition, index)}</div>
                  <Button
                    outline
                    color="danger"
                    size="sm"
                    aria-label={`Remove condition ${index + 1}`}
                    title="Remove condition"
                    onClick={() => setDraft((prev) => removeCondition(prev, index))}
                    data-testid={`filter-remove-${index}`}
                  >
                    <Icon name="trash" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {fields.length > 0 && (
          <Button
            outline
            color="secondary"
            size="sm"
            disabled={!canAdd}
            title={canAdd ? undefined : "Every filterable field is already used by a condition."}
            onClick={() => setDraft((prev) => addCondition(fields, prev))}
            data-testid="filter-add-condition"
          >
            <Icon name="plus" className="me-1" />
            Add condition
          </Button>
        )}
      </Modal.Body>

      <Modal.Footer className="justify-content-between">
        <Button outline color="secondary" onClick={() => setDraft([])} data-testid="filter-clear-all">
          Clear all
        </Button>
        <div className="d-flex gap-2">
          <Button outline color="secondary" onClick={onClose} data-testid="filter-cancel">
            Cancel
          </Button>
          <Button color="primary" onClick={() => onApply(filtersFromConditions(draft))} data-testid="filter-apply">
            Apply
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}

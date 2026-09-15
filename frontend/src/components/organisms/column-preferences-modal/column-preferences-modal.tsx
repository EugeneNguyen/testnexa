/**
 * `ColumnPreferencesModal` organism (ADR-0071 / FR-ADMIN-4) — the "Columns"
 * dialog behind `EntityTable`'s own header button. Lists every column the
 * entity's served schema exposes (ADR-0053's `GET /entities/{resource}/schema`,
 * filtered to `showInTable !== false` — the exact same source the table's
 * columns come from, so the modal can never list a column the table won't
 * render or vice versa), with a checkbox to show/hide each and Up/Down
 * buttons to reorder.
 *
 * `organisms/` tier per ADR-0043: it composes the `Modal` molecule, the
 * `LabeledCheckbox` molecule, and the `Button`/`Icon` atoms — no new raw
 * `.modal`/`.btn`/`.form-check` markup is hand-rolled here (root `CLAUDE.md`'s
 * mandatory reuse check; the `Modal` molecule already carries this repo's
 * modal semantics — renders nothing when closed, ESC closes, no focus trap
 * by design, `.modal-body`/`.modal-footer` supplied by the caller).
 *
 * **Up/Down buttons, not drag-and-drop.** No drag library is a frontend
 * dependency today and this story deliberately declines to add one (ADR-0071
 * Alternatives) — a new runtime dependency is its own decision. Up/Down is
 * also strictly more accessible: each control is a real `<button>` with a
 * real accessible name, reachable by keyboard with no pointer gestures.
 *
 * **Draft state.** Edits are local to the modal until "Apply" — Cancel and
 * ESC both discard them, so a half-finished reorder never reaches the table
 * or `localStorage`. The draft is re-seeded from props every time the modal
 * opens (keyed `useEffect` on `visible`), so reopening after a Cancel shows
 * the persisted state, not the abandoned draft.
 *
 * **Two independent reasons a checkbox is disabled**, both surfaced with a
 * `title` so the user isn't left guessing:
 * 1. `row.locked` — a config-level lock (`lockedFieldNames`): the
 *    `detailLinkField` of an entity with a `detailPath` carries the only
 *    navigation into that entity's detail workspace.
 * 2. It is the *last remaining visible* column — hiding it would leave a
 *    table with nothing but an Actions column. This one is per-render, not
 *    per-config, so it lives here rather than in `lib/columnPreferences.ts`.
 */
import { useEffect, useState } from "react";
import {
  ColumnPreferenceRow,
  ColumnPreferences,
  moveRow,
  preferencesFromRows,
} from "../../../lib/columnPreferences";
import { Button } from "../../atoms/button";
import { Icon } from "../../atoms/icon";
import { LabeledCheckbox } from "../../molecules/labeled-checkbox";
import { Modal } from "../../molecules/modal";

export interface ColumnPreferencesModalProps {
  visible: boolean;
  /** Entity label for the dialog title, e.g. "Requirements". */
  entityLabel?: string;
  /**
   * The current merged rows (`toPreferenceRows`) — full ordered field list
   * with each field's visible/locked flags. Re-read whenever the modal opens.
   */
  rows: ColumnPreferenceRow[];
  onClose: () => void;
  /** Fired on Apply with the serialized preference to persist. */
  onApply: (preferences: ColumnPreferences) => void;
  /** Fired on "Reset to defaults" — clears the stored preference entirely. */
  onReset: () => void;
}

export function ColumnPreferencesModal({
  visible,
  entityLabel,
  rows,
  onClose,
  onApply,
  onReset,
}: ColumnPreferencesModalProps) {
  const [draft, setDraft] = useState<ColumnPreferenceRow[]>(rows);

  // Re-seed the draft from the persisted rows each time the modal opens, so a
  // cancelled edit is genuinely discarded rather than lingering until unmount
  // (the Modal molecule keeps this component mounted while closed).
  useEffect(() => {
    if (visible) {
      setDraft(rows);
    }
    // `rows` is a fresh array identity on every parent render; keying the
    // effect on it would re-seed mid-edit and throw away the user's changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const visibleCount = draft.filter((row) => row.visible).length;

  function toggle(index: number) {
    setDraft((prev) => prev.map((row, i) => (i === index ? { ...row, visible: !row.visible } : row)));
  }

  function move(index: number, direction: "up" | "down") {
    setDraft((prev) => moveRow(prev, index, direction));
  }

  return (
    <Modal
      visible={visible}
      title={<>Columns{entityLabel ? <span className="text-body-secondary"> — {entityLabel}</span> : null}</>}
      onClose={onClose}
    >
      <Modal.Body>
        <p className="text-body-secondary small">
          Choose which columns to show and drag them into order with the arrow buttons. This applies to this entity
          only, on this browser.
        </p>
        <ul className="list-group" data-testid="column-preferences-list">
          {draft.map((row, index) => {
            const isLastVisible = row.visible && visibleCount === 1;
            const disabled = row.locked || isLastVisible;
            const reason = row.locked
              ? "This column links through to the record and cannot be hidden."
              : isLastVisible
                ? "At least one column must stay visible."
                : undefined;
            return (
              <li
                key={row.field.name}
                className="list-group-item d-flex align-items-center justify-content-between gap-2"
                data-testid={`column-preferences-row-${row.field.name}`}
              >
                <LabeledCheckbox
                  id={`column-pref-${row.field.name}`}
                  label={row.field.label}
                  checked={row.visible}
                  disabled={disabled}
                  title={reason}
                  onChange={() => toggle(index)}
                  data-testid={`column-preferences-toggle-${row.field.name}`}
                />
                <div className="d-flex gap-1">
                  <Button
                    outline
                    color="secondary"
                    size="sm"
                    aria-label={`Move ${row.field.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, "up")}
                    data-testid={`column-preferences-up-${row.field.name}`}
                  >
                    <Icon name="arrow-up" />
                  </Button>
                  <Button
                    outline
                    color="secondary"
                    size="sm"
                    aria-label={`Move ${row.field.label} down`}
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, "down")}
                    data-testid={`column-preferences-down-${row.field.name}`}
                  >
                    <Icon name="arrow-down" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <Button outline color="secondary" onClick={onReset} data-testid="column-preferences-reset">
          Reset to defaults
        </Button>
        <div className="d-flex gap-2">
          <Button outline color="secondary" onClick={onClose} data-testid="column-preferences-cancel">
            Cancel
          </Button>
          <Button
            color="primary"
            onClick={() => onApply(preferencesFromRows(draft))}
            data-testid="column-preferences-apply"
          >
            Apply
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}

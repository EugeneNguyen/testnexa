/**
 * ADR-0071 (COLPREF-1) — `ColumnPreferencesModal`'s own behaviour: which rows
 * it lists, what the checkboxes and Up/Down buttons do to the draft, which
 * controls are disabled and why, and exactly what `onApply` emits.
 *
 * Covers TC-ADMIN-047 (the modal lists every table field), TC-ADMIN-049
 * (reorder + end-of-list disabled state) and TC-ADMIN-052 (locked and
 * last-visible checkboxes are disabled). The persistence half of those TCs
 * lives in `lib/columnPreferences.test.ts`; the "does the table actually
 * re-render" half in `entity-table.columnPreferences.test.tsx`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColumnPreferencesModal } from "./column-preferences-modal";
import type { ColumnPreferenceRow } from "../../../lib/columnPreferences";

function row(name: string, overrides: Partial<ColumnPreferenceRow> = {}): ColumnPreferenceRow {
  return {
    field: { name, label: name[0].toUpperCase() + name.slice(1), type: "string" },
    visible: true,
    locked: false,
    ...overrides,
  };
}

const ROWS: ColumnPreferenceRow[] = [row("title"), row("status"), row("owner")];

function renderModal(props: Partial<React.ComponentProps<typeof ColumnPreferencesModal>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <ColumnPreferencesModal
      visible
      entityLabel="Widgets"
      rows={ROWS}
      onApply={onApply}
      onClose={onClose}
      onReset={onReset}
      {...props}
    />,
  );
  return { ...view, onApply, onClose, onReset };
}

function renderedOrder(): string[] {
  return Array.from(screen.getByTestId("column-preferences-list").querySelectorAll("li")).map(
    (li) => li.getAttribute("data-testid")?.replace("column-preferences-row-", "") ?? "",
  );
}

describe("ColumnPreferencesModal", () => {
  it("renders nothing at all when closed (Modal molecule parity)", () => {
    renderModal({ visible: false });
    expect(screen.queryByTestId("column-preferences-list")).toBeNull();
  });

  it("lists one row per field, labelled, in the given order (TC-ADMIN-047)", () => {
    renderModal();
    expect(renderedOrder()).toEqual(["title", "status", "owner"]);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
  });

  it("names the entity in its title", () => {
    renderModal();
    expect(screen.getByText(/Widgets/)).toBeInTheDocument();
  });

  it("reflects each row's stored visibility in its checkbox", () => {
    renderModal({ rows: [row("title"), row("status", { visible: false })] });
    expect(screen.getByLabelText("Title")).toBeChecked();
    expect(screen.getByLabelText("Status")).not.toBeChecked();
  });

  it("emits the full order plus the hidden set on Apply (TC-ADMIN-048)", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(onApply).toHaveBeenCalledWith({ v: 1, order: ["title", "status", "owner"], hidden: ["status"] });
  });

  it("moves a field up and reflects it in the emitted order (TC-ADMIN-049)", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    expect(renderedOrder()).toEqual(["title", "owner", "status"]);
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(onApply).toHaveBeenCalledWith({ v: 1, order: ["title", "owner", "status"], hidden: [] });
  });

  it("moves a field down", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-down-title"));
    expect(renderedOrder()).toEqual(["status", "title", "owner"]);
  });

  it("disables Up on the first row and Down on the last (TC-ADMIN-049)", () => {
    renderModal();
    expect(screen.getByTestId("column-preferences-up-title")).toBeDisabled();
    expect(screen.getByTestId("column-preferences-down-title")).not.toBeDisabled();
    expect(screen.getByTestId("column-preferences-up-owner")).not.toBeDisabled();
    expect(screen.getByTestId("column-preferences-down-owner")).toBeDisabled();
  });

  it("re-evaluates the end-of-list disabled state after a move", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-down-title"));
    // `title` is now in the middle: both of its arrows are live, and `status`
    // (now first) has its Up disabled instead.
    expect(screen.getByTestId("column-preferences-up-title")).not.toBeDisabled();
    expect(screen.getByTestId("column-preferences-up-status")).toBeDisabled();
  });

  it("disables a locked field's checkbox and explains why (TC-ADMIN-052)", () => {
    renderModal({ rows: [row("name", { locked: true }), row("status"), row("owner")] });
    const locked = screen.getByLabelText("Name");
    expect(locked).toBeDisabled();
    expect(locked).toBeChecked();
    expect(locked).toHaveAttribute("title", expect.stringContaining("cannot be hidden"));
    expect(screen.getByLabelText("Status")).not.toBeDisabled();
  });

  it("a locked field can still be reordered", () => {
    renderModal({ rows: [row("name", { locked: true }), row("status"), row("owner")] });
    fireEvent.click(screen.getByTestId("column-preferences-down-name"));
    expect(renderedOrder()).toEqual(["status", "name", "owner"]);
  });

  it("disables the last remaining visible field's checkbox (TC-ADMIN-052)", () => {
    renderModal({ rows: [row("title"), row("status", { visible: false }), row("owner", { visible: false })] });
    const last = screen.getByLabelText("Title");
    expect(last).toBeDisabled();
    expect(last).toHaveAttribute("title", expect.stringContaining("At least one column"));
    // A hidden field is never the "last visible" one, so it stays re-checkable.
    expect(screen.getByLabelText("Status")).not.toBeDisabled();
  });

  it("re-enables the previously-last checkbox once a second field is shown again", () => {
    renderModal({ rows: [row("title"), row("status", { visible: false })] });
    expect(screen.getByLabelText("Title")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Status"));
    expect(screen.getByLabelText("Title")).not.toBeDisabled();
  });

  it("discards the draft on Cancel and re-seeds it from props when reopened", () => {
    const { onApply, onClose, rerender } = renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-down-title"));
    expect(renderedOrder()).toEqual(["status", "title", "owner"]);

    fireEvent.click(screen.getByTestId("column-preferences-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    rerender(
      <ColumnPreferencesModal
        visible={false}
        rows={ROWS}
        onApply={onApply}
        onClose={onClose}
        onReset={vi.fn()}
      />,
    );
    rerender(
      <ColumnPreferencesModal visible rows={ROWS} onApply={onApply} onClose={onClose} onReset={vi.fn()} />,
    );
    expect(renderedOrder()).toEqual(["title", "status", "owner"]);
  });

  it("does not re-seed the draft mid-edit when the parent re-renders with a fresh rows array", () => {
    const { onApply, onClose, onReset, rerender } = renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-down-title"));
    expect(renderedOrder()).toEqual(["status", "title", "owner"]);

    // A brand-new array identity with identical content — exactly what
    // `EntityTable`'s own `useMemo` hands down on any unrelated re-render
    // (a row arriving, a page change). Re-seeding on that would silently
    // throw away the user's in-progress reorder.
    rerender(
      <ColumnPreferencesModal
        visible
        entityLabel="Widgets"
        rows={[row("title"), row("status"), row("owner")]}
        onApply={onApply}
        onClose={onClose}
        onReset={onReset}
      />,
    );
    expect(renderedOrder()).toEqual(["status", "title", "owner"]);

    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(onApply).toHaveBeenCalledWith({ v: 1, order: ["status", "title", "owner"], hidden: [] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onReset from the Reset to defaults button", () => {
    const { onReset } = renderModal();
    fireEvent.click(screen.getByTestId("column-preferences-reset"));
    expect(onReset).toHaveBeenCalled();
  });
});

/**
 * ADR-0072 (ENTITY-FILTER-1) — `FilterModal` rendering/interaction tests.
 *
 * Covers TC-ADMIN-053 (add a condition, remove a condition), TC-ADMIN-054
 * (two conditions Apply as one AND-ed map; a field in use is not offered
 * twice), TC-ADMIN-055 (Cancel/ESC discard the draft, and a reopen shows the
 * applied state rather than the abandoned one), and TC-ADMIN-056 (typed value
 * controls per field type; a `text` field is never offered).
 *
 * `useEntitySchema` is mocked because `FkSelect`/`FkAutocomplete` call it
 * unconditionally (Rules of Hooks) — without the mock every test here would
 * need a `QueryClientProvider`, the same reason `entity-table.test.tsx`
 * mocks its batched sibling.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterModal } from "./filter-modal";
import type { EntityConfig } from "../../../entityConfigs/types";

vi.mock("../../../pages/admin/useEntitySchema", () => ({
  resolveEntityKey: (key: string) => (key.endsWith("s") ? key : `${key}s`),
  useEntitySchema: () => ({ config: undefined, isLoading: false }),
  useEntitySchemas: () => ({}),
}));

const CONFIG: EntityConfig = {
  resource: "widget",
  path: "/widgets",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "title", label: "Title", type: "string" },
    { name: "status", label: "Status", type: "enum", values: ["draft", "approved"] },
    { name: "description", label: "Description", type: "text" },
    { name: "is_active", label: "Is Active", type: "boolean" },
    { name: "due_on", label: "Due On", type: "date" },
  ],
  filterFields: ["title", "status", "is_active", "due_on"],
};

function renderModal(overrides: Partial<React.ComponentProps<typeof FilterModal>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <FilterModal
      visible
      entityLabel="Widgets"
      config={CONFIG}
      filters={{}}
      onClose={onClose}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { ...utils, onApply, onClose };
}

describe("FilterModal — closed state", () => {
  it("renders nothing at all when not visible (the Modal molecule's unmount parity)", () => {
    renderModal({ visible: false });
    expect(screen.queryByTestId("filter-add-condition")).toBeNull();
  });
});

describe("FilterModal — adding and removing conditions (TC-ADMIN-053)", () => {
  it("starts with no conditions and an explicit empty state", () => {
    renderModal();
    expect(screen.getByTestId("filter-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-condition-0")).toBeNull();
  });

  it("adds a condition row pre-assigned to the first filterable field", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    expect(screen.getByTestId("filter-condition-0")).toBeInTheDocument();
    expect((screen.getByTestId("filter-field-0") as HTMLSelectElement).value).toBe("title");
  });

  it("removes a condition row", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    expect(screen.getByTestId("filter-condition-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("filter-remove-0"));
    expect(screen.queryByTestId("filter-condition-1")).toBeNull();
    // The survivor is the one that was second — its field, not the removed one's.
    expect((screen.getByTestId("filter-field-0") as HTMLSelectElement).value).toBe("status");
  });

  it("disables Add once every filterable field is claimed", () => {
    renderModal();
    for (let i = 0; i < CONFIG.filterFields!.length; i += 1) {
      fireEvent.click(screen.getByTestId("filter-add-condition"));
    }
    expect(screen.getByTestId("filter-add-condition")).toBeDisabled();
  });
});

describe("FilterModal — AND-combination (TC-ADMIN-054)", () => {
  it("Apply emits every condition as one map, which the backend ANDs", () => {
    const { onApply } = renderModal();

    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.change(screen.getByTestId("filter-value-title"), { target: { value: "widget" } });

    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.change(screen.getByTestId("filter-value-status"), { target: { value: "draft" } });

    fireEvent.click(screen.getByTestId("filter-apply"));
    expect(onApply).toHaveBeenCalledWith({ title: "widget", status: "draft" });
  });

  it("does not offer a field another condition already uses", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition")); // title
    fireEvent.click(screen.getByTestId("filter-add-condition")); // status

    const secondFieldOptions = Array.from(
      (screen.getByTestId("filter-field-1") as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(secondFieldOptions).not.toContain("title");
    expect(secondFieldOptions).toContain("status");
  });

  it("Apply drops a condition whose value was never filled in", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.click(screen.getByTestId("filter-apply"));
    expect(onApply).toHaveBeenCalledWith({});
  });
});

describe("FilterModal — draft discard semantics (TC-ADMIN-055)", () => {
  it("Cancel closes without applying anything", () => {
    const { onApply, onClose } = renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.change(screen.getByTestId("filter-value-title"), { target: { value: "abandoned" } });

    fireEvent.click(screen.getByTestId("filter-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("ESC closes without applying anything", () => {
    const { onApply, onClose } = renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("re-seeds from the APPLIED filters on reopen, discarding the abandoned draft", () => {
    const { rerender } = renderModal({ filters: { status: "approved" } });

    // The applied filter is shown on open.
    expect((screen.getByTestId("filter-field-0") as HTMLSelectElement).value).toBe("status");
    expect((screen.getByTestId("filter-value-status") as HTMLSelectElement).value).toBe("approved");

    // Edit without applying, then close...
    fireEvent.change(screen.getByTestId("filter-value-status"), { target: { value: "draft" } });
    rerender(
      <FilterModal
        visible={false}
        config={CONFIG}
        filters={{ status: "approved" }}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    // ...and reopen: the abandoned "draft" edit is gone, "approved" is back.
    rerender(
      <FilterModal
        visible
        config={CONFIG}
        filters={{ status: "approved" }}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect((screen.getByTestId("filter-value-status") as HTMLSelectElement).value).toBe("approved");
  });

  it("Clear all empties the draft, and Apply then commits the empty map", () => {
    const { onApply } = renderModal({ filters: { title: "widget" } });
    fireEvent.click(screen.getByTestId("filter-clear-all"));
    expect(screen.getByTestId("filter-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("filter-apply"));
    expect(onApply).toHaveBeenCalledWith({});
  });
});

describe("FilterModal — typed value controls (TC-ADMIN-056)", () => {
  it("never offers a `text` field, even though it is a real served column", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("filter-add-condition"));
    const options = Array.from((screen.getByTestId("filter-field-0") as HTMLSelectElement).options).map(
      (option) => option.value,
    );
    expect(options).not.toContain("description");
    expect(options).toEqual(["title", "status", "is_active", "due_on"]);
  });

  it("renders an enum field's own served values as a select", () => {
    renderModal({ filters: { status: "draft" } });
    const control = screen.getByTestId("filter-value-status") as HTMLSelectElement;
    expect(control.tagName).toBe("SELECT");
    expect(Array.from(control.options).map((o) => o.value)).toEqual(["", "draft", "approved"]);
  });

  it("renders a boolean field as a Yes/No select", () => {
    renderModal({ filters: { is_active: "true" } });
    const control = screen.getByTestId("filter-value-is_active") as HTMLSelectElement;
    expect(control.tagName).toBe("SELECT");
    expect(Array.from(control.options).map((o) => o.value)).toEqual(["", "true", "false"]);
  });

  it("renders a date field as a date input", () => {
    renderModal({ filters: { due_on: "2026-09-15" } });
    expect(screen.getByTestId("filter-value-due_on")).toHaveAttribute("type", "date");
  });

  it("renders a plain string field as a text input", () => {
    renderModal({ filters: { title: "widget" } });
    expect(screen.getByTestId("filter-value-title")).toHaveAttribute("type", "text");
  });

  it("explains itself when the entity has no filterable fields at all", () => {
    renderModal({ config: { ...CONFIG, filterFields: [] } });
    expect(screen.getByTestId("filter-no-fields")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-add-condition")).toBeNull();
  });
});

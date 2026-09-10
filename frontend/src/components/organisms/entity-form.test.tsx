import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EntityForm from "./entity-form";
import type { EntityConfig } from "../../entityConfigs/types";

/**
 * ADR-0025: `EntityForm` is generic/config-driven — the field-type -> input
 * mapping (UI Design Document §3) is what's under test here, once, using a
 * fixture config exercising all 5 `FieldType`s, not a real entity config.
 */
/**
 * ADR-0053: the fk field's `FkAutocomplete` resolves its ref-entity config
 * through `useEntitySchema` now, not the retired `entityConfigByKey` registry
 * map — so that's what this file mocks. Returning the config synchronously
 * keeps the "renders a search input for an fk field" assertion below testing
 * the field-type mapping rather than a loading state.
 */
vi.mock("../../pages/admin/useEntitySchema", () => ({
  useEntitySchema: (key: string) => ({
    config:
      key === "widget-owner"
        ? {
            resource: "widget_owner",
            path: "/widget-owners",
            methods: ["list", "get"],
            fields: [{ name: "name", label: "Name", type: "string" }],
          }
        : undefined,
    label: undefined,
    isLoading: false,
    isError: false,
  }),
}));

const CONFIG: EntityConfig = {
  resource: "widget",
  path: "/widgets",
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "title", label: "Title", type: "string", required: true },
    { name: "status", label: "Status", type: "enum", values: ["draft", "done"], required: true },
    { name: "owner_id", label: "Owner", type: "fk", refEntity: "widget-owner", labelField: "name" },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "is_active", label: "Active", type: "boolean" },
  ],
};

describe("EntityForm", () => {
  it("renders a text input for a string field", () => {
    render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Title")).toHaveAttribute("type", "text");
  });

  it("renders a select populated from values[] for an enum field", () => {
    render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "draft", "done"]);
  });

  it("renders an FkAutocomplete (search input) for an fk field", () => {
    render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Owner")).toHaveAttribute("placeholder", "Type to search...");
  });

  it("renders a native date input for a date field", () => {
    render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Due date")).toHaveAttribute("type", "date");
  });

  it("renders a switch (checkbox) for a boolean field", () => {
    render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Active")).toHaveAttribute("type", "checkbox");
  });

  it("renders a locked field as a plain disabled display, not an editable input", () => {
    render(
      <EntityForm
        config={CONFIG}
        mode="create"
        lockedValues={{ owner_id: "owner-1" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Owner")).toBeDisabled();
  });

  it("renders the Create submit label in create mode and Save in edit mode", () => {
    const { rerender } = render(<EntityForm config={CONFIG} mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();

    rerender(<EntityForm config={CONFIG} mode="edit" onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

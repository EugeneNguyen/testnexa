import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScopeSelector from "./scope-selector";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0081 — `ScopeSelectorOption.via`, the cascading two-hop picker.
 *
 * Mirrors `fk-autocomplete.test.tsx`'s own harness (`useEntitySchema` mocked
 * with two stable configs — an outer "widget" and a via "widget-owner" —
 * `listEntities` mocked). Real timers throughout (not `fk-autocomplete.test.tsx`'s
 * own fake-timer debounce harness): these tests exercise a full pick →
 * click-the-result → assert-the-next-step flow across two `FkAutocomplete`
 * instances, and `findBy*`'s own internal polling does not advance under
 * faked timers unless the fake clock is also driven forward inside every
 * `waitFor`, which is more fragile here than a real (small) debounce wait.
 */
const { schemaState, WIDGET_SCHEMA, OWNER_SCHEMA } = vi.hoisted(() => ({
  schemaState: { isLoading: false },
  WIDGET_SCHEMA: {
    resource: "widget",
    path: "/widgets",
    methods: ["list", "get"],
    fields: [{ name: "name", label: "Name", type: "string" }],
  },
  OWNER_SCHEMA: {
    resource: "widget_owner",
    path: "/widget-owners",
    methods: ["list", "get"],
    fields: [{ name: "name", label: "Name", type: "string" }],
  },
}));

vi.mock("../../../pages/admin/useEntitySchema", () => ({
  useEntitySchema: (key: string) => ({
    config: schemaState.isLoading ? undefined : key === "widget" ? WIDGET_SCHEMA : OWNER_SCHEMA,
    label: undefined,
    isLoading: schemaState.isLoading,
    isError: false,
  }),
}));

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);

async function pickViaOwner() {
  fireEvent.change(screen.getByLabelText(/pick a widget-owner/i), { target: { value: "alice" } });
  fireEvent.click(await screen.findByText("owner-1", {}, { timeout: 2000 }));
}

describe("ScopeSelector — via (ADR-0081)", () => {
  beforeEach(() => {
    mockListEntities.mockResolvedValue({
      items: [{ id: "owner-1", name: "Alice" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  it("renders the via picker first, not the outer option's own picker", () => {
    render(
      <ScopeSelector
        options={{
          refEntity: "widget",
          paramName: "widget_id",
          via: { refEntity: "widget-owner", paramName: "widget_owner_id" },
        }}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/pick a widget-owner/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/filter by widget$/i)).not.toBeInTheDocument();
  });

  it("threads the resolved via value into the outer option's own search, and onResolved fires only for the outer field", async () => {
    const onResolved = vi.fn();
    render(
      <ScopeSelector
        options={{
          refEntity: "widget",
          paramName: "widget_id",
          via: { refEntity: "widget-owner", paramName: "widget_owner_id" },
        }}
        onResolved={onResolved}
        extraParams={{ project_id: "proj-1" }}
      />,
    );

    await pickViaOwner();

    // Via resolved — the outer picker now renders, and onResolved has NOT
    // fired yet (the via pick is intermediate, not the real scope value).
    expect(onResolved).not.toHaveBeenCalled();
    const outerInput = await screen.findByLabelText(/filter by widget$/i);

    mockListEntities.mockClear();
    fireEvent.change(outerInput, { target: { value: "wid" } });

    await waitFor(() => expect(mockListEntities).toHaveBeenCalled(), { timeout: 2000 });
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "widget" }),
      {},
      expect.objectContaining({
        q: "wid",
        params: { project_id: "proj-1", widget_owner_id: "owner-1" },
      }),
    );
  });

  it("'Change' resets back to the via step, clearing the outer value too", async () => {
    render(
      <ScopeSelector
        options={{
          refEntity: "widget",
          paramName: "widget_id",
          via: { refEntity: "widget-owner", paramName: "widget_owner_id" },
        }}
        onResolved={vi.fn()}
      />,
    );

    await pickViaOwner();
    await screen.findByLabelText(/filter by widget$/i);

    fireEvent.click(screen.getByRole("button", { name: /change widget-owner/i }));

    expect(screen.getByLabelText(/pick a widget-owner/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/filter by widget$/i)).not.toBeInTheDocument();
  });

  it("ADR-0089: threads labelField to the picker, so an option renders a real name, not the raw id", async () => {
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Real Widget Name" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    render(
      <ScopeSelector
        options={{ refEntity: "widget", paramName: "widget_id", labelField: "name" }}
        onResolved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/filter by widget$/i), { target: { value: "wid" } });

    expect(await screen.findByText("Real Widget Name")).toBeInTheDocument();
    expect(screen.queryByText("widget-1")).not.toBeInTheDocument();
  });

  it("ADR-0089: threads labelField to the `via` picker too", async () => {
    render(
      <ScopeSelector
        options={{
          refEntity: "widget",
          paramName: "widget_id",
          via: { refEntity: "widget-owner", paramName: "widget_owner_id", labelField: "name" },
        }}
        onResolved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/pick a widget-owner/i), { target: { value: "alice" } });

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("owner-1")).not.toBeInTheDocument();
  });

  it("an option with no via renders its own picker directly, unchanged from before ADR-0081", () => {
    render(<ScopeSelector options={{ refEntity: "widget", paramName: "widget_id" }} onResolved={vi.fn()} />);

    expect(screen.getByLabelText(/filter by widget$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/pick a/i)).not.toBeInTheDocument();
  });

  it("switching arms in a multi-option selector clears a previously-resolved via value", async () => {
    render(
      <ScopeSelector
        options={[
          {
            refEntity: "widget",
            paramName: "widget_id",
            label: "By widget",
            via: { refEntity: "widget-owner", paramName: "widget_owner_id" },
          },
          { refEntity: "widget-owner", paramName: "widget_owner_id", label: "By owner" },
        ]}
        onResolved={vi.fn()}
      />,
    );

    await pickViaOwner();
    await screen.findByLabelText(/^by widget$/i);

    fireEvent.click(screen.getByRole("button", { name: "By owner" }));
    fireEvent.click(screen.getByRole("button", { name: "By widget" }));

    // Back on the `via`-declaring arm, with the prior pick cleared — the via
    // step renders again rather than jumping straight to the outer picker.
    await waitFor(() => expect(screen.getByLabelText(/pick a widget-owner/i)).toBeInTheDocument());
  });
});

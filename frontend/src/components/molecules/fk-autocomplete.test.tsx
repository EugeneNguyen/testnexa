import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FkAutocomplete from "./fk-autocomplete";
import { listEntities } from "../../lib/api/entityCrud";

/**
 * UI Design Document §2: `FkAutocomplete` debounces (300ms) then fires
 * `?q=<term>` against the referenced entity's own list route.
 *
 * **ADR-0053:** the ref-entity config arrives from `useEntitySchema(refEntity)`
 * now — the `entityConfigByKey` registry map this file used to mock is gone.
 * The hook is mocked (rather than a `QueryClientProvider` + a mocked
 * `getEntitySchema`) for the same reason the registry was: the debounce
 * behavior under test here has nothing to do with how the config was
 * obtained, and a synchronously-available config keeps these assertions
 * exercising exactly what they exercised before.
 */
// The returned `config` must be a STABLE object, not a fresh literal per call.
// `FkAutocomplete`'s label-lookup effect lists `refConfig` in its dependency
// array, so a new identity on every render re-runs that effect every render —
// a setState loop that drowns the component in re-renders (visible as a wall of
// act(...) warnings) and starves the debounce timer these tests advance.
// The real hook already returns a `useMemo`-stable config; the mock has to
// match that contract, not just its shape.
const { schemaState, OWNER_SCHEMA } = vi.hoisted(() => ({
  schemaState: { isLoading: false },
  OWNER_SCHEMA: {
    resource: "widget_owner",
    path: "/widget-owners",
    methods: ["list", "get"],
    fields: [{ name: "name", label: "Name", type: "string" }],
  },
}));

vi.mock("../../pages/admin/useEntitySchema", () => ({
  useEntitySchema: (key: string) => ({
    config: key === "widget-owner" && !schemaState.isLoading ? OWNER_SCHEMA : undefined,
    label: undefined,
    isLoading: schemaState.isLoading,
    isError: false,
  }),
}));

vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);

describe("FkAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListEntities.mockResolvedValue({ items: [{ id: "owner-1", name: "Alice" }], total: 1, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  it("does not call listEntities until 300ms after the last keystroke", async () => {
    render(<FkAutocomplete id="owner" label="Owner" refEntity="widget-owner" labelField="name" onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "ali" } });
    expect(mockListEntities).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(299);
    expect(mockListEntities).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockListEntities).toHaveBeenCalledTimes(1);
  });

  it("calls listEntities against the resolved refEntity config with the typed q= term", async () => {
    render(<FkAutocomplete id="owner" label="Owner" refEntity="widget-owner" labelField="name" onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "alice" } });
    await vi.advanceTimersByTimeAsync(300);

    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "widget_owner" }),
      {},
      expect.objectContaining({ q: "alice" }),
    );
  });

  it("only fires one request for a burst of keystrokes within the debounce window", async () => {
    render(<FkAutocomplete id="owner" label="Owner" refEntity="widget-owner" labelField="name" onChange={vi.fn()} />);

    const input = screen.getByLabelText("Owner");
    fireEvent.change(input, { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "al" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "ali" } });
    await vi.advanceTimersByTimeAsync(300);

    expect(mockListEntities).toHaveBeenCalledTimes(1);
    expect(mockListEntities).toHaveBeenCalledWith(expect.anything(), {}, expect.objectContaining({ q: "ali" }));
  });

  // ADR-0053: the `config` prop (EXEC-1/ADR-0034) is unchanged by the move to
  // a fetched config — `useEntitySchema` is still called (Rules of Hooks), but
  // the prop is what the search actually runs against.
  it("uses the explicit config prop over the fetched schema when one is supplied", async () => {
    const override = {
      resource: "widget_owner",
      path: "/widget-owners",
      listPath: "/test-plans/plan-1/widget-owners",
      methods: ["list", "get"] as const,
      fields: [{ name: "name", label: "Name", type: "string" as const }],
    };
    render(
      <FkAutocomplete
        id="owner"
        label="Owner"
        refEntity="widget-owner"
        labelField="name"
        onChange={vi.fn()}
        config={{ ...override, methods: [...override.methods] }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "alice" } });
    await vi.advanceTimersByTimeAsync(300);

    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ listPath: "/test-plans/plan-1/widget-owners" }),
      {},
      expect.objectContaining({ q: "alice" }),
    );
  });

  // ADR-0053: the config is no longer available on first render. "Still
  // fetching" must not be presented as "this field can't be searched".
  it("renders a disabled Loading... input while the ref-entity schema is still fetching", () => {
    schemaState.isLoading = true;
    render(<FkAutocomplete id="owner" label="Owner" refEntity="widget-owner" labelField="name" onChange={vi.fn()} />);

    const input = screen.getByLabelText("Owner");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Loading...");
  });
});

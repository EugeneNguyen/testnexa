import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FkAutocomplete from "../../../src/components/crud/FkAutocomplete";
import { listEntities } from "../../../src/lib/api/entityCrud";

/**
 * UI Design Document §2: `FkAutocomplete` debounces (300ms) then fires
 * `?q=<term>` against the referenced entity's own list route.
 */
vi.mock("../../../src/pages/admin/registry", () => ({
  entityConfigByKey: {
    "widget-owner": {
      resource: "widget_owner",
      path: "/widget-owners",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string" }],
    },
  },
}));

vi.mock("../../../src/lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/entityCrud")>();
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
});
